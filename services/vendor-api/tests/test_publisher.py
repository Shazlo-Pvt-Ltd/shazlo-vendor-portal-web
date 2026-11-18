"""The publisher worker (ADR 0003, sections 3 to 5), against a fake central app.

The database tests hand the publisher the test's own session (one at a time: a lock stands in for
the separate transactions it opens in production), so a rolled-back test leaves nothing behind.
The one test of two real workers uses its own committed rows and removes them.
"""

import asyncio
import json
import logging
import os
import random
import signal
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
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

from vendor_api import worker as worker_module
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
from vendor_api.worker import describe, install_signal_handlers
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
        "claim_token": uuid.uuid4(),
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
    body = {"message": "x" * 5000, "extra": {"code": "schema_invalid"}}
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
    assert publisher_module.STALE_AFTER.total_seconds() / 2 > publisher_module.SEND_DEADLINE


async def test_a_cookie_the_central_app_sets_is_never_sent_back() -> None:
    receiver = Receiver(
        (200, {"Set-Cookie": "session=abc123; Path=/; Domain=central.test"}, {"status": "ok"}),
        (200, {"Set-Cookie": "other=1"}, {"status": "ok"}),
    )
    client = client_for(receiver)
    for _ in range(3):
        await client.send(claimed())
    assert len(receiver.requests) == 3
    assert all("cookie" not in request.headers for request in receiver.requests)
    assert len(client._http.cookies.jar) == 0  # nothing was even kept
    await client.close()


class Trickle(httpx.AsyncByteStream):
    """An answer that never ends, a little at a time: every step is quick, so HTTPX's per-step
    timeouts never fire."""

    def __init__(self, pause: float = 0.01) -> None:
        self.pause = pause
        self.chunks = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        while True:
            await asyncio.sleep(self.pause)
            self.chunks += 1
            yield b"x" * 100


async def test_an_answer_that_trickles_in_is_cut_off_at_the_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(publisher_module, "SEND_DEADLINE", 0.2)
    trickle = Trickle()
    client = client_for(lambda request: httpx.Response(200, stream=trickle))
    started = asyncio.get_running_loop().time()
    answer = await asyncio.wait_for(client.send(claimed()), 5)
    await client.close()
    assert (answer.status, answer.reason) == (None, "timeout")
    assert 0.15 <= asyncio.get_running_loop().time() - started < 2
    assert trickle.chunks >= 2  # it really was answering the whole time


