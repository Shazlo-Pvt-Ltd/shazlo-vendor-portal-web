"""Delivers the outbox to the central app (ADR 0003, sections 3 to 5).

A worker claims due rows, sends each as a signed request, and records the result in a short
transaction of its own. Nothing is held open while a request is in flight: a claimed row is
`sending`, `locked_at` says since when (so a crashed worker's rows are found by the sweeper) and
`claim_token` says by whom.

**A request has a deadline** (`SEND_DEADLINE`, 30 s for connecting, sending and reading the whole
answer), well under the sweeper's two minutes: the per-step timeout alone would let an answer that
keeps trickling in run on for ever. Even so, a result is only written while the row still carries
the claim token of the worker that sends it, so a worker that is late (a paused process, a slow
database) cannot overwrite a row that was given away and claimed again.

**Several workers** may run. The claim is the ADR's query: `FOR UPDATE SKIP LOCKED`, and a row is
skipped while an earlier version of its aggregate is still `pending` or `sending`, so an aggregate's
events go out one at a time, in version order. A `dead` event does not block the newer ones.

**Results** (the ADR's table):

- `200` (accepted, a duplicate or stale: all are done): `sent`.
- `400`, `409`, `413`, `422`: `dead` at once, with the reason.
- `401`: the key is wrong, which is not the event's fault (ADR 0003 section 4 says so too). The
  event goes back to `pending` without using up an attempt, and five in a row **pause
  publishing** and raise an alert.
- `408`, `429`, `5xx`, a timeout, a network error: retry with backoff.
- Anything else (3xx, 403, 404...): retry with backoff too. It is a configuration problem a
  person can fix, and the event survives until they do.

**Backoff** after the n-th failed attempt: 30 s, 2 min, 10 min, 1 h, 6 h, 12 h, 24 h, each plus or
minus 20% (so a hundred events that failed together do not all come back together); a
`Retry-After` longer than that is honoured, up to 24 h. After the 8th failed attempt the event is
`dead`.
"""

import asyncio
import contextlib
import http.cookiejar
import json
import logging
import random
import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any, cast

import httpx
from shazlo_security.signing import RequestSigner
from sqlalchemy import DateTime, Integer, bindparam, delete, exists, select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from vendor_api.db.models import OutboxEvent, OutboxEventLog, OutboxLogKind, OutboxStatus
from vendor_api.services.central_events import PRODUCER, iso

logger = logging.getLogger(__name__)

EVENTS_PATH = "/internal/v1/events"
VERSIONS_PATH = "/internal/v1/versions"
VERSIONS_PAGE = 500
MAX_VERSION_PAGES = 20_000
# A page of 500 versions is about 60 KB: anything past this is not one.
MAX_VERSIONS_BYTES = 4 * 1024 * 1024

# The central app answers within 10 seconds (ADR 0003): no single step of a request (connecting,
# sending, waiting for the next piece of the answer) is allowed to take longer ...
REQUEST_TIMEOUT = 10.0
# ... and the whole request, answer included, has this long: well under `STALE_AFTER`, so a row is
# never still in flight when the sweeper gives it away.
SEND_DEADLINE = 30.0
# Only the start of the answer is read: the status and an error code are all that is used.
MAX_RESPONSE_BYTES = 65_536
BATCH_SIZE = 20
POLL_SECONDS = 1.0
MAINTENANCE_SECONDS = 60.0

# After the n-th failed attempt, wait this long (seconds) before the next one.
BACKOFF_SECONDS = (30, 120, 600, 3_600, 21_600, 43_200, 86_400)
MAX_ATTEMPTS = 8
JITTER = 0.2
MAX_RETRY_AFTER = 86_400.0

# A `sending` row older than this belongs to a worker that is gone.
STALE_AFTER = timedelta(minutes=2)
SENT_RETENTION = timedelta(days=30)

# Five 401s in a row mean the key is wrong: stop, and look again now and then (one event at a time).
UNAUTHORIZED_LIMIT = 5
UNAUTHORIZED_RETRY_SECONDS = 60.0
PAUSE_PROBE_SECONDS = 300.0

PERMANENT = frozenset({400, 409, 413, 422})
ERROR_MAX = 1_000  # the table keeps a reason, not a copy of the response

Clock = Callable[[], datetime]
# `async_sessionmaker()` is one; tests pass a function that hands out their own session.
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


def _now() -> datetime:
    return datetime.now(UTC)


