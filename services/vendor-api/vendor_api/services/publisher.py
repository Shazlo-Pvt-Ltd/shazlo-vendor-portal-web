"""Delivers the outbox to the central app (ADR 0003, sections 3 to 5).

A worker claims due rows, sends each as a signed request, and records the result in a short
transaction of its own. Nothing is held open while a request is in flight: a claimed row is
`sending` and `locked_at` says since when, so a crashed worker's rows are found by the sweeper.

**Several workers** may run. The claim is the ADR's query: `FOR UPDATE SKIP LOCKED`, and a row is
skipped while an earlier version of its aggregate is still `pending` or `sending`, so an aggregate's
events go out one at a time, in version order. A `dead` event does not block the newer ones.

**Results** (the ADR's table):

- `200` (accepted, a duplicate or stale: all are done): `sent`.
- `400`, `409`, `413`, `422`: `dead` at once, with the reason.
- `401`: the key is wrong, which is not the event's fault. The event goes back to `pending`
  without using up an attempt, and five in a row **pause publishing** and raise an alert.
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
from sqlalchemy import DateTime, Integer, bindparam, delete, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import OutboxEvent, OutboxStatus
from vendor_api.services.central_events import PRODUCER, iso

logger = logging.getLogger(__name__)

EVENTS_PATH = "/internal/v1/events"

# The central app answers within 10 seconds (ADR 0003): a request is not allowed to take longer.
REQUEST_TIMEOUT = 10.0
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


# The ADR's claim, with the clock passed in (tests set it) instead of `now()`.
CLAIM = text(
    """
    UPDATE outbox_events o
    SET status = 'sending', locked_at = :now, attempts = o.attempts + 1
    WHERE o.id IN (
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
    RETURNING o.id, o.event_type, o.aggregate_type, o.aggregate_id, o.version, o.payload,
              o.created_at, o.attempts
    """
).bindparams(bindparam("now", type_=DateTime(timezone=True)), bindparam("limit", type_=Integer))


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
    if value.isdigit():
        return float(value)
    try:
        moment = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        return None
    return max(0.0, (moment - now).total_seconds())


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
        self._signer = signer
        self._clock = clock
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def send(self, event: Claimed) -> Answer:
        body = envelope_bytes(event)
        headers = {
            **self._signer.headers(body),
            "Content-Type": "application/json",
            "Idempotency-Key": str(event.id),
        }
        try:
            response = await self._http.post(self._url, content=body, headers=headers)
        except httpx.TimeoutException:
            return Answer(None, "timeout")
        except httpx.HTTPError as error:
            return Answer(None, f"network error ({type(error).__name__})")
        return Answer(
            response.status_code,
            _reason(response),
            parse_retry_after(response.headers.get("Retry-After"), self._clock()),
        )


def _reason(response: httpx.Response) -> str:
    """`HTTP 422`, and the central app's error code when it sent one."""
    reason = f"HTTP {response.status_code}"
    try:
        body = response.json()
    except ValueError:
        return reason
    error = body.get("error") if isinstance(body, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
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
        answer = await self._client.send(event)
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
            await self._finish(
                event, status=OutboxStatus.SENT, sent_at=now, last_error=None, locked_at=None
            )
            logger.info("event sent", extra=self._context(event))
        elif outcome == "dead":
            await self._dead(event, answer.reason)
        elif event.attempts >= MAX_ATTEMPTS:
            await self._dead(event, f"{answer.reason} (after {event.attempts} attempts)")
        else:
            delay = backoff_seconds(event.attempts, self._rng, answer.retry_after)
            await self._finish(
                event,
                status=OutboxStatus.PENDING,
                locked_at=None,
                next_attempt_at=now + timedelta(seconds=delay),
                last_error=answer.reason[:ERROR_MAX],
            )
            logger.warning(
                "event will be sent again",
                extra={**self._context(event), "reason": answer.reason, "in_seconds": round(delay)},
            )

    async def _dead(self, event: Claimed, reason: str) -> None:
        await self._finish(
            event, status=OutboxStatus.DEAD, locked_at=None, last_error=reason[:ERROR_MAX]
        )
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
        )

    async def _release(self, event: Claimed) -> None:
        """Gives a claim back unused: pending again, and the attempt not counted."""
        await self._finish(
            event,
            status=OutboxStatus.PENDING,
            locked_at=None,
            attempts=max(event.attempts - 1, 0),
        )

    async def _finish(self, event: Claimed, **values: Any) -> None:
        """Updates the row, but only while it is still ours (`sending`): a sweeper that gave it
        away in the meantime wins, and its next send is de-duplicated by the central app."""
        async with self._sessions() as db:
            result = cast(
                "CursorResult[Any]",
                await db.execute(
                    update(OutboxEvent)
                    .where(OutboxEvent.id == event.id, OutboxEvent.status == OutboxStatus.SENDING)
                    .values(**values)
                ),
            )
            await db.commit()
        if result.rowcount != 1:
            logger.warning("the row was no longer ours", extra=self._context(event))

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
        """The sweeper and the cleanup. Returns (rows given back, rows removed)."""
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
                    .values(status=OutboxStatus.PENDING, locked_at=None)
                ),
            )
            removed = cast(
                "CursorResult[Any]",
                await db.execute(
                    delete(OutboxEvent).where(
                        OutboxEvent.status == OutboxStatus.SENT,
                        OutboxEvent.created_at < now - SENT_RETENTION,
                        OutboxEvent.sent_at < now - SENT_RETENTION,
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
