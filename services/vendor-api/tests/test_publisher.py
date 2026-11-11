"""The publisher worker (ADR 0003, sections 3 to 5), against a fake central app.

The database tests hand the publisher the test's own session (one at a time: a lock stands in for
the separate transactions it opens in production), so a rolled-back test leaves nothing behind.
The one test of two real workers uses its own committed rows and removes them.
"""

import asyncio
import json
import logging
import random
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from factories import saved_vendor
from shazlo_security.signing import (
    KEY_ID_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    RequestSigner,
    SigningKey,
    sign,
)
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from vendor_api.core.settings import Settings
from vendor_api.db.models import OutboxEvent
from vendor_api.db.session import async_url
from vendor_api.services import publisher as publisher_module
from vendor_api.services.publisher import (
    BACKOFF_SECONDS,
    CLAIM,
    MAX_ATTEMPTS,
    Answer,
    CentralClient,
    Claimed,
    Publisher,
    backoff_seconds,
    classify,
    envelope_bytes,
    parse_retry_after,
)
from vendor_api.worker import run as run_worker

T0 = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)
SECRET = b"s" * 32
KEY = SigningKey("k1", SECRET)
URL = "https://central.test"


# --- A fake central app ------------------------------------------------------------------------


class Receiver:
    """Answers the requests it gets from a list (then 200) and keeps them. An answer is a status,
    a `(status, headers, json body)` tuple, or an exception to raise (a timeout, a refused
    connection)."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.pop(0) if self.answers else 200
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, tuple):
            status, headers, body = answer
            return httpx.Response(status, headers=headers, json=body)
        return httpx.Response(answer, json={"status": "accepted"})

    @property
    def versions(self) -> list[int]:
        return [json.loads(r.content)["version"] for r in self.requests]


def client_for(
    handler: Callable[[httpx.Request], Any], clock: Callable[[], float] = lambda: 1.0
) -> CentralClient:
    signer = RequestSigner(KEY, clock=clock)
    return CentralClient(URL, signer, transport=httpx.MockTransport(handler))


def claimed(**changes: Any) -> Claimed:
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "event_type": "product.published",
        "aggregate_type": "product",
        "aggregate_id": uuid.uuid4(),
        "version": 3,
        "payload": {"title": "Kurta é", "price_paise": 99_900},
        "created_at": T0,
        "attempts": 1,
    }
    return Claimed(**{**values, **changes})


# --- What is sent (no database) ----------------------------------------------------------------


async def test_the_body_is_the_signed_bytes_and_the_only_credential_is_the_signature() -> None:
    receiver = Receiver()
    event = claimed()
    client = client_for(receiver, clock=lambda: 1_700_000_000)
    answer = await client.send(event)
    await client.close()

    (request,) = receiver.requests
    assert (answer.status, request.method, str(request.url)) == (
        200,
        "POST",
        f"{URL}/internal/v1/events",
    )
    body = request.content
    assert body == envelope_bytes(event)  # exactly the bytes that were signed
    assert request.headers[SIGNATURE_HEADER] == sign(SECRET, 1_700_000_000, body)
    assert request.headers[TIMESTAMP_HEADER] == "1700000000"
    assert request.headers[KEY_ID_HEADER] == "k1"
    assert request.headers["Idempotency-Key"] == str(event.id) == json.loads(body)["event_id"]
    assert request.headers["Content-Type"] == "application/json"
    assert {"authorization", "cookie", "proxy-authorization"}.isdisjoint(request.headers.keys())
    envelope = json.loads(body)
    assert envelope["producer"] == "vendor-api"
    assert envelope["aggregate"] == {"type": "product", "id": str(event.aggregate_id)}
    assert envelope["occurred_at"] == "2026-11-11T12:00:00Z"
    assert envelope["payload"] == event.payload
    assert "é" in body.decode()  # not escaped: one serialisation, signed as it is sent


async def test_a_redirect_is_not_followed() -> None:
    receiver = Receiver((302, {"Location": "https://elsewhere.test/steal"}, {}))
    client = client_for(receiver)
    answer = await client.send(claimed())
    await client.close()
    assert answer.status == 302
    assert len(receiver.requests) == 1  # the event was not sent on to the other address


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (httpx.ReadTimeout("slow"), "timeout"),
        (httpx.ConnectTimeout("slow"), "timeout"),
        (httpx.ConnectError("refused"), "network error (ConnectError)"),
        (httpx.RemoteProtocolError("reset"), "network error (RemoteProtocolError)"),
    ],
)
async def test_a_timeout_or_network_error_is_an_answer_without_a_status(
    failure: Exception, reason: str
) -> None:
    client = client_for(Receiver(failure))
    answer = await client.send(claimed())
    await client.close()
    assert (answer.status, answer.reason) == (None, reason)


async def test_the_reason_names_the_status_and_the_central_apps_error_code() -> None:
    body = {"error": {"code": "schema_invalid", "message": "x" * 5000}}
    client = client_for(Receiver((422, {}, body)))
    answer = await client.send(claimed())
    await client.close()
    assert answer.reason == "HTTP 422: schema_invalid"  # not a copy of the response


def test_the_request_has_a_short_timeout_and_follows_nothing() -> None:
    client = client_for(Receiver())
    http = client._http
    assert http.timeout.read == http.timeout.connect == 10.0
    assert http.follow_redirects is False
    assert http.trust_env is False  # no proxy or .netrc credentials


# --- Results and backoff (no database) -----------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        (200, "sent"),
        (400, "dead"),
        (409, "dead"),
        (413, "dead"),
        (422, "dead"),
        (408, "retry"),
        (429, "retry"),
        (500, "retry"),
        (502, "retry"),
        (503, "retry"),
        (504, "retry"),
        (404, "retry"),
        (403, "retry"),
        (302, "retry"),
    ],
)
def test_every_result_class(status: int, outcome: str) -> None:
    assert classify(status) == outcome


def test_the_backoff_schedule_with_twenty_percent_jitter() -> None:
    assert BACKOFF_SECONDS == (30, 120, 600, 3_600, 21_600, 43_200, 86_400)
    rng = random.Random(1)  # noqa: S311
    for attempt, base in enumerate(BACKOFF_SECONDS, start=1):
        delays = [backoff_seconds(attempt, rng, None) for _ in range(500)]
        assert min(delays) >= base * 0.8
        assert max(delays) <= base * 1.2
        assert max(delays) - min(delays) > base * 0.2  # it really varies
    # A failure past the table keeps the longest wait.
    assert 86_400 * 0.8 <= backoff_seconds(9, rng, None) <= 86_400 * 1.2


def test_retry_after_is_honoured_up_to_a_day() -> None:
    rng = random.Random(1)  # noqa: S311
    assert backoff_seconds(1, rng, 7_200) == 7_200  # longer than the 30 s
    assert backoff_seconds(1, rng, 5) <= 36  # shorter: the backoff stays
    assert backoff_seconds(1, rng, 10**9) == 86_400  # capped


def test_retry_after_forms() -> None:
    assert parse_retry_after("120", T0) == 120
    assert parse_retry_after("Wed, 11 Nov 2026 12:05:00 GMT", T0) == 300
    assert parse_retry_after("Wed, 11 Nov 2026 11:00:00 GMT", T0) == 0
    for value in (None, "", "soon", "-5", "1.5"):
        assert parse_retry_after(value, T0) is None


# --- A database ---------------------------------------------------------------------------------


@pytest.fixture
async def vendor_id(session: AsyncSession) -> uuid.UUID:
    row = await saved_vendor(session)
    vendor: uuid.UUID = row.id
    return vendor


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def clock() -> Clock:
    return Clock()


def shared(session: AsyncSession) -> Callable[[], Any]:
    """The test's session, one user at a time (production opens a session per step)."""
    lock = asyncio.Lock()

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncSession]:
        async with lock:
            yield session

    return open_session