# The ADR's claim, with the clock passed in (tests set it) instead of `now()`. The locking select
# is a MATERIALIZED CTE so Postgres runs it once: as an `id IN (SELECT ... LIMIT n FOR UPDATE SKIP
# LOCKED)` subquery the planner may re-run it for each row it updates and claim more than `n`.
CLAIM = text(
    """
    WITH due AS MATERIALIZED (
      SELECT d.id
      FROM outbox_events d
      WHERE d.status = 'pending'
        AND d.next_attempt_at <= :now
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events e
          WHERE e.aggregate_type = d.aggregate_type
            AND e.aggregate_id = d.aggregate_id
            AND e.version < d.version
            AND e.status IN ('pending', 'sending')
        )
      ORDER BY d.next_attempt_at
      LIMIT :limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events o
    SET status = 'sending', locked_at = :now, claim_token = gen_random_uuid(),
        attempts = o.attempts + 1
    FROM due
    WHERE o.id = due.id
    RETURNING o.id, o.event_type, o.aggregate_type, o.aggregate_id, o.version, o.payload,
              o.created_at, o.attempts, o.claim_token
    """
).bindparams(bindparam("now", type_=DateTime(timezone=True)), bindparam("limit", type_=Integer))


class CentralError(Exception):
    """The central app could not be asked (not an answer about an event). Safe to show."""


@dataclass(frozen=True)
class Claimed:
    """A row this worker holds."""

    id: uuid.UUID
    event_type: str
    aggregate_type: str
    aggregate_id: uuid.UUID
    version: int
    payload: dict[str, Any]
    created_at: datetime
    attempts: int
    claim_token: uuid.UUID


@dataclass(frozen=True)
class Answer:
    """What the central app said: a status, or why there was none (a timeout, a network error)."""

    status: int | None
    reason: str
    retry_after: float | None = None


def envelope_bytes(event: Claimed) -> bytes:
    """The request body, as bytes: the contract's envelope rebuilt from the row alone. These exact
    bytes are signed and sent (never parsed and serialised again in between)."""
    envelope = {
        "event_id": str(event.id),
        "type": event.event_type,
        "version": event.version,
        "occurred_at": iso(event.created_at),
        "producer": PRODUCER,
        "aggregate": {"type": event.aggregate_type, "id": str(event.aggregate_id)},
        "payload": event.payload,
    }
    return json.dumps(envelope, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode()


def classify(status: int) -> str:
    """`sent`, `dead` or `retry` for an HTTP status (401 is handled apart, see the module doc)."""
    if status == 200:
        return "sent"
    if status in PERMANENT:
        return "dead"
    return "retry"


def backoff_seconds(failed_attempts: int, rng: random.Random, retry_after: float | None) -> float:
    """How long to wait after the `failed_attempts`-th failure (1 for the first)."""
    base = BACKOFF_SECONDS[min(max(failed_attempts, 1), len(BACKOFF_SECONDS)) - 1]
    delay = base * rng.uniform(1 - JITTER, 1 + JITTER)
    if retry_after is not None:
        delay = max(delay, min(retry_after, MAX_RETRY_AFTER))
    return delay


def parse_retry_after(value: str | None, now: datetime) -> float | None:
    """`Retry-After` is seconds or an HTTP date; anything else is ignored."""
    if not value:
        return None
    value = value.strip()
    if value.isascii() and value.isdigit():
        return float(value)
    try:
        moment = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if moment.tzinfo is None:
        return None
    return max(0.0, (moment - now).total_seconds())


class _NoCookies(http.cookiejar.CookiePolicy):
    """Refuses every cookie the central app sets and sends none: `httpx.AsyncClient` keeps cookies
    between requests by default, and a `Set-Cookie` must not become a credential on later ones."""

    netscape = True
    rfc2965 = False
    hide_cookie2 = False

    def set_ok(self, cookie: http.cookiejar.Cookie, request: Any) -> bool:
        return False

    def return_ok(self, cookie: http.cookiejar.Cookie, request: Any) -> bool:
        return False

    def domain_return_ok(self, domain: str, request: Any) -> bool:
        return False

    def path_return_ok(self, path: str, request: Any) -> bool:
        return False


class CentralClient:
    """Sends one signed event. No redirects, no cookies, no proxy or `.netrc` credentials, and no
    credential of any kind except the signature."""

    def __init__(
        self,
        base_url: str,
        signer: RequestSigner,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Clock = _now,
    ) -> None:
        self._url = base_url.rstrip("/") + EVENTS_PATH
        self._versions_url = base_url.rstrip("/") + VERSIONS_PATH
        self._signer = signer
        self._clock = clock
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )
        self._http.cookies.jar.set_policy(_NoCookies())

    async def close(self) -> None:
        await self._http.aclose()

    async def versions(self, aggregate_type: str) -> dict[uuid.UUID, tuple[int, str]]:
        """Every aggregate of the type the central app holds: id to (version, state), for
        reconciliation. Follows the pages; raises `CentralError` if any of it fails."""
        held: dict[uuid.UUID, tuple[int, str]] = {}
        cursor: str | None = None
        for _ in range(MAX_VERSION_PAGES):
            params = {"aggregate_type": aggregate_type, "limit": str(VERSIONS_PAGE)}
            if cursor is not None:
                params["cursor"] = cursor
            try:
                # The same single deadline as an event, and a cap on the size: a versions page that
                # never ends must not hold the reconciliation (and its advisory lock) forever.
                async with asyncio.timeout(SEND_DEADLINE):
                    async with self._http.stream(
                        "GET", self._versions_url, params=params, headers=self._signer.headers(b"")
                    ) as response:
                        status = response.status_code
                        raw = await _read_capped(response, MAX_VERSIONS_BYTES)
            except (TimeoutError, httpx.TimeoutException) as error:
                raise CentralError("the central app did not answer the versions in time") from error
            except httpx.HTTPError as error:
                raise CentralError(
                    f"the central app could not be asked ({type(error).__name__})"
                ) from error
            if status != 200:
                reason = _reason(status, raw[:MAX_RESPONSE_BYTES] if raw is not None else b"")
                raise CentralError(f"the central app answered {reason} to the versions")
            if raw is None:
                raise CentralError("the central app's versions answer is too large")
            try:
                body = json.loads(raw)
                for item in body["items"]:
                    held[uuid.UUID(item["aggregate_id"])] = (
                        int(item["version"]),
                        str(item["state"]),
                    )
                cursor = body.get("next_cursor")
            except (ValueError, KeyError, TypeError, AttributeError, RecursionError) as error:
                raise CentralError("the central app's versions could not be read") from error
            if not cursor:
                return held
        raise CentralError("the central app's versions have too many pages")

    async def send(self, event: Claimed) -> Answer:
        body = envelope_bytes(event)
        headers = {
            **self._signer.headers(body),
            "Content-Type": "application/json",
            "Idempotency-Key": str(event.id),
        }
        try:
            # One deadline for everything: HTTPX's timeouts apply to each step, so an answer that
            # keeps arriving a little at a time would otherwise never run out.
            async with asyncio.timeout(SEND_DEADLINE):
                async with self._http.stream(
                    "POST", self._url, content=body, headers=headers
                ) as response:
                    answer = await _read_answer(response, self._clock())
        except (TimeoutError, httpx.TimeoutException):
            return Answer(None, "timeout")
        except httpx.HTTPError as error:
            return Answer(None, f"network error ({type(error).__name__})")
        return answer