async def test_a_response_that_never_starts_is_cut_off_at_the_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(publisher_module, "SEND_DEADLINE", 0.1)

    async def silent(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(30)
        return httpx.Response(200)

    client = client_for(silent)
    answer = await asyncio.wait_for(client.send(claimed()), 5)
    await client.close()
    assert (answer.status, answer.reason) == (None, "timeout")


async def test_only_the_start_of_an_answer_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(publisher_module, "MAX_RESPONSE_BYTES", 1_000)
    trickle = Trickle(pause=0)
    client = client_for(lambda request: httpx.Response(413, stream=trickle))
    answer = await asyncio.wait_for(client.send(claimed()), 5)
    await client.close()
    assert (answer.status, answer.reason) == (413, "HTTP 413")  # not JSON, and not read to the end
    assert trickle.chunks <= 11


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
    for value in (None, "", "soon", "-5", "1.5", "²", "٣"):
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
    receiver = Receiver((status, {}, {"message": "no", "extra": {"code": "bad_event"}}))
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
    stuck = await event(
        session,
        vendor_id,
        status="sending",
        locked_at=T0 - timedelta(minutes=3),
        claim_token=uuid.uuid4(),
    )
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
    assert (await fresh(session, stuck)).claim_token is None
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


async def test_old_sent_rows_go_after_thirty_days_but_the_latest_of_each_aggregate_stays(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    old = T0 - timedelta(days=31)
    recent = T0 - timedelta(days=29)

    def sent(**changes: Any) -> Any:
        return event(session, vendor_id, status="sent", created_at=old, sent_at=old, **changes)

    # Three old versions of one aggregate: only the last, which the outbox writer reads to know
    # what the central app holds, is kept.
    first = await sent(version=1)
    second = await sent(aggregate_id=first.aggregate_id, version=2)
    third = await sent(aggregate_id=first.aggregate_id, version=3)
    # An aggregate with one old row keeps it, and so does a brand page or a vendor.
    alone = await sent()
    # An old row with a newer one still unsent is not the latest: it goes.
    behind = await sent(version=1)
    await event(session, vendor_id, aggregate_id=behind.aggregate_id, version=2, created_at=old)
    # An old row with a newer dead one: same.
    before_dead = await sent(version=1)
    await event(
        session,
        vendor_id,
        aggregate_id=before_dead.aggregate_id,
        version=2,
        status="dead",
        created_at=old,
        last_error="HTTP 422: bad_event",
    )
    # Recent rows, and old ones that are not `sent`, are not touched.
    kept_recent = await event(
        session, vendor_id, status="sent", created_at=recent, sent_at=recent, version=1
    )
    kept_recent_newer = await event(
        session,
        vendor_id,
        aggregate_id=kept_recent.aggregate_id,
        status="sent",
        created_at=recent,
        sent_at=recent,
        version=2,
    )
    old_dead = await event(
        session, vendor_id, status="dead", created_at=old, last_error="HTTP 422: bad_event"
    )
    old_pending = await event(session, vendor_id, created_at=old)

    _, removed = await build(session, Receiver(), clock).maintain()

    assert removed == 4  # first, second, behind, before_dead
    remaining = set(await session.scalars(select(OutboxEvent.id)))
    assert not {first.id, second.id, behind.id, before_dead.id} & remaining
    assert {
        third.id,
        alone.id,
        kept_recent.id,
        kept_recent_newer.id,
        old_dead.id,
        old_pending.id,
    } <= remaining
    # A second run has nothing more to do.
    assert (await build(session, Receiver(), clock).maintain())[1] == 0


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
    receiver = Receiver()
    publisher = build(session, receiver, clock)
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
    for _ in range(300):  # the session is the publisher's while it runs: watch the receiver
        if receiver.requests:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, 5)
    assert len(calls) >= 2  # the failure did not end the loop
    assert (await fresh(session, row)).status == "sent"


# --- A worker that is late ----------------------------------------------------------------------


LATE_RESULTS = [
    pytest.param(Answer(200, "HTTP 200"), id="sent"),
    pytest.param(Answer(503, "HTTP 503"), id="retry"),
    pytest.param(Answer(None, "timeout"), id="timeout"),
    pytest.param(Answer(422, "HTTP 422: schema_invalid"), id="dead"),
    pytest.param(Answer(401, "HTTP 401"), id="unauthorized"),
    pytest.param(None, id="released-on-shutdown"),
]


@pytest.mark.parametrize("late", LATE_RESULTS)
async def test_a_late_result_does_not_touch_a_row_another_worker_has_claimed(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock, late: Answer | None
) -> None:
    """Worker A's request outlives the sweeper: the row is reset, and worker B claims it. Whatever
    A reports then, B keeps its claim, and the next version of the aggregate stays blocked."""
    row = await event(session, vendor_id)
    await event(session, vendor_id, aggregate_id=row.aggregate_id, version=2)
    receiver = Receiver()
    worker_a = build(session, receiver, clock)
    worker_b = build(session, receiver, clock)
    (held_by_a,) = await worker_a._claim(clock.now, 20)
    assert held_by_a.id == row.id

    clock.advance(minutes=3)
    assert await worker_b.maintain() == (1, 0)  # the sweeper gives the row back ...
    (held_by_b,) = await worker_b._claim(clock.now, 20)  # ... and B claims it
    assert held_by_b.id == row.id
    assert held_by_b.claim_token != held_by_a.claim_token

    if late is None:
        await worker_a._release(held_by_a)
    else:
        await worker_a._record(held_by_a, late)

    mine = await fresh(session, row)
    assert (mine.status, mine.claim_token, mine.attempts) == ("sending", held_by_b.claim_token, 2)
    assert mine.locked_at == clock.now and mine.sent_at is None and mine.last_error is None
    assert await worker_a.run_once() == 0  # version 2 still waits for version 1

    await worker_b._record(held_by_b, Answer(200, "HTTP 200"))  # B finishes as usual
    done = await fresh(session, row)
    assert (done.status, done.claim_token, done.sent_at) == ("sent", None, clock.now)
    assert await worker_a.run_once() == 1  # and only now version 2 goes out
    assert receiver.versions == [2]


async def test_a_result_is_not_recorded_twice(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    row = await event(session, vendor_id)
    worker = build(session, Receiver(), clock)
    (held,) = await worker._claim(clock.now, 20)
    await worker._record(held, Answer(503, "HTTP 503"))
    waiting = await fresh(session, row)
    assert (waiting.status, waiting.claim_token) == ("pending", None)
    with caplog.at_level(logging.INFO):
        await worker._record(held, Answer(200, "HTTP 200"))  # the claim is over
    assert (await fresh(session, row)).status == "pending"
    assert "no longer ours" in caplog.text
    assert "event sent" not in caplog.text  # and it does not claim a success it did not record


async def test_a_slow_worker_finishing_after_the_sweeper_does_not_overwrite_the_new_claim(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    """The same, with real requests: A's is held open while the sweeper and B go by."""
    row = await event(session, vendor_id)
    gates = {name: asyncio.Event() for name in ("a_in", "a_go", "b_in", "b_go")}

    def answering(entered: str, release: str) -> Callable[[httpx.Request], Any]:
        async def handler(request: httpx.Request) -> httpx.Response:
            gates[entered].set()
            await gates[release].wait()
            return httpx.Response(200, json={"status": "accepted"})

        return handler

    worker_a = build(session, answering("a_in", "a_go"), clock)
    worker_b = build(session, answering("b_in", "b_go"), clock)
    task_a = asyncio.create_task(worker_a.run_once())
    await asyncio.wait_for(gates["a_in"].wait(), 5)

    clock.advance(minutes=3)
    assert await worker_b.maintain() == (1, 0)
    task_b = asyncio.create_task(worker_b.run_once())
    await asyncio.wait_for(gates["b_in"].wait(), 5)
    token_b = (await fresh(session, row)).claim_token
    assert token_b is not None

    gates["a_go"].set()  # A's answer arrives while B's request is still out
    assert await asyncio.wait_for(task_a, 5) == 1
    held = await fresh(session, row)
    assert (held.status, held.claim_token, held.attempts) == ("sending", token_b, 2)

    gates["b_go"].set()
    assert await asyncio.wait_for(task_b, 5) == 1
    assert (await fresh(session, row)).status == "sent"


async def test_an_unexpected_error_while_sending_is_retried_like_any_failure(
    session: AsyncSession,
    vendor_id: uuid.UUID,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    broken = await event(session, vendor_id)
    fine = await event(session, vendor_id)
    receiver = Receiver()
    publisher = build(session, receiver, clock)
    real = publisher._client.send

    async def send(item: Claimed) -> Answer:
        if item.id == broken.id:
            raise RuntimeError("signing failed")
        return await real(item)

    monkeypatch.setattr(publisher._client, "send", send)
    assert await publisher.run_once() == 2
    assert (await fresh(session, fine)).status == "sent"  # the batch did not stop
    waiting = await fresh(session, broken)
    assert (waiting.status, waiting.last_error, waiting.claim_token) == (
        "pending",
        "internal error",
        None,
    )


async def test_a_claim_gets_a_token_of_its_own(
    session: AsyncSession, vendor_id: uuid.UUID, clock: Clock
) -> None:
    rows = [await event(session, vendor_id) for _ in range(3)]
    claimed_rows = await build(session, Receiver(), clock)._claim(clock.now, 20)
    assert len({c.claim_token for c in claimed_rows}) == 3
    for row in rows:
        assert (await fresh(session, row)).claim_token in {c.claim_token for c in claimed_rows}


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


async def test_the_signal_handlers_fall_back_where_the_event_loop_has_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Windows' event loops raise NotImplementedError from `add_signal_handler`."""
    loop = asyncio.get_running_loop()

    def unsupported(*args: Any) -> None:
        raise NotImplementedError

    registered: dict[int, Callable[[int, Any], None]] = {}
    monkeypatch.setattr(loop, "add_signal_handler", unsupported)
    monkeypatch.setattr(
        signal,
        "signal",
        lambda signum, handler: registered.setdefault(signum, handler),
    )
    stop = asyncio.Event()
    install_signal_handlers(loop, stop)
    assert set(registered) == {signal.SIGTERM, signal.SIGINT}
    assert not stop.is_set()
    registered[signal.SIGTERM](signal.SIGTERM, None)
    await asyncio.wait_for(stop.wait(), 5)


def test_a_failure_prints_one_line_with_a_reason(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fails() -> None:
        raise NotImplementedError  # an exception with no message at all

    monkeypatch.setattr(worker_module, "main", fails)
    assert worker_module.cli() == 1
    assert capsys.readouterr().err == "worker failed: NotImplementedError\n"
    assert describe(ValueError("no way")) == "ValueError: no way"


def test_a_bad_setting_stops_the_worker_without_printing_the_value(tmp_path: Path) -> None:
    password = "Sup3rSecretPassw0rd"
    secret = "Hunter2-central-secret-0123456789abcdef"
    env = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith(("DATABASE_", "REDIS_", "CENTRAL_", "JWT_", "OUTBOX_"))
    }
    env.update(
        DATABASE_URL=f"postgres://shazlo:{password}@db.internal:5432/vendor",  # not postgresql://
        REDIS_URL="redis://localhost:6379/0",
        CENTRAL_API_URL=f"https://shazlo:{password}@central.example",
        CENTRAL_SIGNING_SECRET=secret,
    )
    done = subprocess.run(  # noqa: S603 (our own interpreter and module)
        [sys.executable, "-m", "vendor_api.worker"],
        cwd=tmp_path,  # no `.env` here
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 1
    assert done.stderr.startswith("worker failed: ValidationError")
    assert "database_url" in done.stderr and "must start with" in done.stderr
    for private in (password, "Sup3rS", secret, "db.internal", "central.example"):
        assert private not in done.stderr + done.stdout
    assert "Traceback" not in done.stderr


def test_an_answer_carries_what_the_recorder_needs() -> None:
    assert Answer(None, "timeout") == Answer(None, "timeout", None)