def build(
    session: AsyncSession, receiver: Callable[..., Any], clock: Clock, **options: Any
) -> Publisher:
    http = CentralClient(URL, RequestSigner(KEY), transport=httpx.MockTransport(receiver))
    rng = random.Random(5)  # noqa: S311
    return Publisher(shared(session), http, clock=clock, rng=rng, **options)


async def event(session: AsyncSession, vendor: uuid.UUID, **changes: Any) -> OutboxEvent:
    values: dict[str, Any] = {
        "vendor_id": vendor,
        "aggregate_type": "product",
        "aggregate_id": uuid.uuid4(),
        "event_type": "product.published",
        "version": 1,
        "payload": {"sku": "KURTA-01"},
        "next_attempt_at": T0 - timedelta(minutes=1),
    }
    row = OutboxEvent(**{**values, **changes})
    session.add(row)
    await session.flush()
    return row


async def fresh(session: AsyncSession, row: OutboxEvent) -> OutboxEvent:
    result = await session.scalars(
        select(OutboxEvent)
        .where(OutboxEvent.id == row.id)
        .execution_options(populate_existing=True)
    )
    return result.one()


async def test_a_200_marks_the_event_sent(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    row = await event(session, vendor_id)
    receiver = Receiver()
    assert await build(session, receiver, clock).run_once() == 1
    done = await fresh(session, row)
    assert (done.status, done.attempts, done.locked_at, done.last_error) == ("sent", 1, None, None)
    assert done.sent_at == T0
    assert receiver.requests[0].headers["Idempotency-Key"] == str(row.id)
    # Nothing is left to send.
    assert await build(session, receiver, clock).run_once() == 0
    assert len(receiver.requests) == 1


@pytest.mark.parametrize("status", [400, 409, 413, 422])
async def test_a_permanent_answer_marks_the_event_dead_at_once(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock, status: int
) -> None:
    row = await event(session, vendor_id)
    receiver = Receiver((status, {}, {"error": {"code": "bad_event"}}))
    await build(session, receiver, clock).run_once()
    dead = await fresh(session, row)
    assert (dead.status, dead.attempts, dead.locked_at) == ("dead", 1, None)
    assert dead.last_error == f"HTTP {status}: bad_event"  # kept, so it can be inspected
    clock.advance(days=3)
    assert await build(session, receiver, clock).run_once() == 0  # and never sent again


@pytest.mark.parametrize(
    "answer",
    [408, 429, 500, 502, 503, 504, httpx.ReadTimeout("slow"), httpx.ConnectError("refused")],
)
async def test_a_temporary_failure_is_retried_later(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock, answer: Any
) -> None:
    row = await event(session, vendor_id)
    await build(session, Receiver(answer), clock).run_once()
    waiting = await fresh(session, row)
    assert (waiting.status, waiting.attempts, waiting.locked_at) == ("pending", 1, None)
    assert waiting.last_error is not None
    delay = (waiting.next_attempt_at - T0).total_seconds()
    assert 30 * 0.8 <= delay <= 30 * 1.2


async def test_an_event_is_not_sent_again_before_its_time(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    await event(session, vendor_id)
    receiver = Receiver(503)
    publisher = build(session, receiver, clock)
    await publisher.run_once()
    clock.advance(seconds=20)
    assert await publisher.run_once() == 0
    clock.advance(seconds=20)  # past 36 seconds, the longest first wait
    assert await publisher.run_once() == 1
    assert len(receiver.requests) == 2


async def test_a_failing_event_is_tried_eight_times_and_then_dead(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    row = await event(session, vendor_id)
    receiver = Receiver(*[503] * 20)
    publisher = build(session, receiver, clock)
    waits: list[float] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        assert await publisher.run_once() == 1
        current = await fresh(session, row)
        assert current.attempts == attempt
        if current.status == "pending":
            waits.append((current.next_attempt_at - clock.now).total_seconds())
            clock.now = current.next_attempt_at
    last = await fresh(session, row)
    assert last.status == "dead"
    assert "HTTP 503" in (last.last_error or "") and "8 attempts" in (last.last_error or "")
    assert len(receiver.requests) == 8
    assert len(waits) == 7  # a wait after each of the first seven failures
    for wait, base in zip(waits, BACKOFF_SECONDS, strict=True):
        assert base * 0.8 <= wait <= base * 1.2
    clock.advance(days=10)
    assert await publisher.run_once() == 0


async def test_retry_after_pushes_the_next_attempt_out(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    row = await event(session, vendor_id)
    await build(session, Receiver((429, {"Retry-After": "7200"}, {})), clock).run_once()
    assert (await fresh(session, row)).next_attempt_at >= T0 + timedelta(hours=2)


async def test_a_later_version_waits_for_a_failing_earlier_one(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    first = await event(session, vendor_id, version=1)
    await event(session, vendor_id, aggregate_id=first.aggregate_id, version=2)
    receiver = Receiver(503)
    publisher = build(session, receiver, clock)
    await publisher.run_once()
    assert receiver.versions == [1]  # version 2 was not tried
    clock.advance(seconds=10)
    assert await publisher.run_once() == 0  # still waiting behind it
    clock.advance(hours=1)
    assert await publisher.run_once() == 1  # version 1 goes out ...
    assert await publisher.run_once() == 1  # ... and only then version 2
    assert receiver.versions == [1, 1, 2]


async def test_a_dead_version_does_not_block_the_next(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    first = await event(session, vendor_id, version=1)
    second = await event(session, vendor_id, aggregate_id=first.aggregate_id, version=2)
    receiver = Receiver(422)
    publisher = build(session, receiver, clock)
    await publisher.run_once()
    await publisher.run_once()
    assert receiver.versions == [1, 2]
    assert (await fresh(session, first)).status == "dead"
    assert (await fresh(session, second)).status == "sent"


async def test_one_batch_sends_different_aggregates_together_and_a_version_at_a_time(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    a1 = await event(session, vendor_id, version=1)
    await event(session, vendor_id, aggregate_id=a1.aggregate_id, version=2)
    others = [await event(session, vendor_id) for _ in range(3)]
    receiver = Receiver()
    publisher = build(session, receiver, clock)
    assert await publisher.run_once() == 4  # a1 v1 and the three others, not a1 v2
    assert sorted(receiver.versions) == [1, 1, 1, 1]
    assert {r.headers["Idempotency-Key"] for r in receiver.requests} == {
        str(a1.id),
        *(str(o.id) for o in others),
    }
    assert await publisher.run_once() == 1  # now version 2


async def test_a_batch_is_bounded(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    for _ in range(5):
        await event(session, vendor_id)
    receiver = Receiver()
    publisher = build(session, receiver, clock, batch_size=2)
    assert [await publisher.run_once() for _ in range(3)] == [2, 2, 1]
    assert len(receiver.requests) == 5


# --- Five 401s ----------------------------------------------------------------------------------


async def test_five_unauthorized_answers_in_a_row_pause_publishing(
    session: AsyncSession,
    vendor_id: uuid.UUID,
    clock: Clock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    rows = [await event(session, vendor_id) for _ in range(6)]
    receiver = Receiver(*[401] * 5, 200)
    publisher = build(session, receiver, clock, batch_size=1)
    with caplog.at_level(logging.ERROR):
        for _ in range(4):
            assert await publisher.run_once() == 1
        assert not publisher.paused
        assert "publishing paused" not in caplog.text
        assert await publisher.run_once() == 1  # the fifth
    assert publisher.paused
    assert "publishing paused" in caplog.text and "CENTRAL_SIGNING_KEY_ID" in caplog.text

    # No event was killed by it: all are pending, and none used up an attempt.
    waiting = [await fresh(session, row) for row in rows]
    assert {(r.status, r.attempts) for r in waiting} == {("pending", 0)}
    assert sum(r.last_error == "HTTP 401" for r in waiting) == 5

    # Paused: nothing is sent, not even the due events.
    sent = len(receiver.requests)
    clock.advance(seconds=120)
    assert await publisher.run_once() == 0
    assert len(receiver.requests) == sent

    # After a while it tries one event; an answer that is not a 401 ends the pause.
    clock.advance(seconds=300)
    assert await publisher.run_once() == 1
    assert not publisher.paused
    assert len(receiver.requests) == sent + 1


async def test_a_pause_continues_while_the_probe_is_refused(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    for _ in range(5):
        await event(session, vendor_id)
    receiver = Receiver(*[401] * 8)
    publisher = build(session, receiver, clock, batch_size=1)
    for _ in range(5):
        await publisher.run_once()
    assert publisher.paused
    clock.advance(seconds=301)
    assert await publisher.run_once() == 1  # one probe, refused again
    assert publisher.paused
    assert await publisher.run_once() == 0  # and the next probe is later
    assert len(receiver.requests) == 6


async def test_another_answer_resets_the_count_of_unauthorized(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    for _ in range(8):
        await event(session, vendor_id)
    receiver = Receiver(401, 401, 401, 401, 200, 401, 401, 401, 401)
    publisher = build(session, receiver, clock, batch_size=1)
    for _ in range(8):
        await publisher.run_once()
    assert not publisher.paused  # four, a success, four: never five in a row


# --- The sweeper and the cleanup ------------------------------------------------------------------


async def test_the_sweeper_gives_back_only_what_is_stuck(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    stuck = await event(session, vendor_id, status="sending", locked_at=T0 - timedelta(minutes=3))
    busy = await event(session, vendor_id, status="sending", locked_at=T0 - timedelta(seconds=90))
    last_try = await event(
        session,
        vendor_id,
        status="sending",
        locked_at=T0 - timedelta(minutes=5),
        attempts=MAX_ATTEMPTS,
    )
    given_back, removed = await build(session, Receiver(), clock).maintain()
    assert (given_back, removed) == (2, 0)
    assert (await fresh(session, stuck)).status == "pending"
    assert (await fresh(session, stuck)).locked_at is None
    assert (await fresh(session, busy)).status == "sending"
    dead = await fresh(session, last_try)
    assert dead.status == "dead" and "worker stopped" in (dead.last_error or "")


async def test_a_swept_event_is_sent_again(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    row = await event(session, vendor_id, status="sending", locked_at=T0 - timedelta(minutes=3))
    receiver = Receiver()
    publisher = build(session, receiver, clock)
    await publisher.maintain()
    assert await publisher.run_once() == 1
    assert (await fresh(session, row)).status == "sent"


async def test_sent_rows_go_after_thirty_days_and_nothing_else_does(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    old = T0 - timedelta(days=31)
    recent = T0 - timedelta(days=29)
    gone = await event(session, vendor_id, status="sent", created_at=old, sent_at=old)
    kept_recent = await event(session, vendor_id, status="sent", created_at=recent, sent_at=recent)
    old_dead = await event(
        session, vendor_id, status="dead", created_at=old, last_error="HTTP 422: bad_event"
    )
    old_pending = await event(session, vendor_id, created_at=old)
    _, removed = await build(session, Receiver(), clock).maintain()
    assert removed == 1
    remaining = set(await session.scalars(select(OutboxEvent.id)))
    assert gone.id not in remaining
    assert {kept_recent.id, old_dead.id, old_pending.id} <= remaining


# --- Shutting down -------------------------------------------------------------------------------


async def test_a_claim_not_started_when_stopping_is_given_back(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    row = await event(session, vendor_id)
    receiver = Receiver()
    stop = asyncio.Event()
    stop.set()
    assert await build(session, receiver, clock).run_once(stop) == 1
    assert receiver.requests == []
    back = await fresh(session, row)
    assert (back.status, back.attempts, back.locked_at) == ("pending", 0, None)


async def test_the_request_in_flight_finishes_before_the_worker_stops(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    row = await event(session, vendor_id)
    started = asyncio.Event()

    async def slow(request: httpx.Request) -> httpx.Response:
        started.set()
        await asyncio.sleep(0.2)
        return httpx.Response(200, json={"status": "accepted"})

    stop = asyncio.Event()
    task = asyncio.create_task(build(session, slow, clock).run(stop))
    await asyncio.wait_for(started.wait(), 5)
    stop.set()  # while the request is out
    await asyncio.wait_for(task, 5)
    assert (await fresh(session, row)).status == "sent"


async def test_the_loop_keeps_going_when_the_database_fails_once(
    session: AsyncSession,
    vendor_id: uuid.UUID,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = await event(session, vendor_id)
    publisher = build(session, Receiver(), clock)
    real = publisher.run_once
    calls: list[int] = []

    async def flaky(stop: asyncio.Event | None = None) -> int:
        calls.append(1)
        if len(calls) == 1:
            raise OSError("database gone")
        return await real(stop)

    monkeypatch.setattr(publisher, "run_once", flaky)
    monkeypatch.setattr(publisher_module, "POLL_SECONDS", 0.01)
    stop = asyncio.Event()
    task = asyncio.create_task(publisher.run(stop))
    for _ in range(300):
        if (await fresh(session, row)).status == "sent":
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, 5)
    assert (await fresh(session, row)).status == "sent"


# --- Two workers ---------------------------------------------------------------------------------


async def test_two_workers_never_claim_the_same_row(migrated_db: str) -> None:
    """Two real connections, with the first claim still open: the second skips what it holds."""
    engine = create_async_engine(async_url(migrated_db), poolclass=NullPool)
    ids: list[uuid.UUID] = []
    vendor: uuid.UUID | None = None
    try:
        async with AsyncSession(engine, expire_on_commit=False) as setup:
            vendor_row = await saved_vendor(setup)
            vendor = vendor_row.id
            for _ in range(6):
                row = await event(setup, vendor)
                ids.append(row.id)
            await setup.commit()
        async with (
            AsyncSession(engine, expire_on_commit=False) as one,
            AsyncSession(engine, expire_on_commit=False) as two,
        ):
            mine = {r[0] for r in await one.execute(CLAIM, {"now": T0, "limit": 4})}
            theirs = {r[0] for r in await two.execute(CLAIM, {"now": T0, "limit": 4})}
            assert len(mine) == 4
            assert mine.isdisjoint(theirs)  # nothing was claimed twice
            assert len(theirs) == 2  # and the rest was not left behind
            assert mine | theirs == set(ids)
            await one.rollback()
            await two.rollback()
    finally:
        async with AsyncSession(engine) as cleanup:
            await cleanup.execute(delete(OutboxEvent).where(OutboxEvent.id.in_(ids)))
            if vendor is not None:
                await cleanup.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor})
            await cleanup.commit()
        await engine.dispose()


# --- The worker program --------------------------------------------------------------------------


async def test_with_publishing_off_the_worker_idles_and_says_so(
    override: Callable[..., Settings],
    settings: Settings,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = override(settings, central_publishing_enabled=False)
    stop = asyncio.Event()
    stop.set()
    with caplog.at_level(logging.WARNING):
        await asyncio.wait_for(run_worker(settings, stop), 5)
    assert "CENTRAL_PUBLISHING_ENABLED is off" in caplog.text


def test_an_answer_carries_what_the_recorder_needs() -> None:
    assert Answer(None, "timeout") == Answer(None, "timeout", None)