async def _read_capped(response: httpx.Response, limit: int) -> bytes | None:
    """The whole body, or None when it is longer than `limit` (reading stops there)."""
    received = bytearray()
    async for chunk in response.aiter_bytes():
        received += chunk
        if len(received) > limit:
            return None
    return bytes(received)


async def _read_answer(response: httpx.Response, now: datetime) -> Answer:
    received = bytearray()
    async for chunk in response.aiter_bytes():
        received += chunk
        if len(received) >= MAX_RESPONSE_BYTES:
            break
    return Answer(
        response.status_code,
        _reason(response.status_code, bytes(received[:MAX_RESPONSE_BYTES])),
        parse_retry_after(response.headers.get("Retry-After"), now),
    )


def _reason(status: int, body: bytes) -> str:
    """`HTTP 422`, and the central app's error code when it sent one. The contract's error is
    `{"message": ..., "extra": {"code": "schema_invalid"}}`."""
    reason = f"HTTP {status}"
    try:
        parsed = json.loads(body)
    except (ValueError, RecursionError):
        return reason
    extra = parsed.get("extra") if isinstance(parsed, dict) else None
    code = extra.get("code") if isinstance(extra, dict) else None
    if isinstance(code, str) and code:
        reason += f": {code[:100]}"
    return reason


class Publisher:
    def __init__(
        self,
        sessions: Sessions,
        client: CentralClient,
        *,
        clock: Clock = _now,
        rng: random.Random | None = None,
        batch_size: int = BATCH_SIZE,
    ) -> None:
        self._sessions = sessions
        self._client = client
        self._clock = clock
        self._rng = rng or random.Random()  # noqa: S311 (jitter, not security)
        self._batch_size = batch_size
        self._unauthorized = 0
        self._probe_at: datetime | None = None

    @property
    def paused(self) -> bool:
        """True after five 401s in a row: the key is wrong, and nothing more is sent but a probe."""
        return self._unauthorized >= UNAUTHORIZED_LIMIT

    # --- One batch ---------------------------------------------------------------------------

    async def run_once(self, stop: asyncio.Event | None = None) -> int:
        """Claims what is due and sends it, all at once (a batch of different aggregates, each
        with a ten second limit, stays well inside the sweeper's two minutes). Returns how many
        events it handled."""
        now = self._clock()
        limit = self._batch_size
        if self.paused:
            if self._probe_at is not None and now < self._probe_at:
                return 0
            limit = 1  # one event, to see whether the key works now
        events = await self._claim(now, limit)
        if not events:
            return 0
        await asyncio.gather(*(self._deliver(event, stop) for event in events))
        return len(events)

    async def _claim(self, now: datetime, limit: int) -> list[Claimed]:
        async with self._sessions() as db:
            rows = (await db.execute(CLAIM, {"now": now, "limit": limit})).mappings().all()
            await db.commit()
        return [Claimed(**row) for row in rows]

    async def _deliver(self, event: Claimed, stop: asyncio.Event | None) -> None:
        if stop is not None and stop.is_set():
            await self._release(event)  # shutting down: do not start a request now
            return
        try:
            answer = await self._client.send(event)
        except Exception:
            # Not a failure of the central app (a bad URL, a signing error): the event waits and
            # backs off like any other, and the rest of the batch is not left hanging.
            logger.exception("the request could not be sent", extra=self._context(event))
            answer = Answer(None, "internal error")
        try:
            await self._record(event, answer)
        except Exception:
            # The sweeper will find the row; the central app de-duplicates a second send.
            logger.exception("could not record the result", extra={"event_id": str(event.id)})

    # --- Recording ---------------------------------------------------------------------------

    async def _record(self, event: Claimed, answer: Answer) -> None:
        now = self._clock()
        if answer.status == 401:
            await self._unauthorized_answer(event, answer, now)
            return
        self._unauthorized = 0
        self._probe_at = None
        outcome = "retry" if answer.status is None else classify(answer.status)
        if outcome == "sent":
            if await self._finish(
                event,
                status=OutboxStatus.SENT,
                sent_at=now,
                last_error=None,
                locked_at=None,
                log=f"sent (HTTP {answer.status})",
            ):
                logger.info("event sent", extra=self._context(event))
        elif outcome == "dead":
            await self._dead(event, answer.reason)
        elif event.attempts >= MAX_ATTEMPTS:
            await self._dead(event, f"{answer.reason} (after {event.attempts} attempts)")
        else:
            delay = backoff_seconds(event.attempts, self._rng, answer.retry_after)
            if await self._finish(
                event,
                status=OutboxStatus.PENDING,
                locked_at=None,
                next_attempt_at=now + timedelta(seconds=delay),
                last_error=answer.reason[:ERROR_MAX],
                log=f"failed, will try again in {round(delay)} s: {answer.reason}",
            ):
                logger.warning(
                    "event will be sent again",
                    extra={
                        **self._context(event),
                        "reason": answer.reason,
                        "in_seconds": round(delay),
                    },
                )

    async def _dead(self, event: Claimed, reason: str) -> None:
        if await self._finish(
            event,
            status=OutboxStatus.DEAD,
            locked_at=None,
            last_error=reason[:ERROR_MAX],
            log=f"failed for good: {reason}",
        ):
            logger.error(
                "event is dead", extra={**self._context(event), "reason": reason, "alert": True}
            )

    async def _unauthorized_answer(self, event: Claimed, answer: Answer, now: datetime) -> None:
        """The central app does not accept our signature. That says nothing about this event, so
        it keeps its attempts and waits; five in a row stop the publishing."""
        self._unauthorized += 1
        if self.paused:
            self._probe_at = now + timedelta(seconds=PAUSE_PROBE_SECONDS)
            logger.error(
                "publishing paused: the central app refused our signature %d times in a row; "
                "check CENTRAL_SIGNING_KEY_ID and CENTRAL_SIGNING_SECRET",
                self._unauthorized,
                extra={"alert": True},
            )
        await self._finish(
            event,
            status=OutboxStatus.PENDING,
            locked_at=None,
            attempts=max(event.attempts - 1, 0),
            next_attempt_at=now + timedelta(seconds=UNAUTHORIZED_RETRY_SECONDS),
            last_error=answer.reason[:ERROR_MAX],
            log=f"{answer.reason}: our signature was refused; kept for later",
        )

    async def _release(self, event: Claimed) -> None:
        """Gives a claim back unused: pending again, and the attempt not counted."""
        await self._finish(
            event,
            status=OutboxStatus.PENDING,
            locked_at=None,
            attempts=max(event.attempts - 1, 0),
        )

    async def _finish(self, event: Claimed, *, log: str | None = None, **values: Any) -> bool:
        """Updates the row, but only while it is still ours: `sending` with the token this worker
        claimed it with. A sweeper that gave it away in the meantime wins, and so does the worker
        that claimed it after that (its request may still be in flight); the central app
        de-duplicates the second send. Returns whether the row was ours. `log` is the attempt's line
        in the event's history (`outbox_event_log`), written in the same transaction and only when
        the row was ours, so a worker that lost its claim leaves no entry."""
        async with self._sessions() as db:
            result = cast(
                "CursorResult[Any]",
                await db.execute(
                    update(OutboxEvent)
                    .where(
                        OutboxEvent.id == event.id,
                        OutboxEvent.status == OutboxStatus.SENDING,
                        OutboxEvent.claim_token == event.claim_token,
                    )
                    .values(claim_token=None, **values)
                ),
            )
            if result.rowcount == 1 and log is not None:
                # In the same transaction as the result: an attempt is on record or it is not.
                db.add(
                    OutboxEventLog(
                        event_id=event.id, kind=OutboxLogKind.ATTEMPT, outcome=log[:ERROR_MAX]
                    )
                )
            await db.commit()
        if result.rowcount != 1:
            logger.warning("the row was no longer ours", extra=self._context(event))
            return False
        return True

    @staticmethod
    def _context(event: Claimed) -> dict[str, Any]:
        return {
            "event_id": str(event.id),
            "event_type": event.event_type,
            "version": event.version,
            "attempt": event.attempts,
        }

    # --- Upkeep ------------------------------------------------------------------------------

    async def maintain(self) -> tuple[int, int]:
        """The sweeper and the cleanup. Returns (rows given back, rows removed). The cleanup removes
        what was sent over 30 days ago, except the latest row of each aggregate."""
        now = self._clock()
        async with self._sessions() as db:
            # A worker that died with the row: pending again, or dead if it was the last attempt
            # (an event that crashes its worker must not be tried forever).
            dead = cast(
                "CursorResult[Any]",
                await db.execute(
                    update(OutboxEvent)
                    .where(
                        OutboxEvent.status == OutboxStatus.SENDING,
                        OutboxEvent.locked_at < now - STALE_AFTER,
                        OutboxEvent.attempts >= MAX_ATTEMPTS,
                    )
                    .values(
                        status=OutboxStatus.DEAD,
                        locked_at=None,
                        claim_token=None,
                        last_error="the worker stopped while sending the last attempt",
                    )
                ),
            )
            swept = cast(
                "CursorResult[Any]",
                await db.execute(
                    update(OutboxEvent)
                    .where(
                        OutboxEvent.status == OutboxStatus.SENDING,
                        OutboxEvent.locked_at < now - STALE_AFTER,
                    )
                    .values(status=OutboxStatus.PENDING, locked_at=None, claim_token=None)
                ),
            )
            # The latest row of an aggregate stays however old: the outbox writer reads it to know
            # what the central app holds (whether a withdrawal is due, which version comes next).
            newer = aliased(OutboxEvent)
            removed = cast(
                "CursorResult[Any]",
                await db.execute(
                    delete(OutboxEvent).where(
                        OutboxEvent.status == OutboxStatus.SENT,
                        OutboxEvent.created_at < now - SENT_RETENTION,
                        OutboxEvent.sent_at < now - SENT_RETENTION,
                        exists(
                            select(newer.id).where(
                                newer.aggregate_type == OutboxEvent.aggregate_type,
                                newer.aggregate_id == OutboxEvent.aggregate_id,
                                newer.version > OutboxEvent.version,
                            )
                        ),
                    )
                ),
            )
            await db.commit()
        given_back = int(swept.rowcount) + int(dead.rowcount)
        if given_back:
            logger.warning("rows stuck in sending were given back", extra={"rows": given_back})
        return given_back, int(removed.rowcount)

    # --- The loop ----------------------------------------------------------------------------

    async def run(self, stop: asyncio.Event) -> None:
        """Runs until `stop` is set; the batch in flight finishes first."""
        loop = asyncio.get_running_loop()
        last_maintenance = float("-inf")
        while not stop.is_set():
            try:
                if loop.time() - last_maintenance >= MAINTENANCE_SECONDS:
                    last_maintenance = loop.time()
                    await self.maintain()
                handled = await self.run_once(stop)
            except Exception:
                logger.exception("the publisher could not reach the database")
                handled = 0
            if handled == 0:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
