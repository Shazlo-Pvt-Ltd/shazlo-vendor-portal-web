"""Reconciliation and resync (ADR 0003, section 6), against a fake central app.

The fake is a dictionary of what the central app holds. A test "delivers" the outbox by marking its
rows sent and copying them into that dictionary, which is what the publisher and a healthy central
app do between two nightly runs.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, time, timedelta
from typing import Any

import httpx
import pytest
from conftest import Tenants
from review_builders import profile, submitted_product
from shazlo_security.signing import (
    KEY_ID_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    RequestSigner,
    SigningKey,
    sign,
)
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api import cli
from vendor_api.core.settings import Settings
from vendor_api.db.models import OutboxEvent, Product, Vendor, VendorStatusEvent
from vendor_api.services.outbox import OutboxWriter
from vendor_api.services.publisher import CentralClient, CentralError
from vendor_api.services.reconciliation import (
    AGGREGATE_TYPES,
    PUBLISHED,
    UNPUBLISHED,
    Facts,
    Held,
    Reconciler,
    Report,
    Scope,
    decide,
    next_version,
    run_nightly,
    seconds_until,
)

T0 = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)
KEY = SigningKey("k1", b"s" * 32)


def ident() -> uuid.UUID:
    return uuid.uuid4()


# --- The decision (no database) ------------------------------------------------------------------


def facts(wanted: str = PUBLISHED, **changes: Any) -> Facts:
    values: dict[str, Any] = {
        "aggregate_type": "product",
        "aggregate_id": ident(),
        "vendor_id": ident(),
        "wanted": wanted,
        "own_version": 1,
        "last_version": None,
        "last_state": None,
        "in_flight": False,
        "reason": "archived",
    }
    return Facts(**{**values, **changes})


@pytest.mark.parametrize(
    ("wanted", "last", "held", "expected"),
    [
        # published here
        (PUBLISHED, None, None, 1),  # the central app has nothing: first sync, the own version
        (PUBLISHED, 3, None, 4),  # missing: past the last event
        (PUBLISHED, 3, Held(2, PUBLISHED), 4),  # behind
        (PUBLISHED, 3, Held(3, PUBLISHED), None),  # in step
        (PUBLISHED, 3, Held(9, PUBLISHED), None),  # ahead: left alone
        (PUBLISHED, 3, Held(3, UNPUBLISHED), 4),  # hidden there, shown here
        (PUBLISHED, 3, Held(7, UNPUBLISHED), 8),  # and never at a version it would ignore
        # hidden here
        (UNPUBLISHED, 3, Held(3, PUBLISHED), 4),  # still shown there
        (UNPUBLISHED, 3, Held(8, PUBLISHED), 9),
        (UNPUBLISHED, 3, Held(3, UNPUBLISHED), None),
        (UNPUBLISHED, 3, None, None),  # they do not know it: nothing to hide
    ],
)
def test_what_reconciliation_does(
    wanted: str, last: int | None, held: Held | None, expected: int | None
) -> None:
    one = facts(wanted, last_version=last, last_state=PUBLISHED if last else None)
    assert decide(one, held, reconcile=True) == expected


def test_an_aggregate_with_an_event_on_its_way_is_left_alone() -> None:
    waiting = facts(last_version=2, in_flight=True)
    assert decide(waiting, None, reconcile=True) is None
    assert decide(waiting, None, reconcile=False) is None


@pytest.mark.parametrize(
    ("wanted", "last", "last_state", "expected"),
    [
        (PUBLISHED, None, None, 1),  # a catalog from before the outbox: the first sync
        (PUBLISHED, 4, PUBLISHED, 5),  # again, at a new version
        (PUBLISHED, 4, UNPUBLISHED, 5),
        (UNPUBLISHED, 4, PUBLISHED, 5),  # it was shown and is not now
        (UNPUBLISHED, 4, UNPUBLISHED, None),  # it is hidden already
        (UNPUBLISHED, None, None, None),  # it never was shown
    ],
)
def test_what_a_resync_does(
    wanted: str, last: int | None, last_state: str | None, expected: int | None
) -> None:
    assert (
        decide(facts(wanted, last_version=last, last_state=last_state), None, reconcile=False)
        == expected
    )


def test_a_version_is_above_everything_known() -> None:
    assert next_version(facts(own_version=7, last_version=3), Held(2, PUBLISHED)) == 7
    assert next_version(facts(own_version=1, last_version=3), Held(9, PUBLISHED)) == 10
    assert next_version(facts(own_version=1, last_version=None), None) == 1


def test_the_time_to_the_next_run() -> None:
    at = time(3, 0)
    assert seconds_until(at, datetime(2026, 11, 11, 2, 0, tzinfo=UTC)) == 3_600
    assert (
        seconds_until(at, datetime(2026, 11, 11, 3, 0, tzinfo=UTC)) == 86_400
    )  # not now: tomorrow
    assert seconds_until(at, datetime(2026, 11, 11, 4, 0, tzinfo=UTC)) == 23 * 3_600


async def test_the_nightly_job_runs_at_its_time_and_survives_a_failed_run(
    caplog: pytest.LogCaptureFixture,
) -> None:
    runs: list[int] = []
    stop = asyncio.Event()

    class Fake:
        async def reconcile(self) -> Report:
            runs.append(1)
            if len(runs) == 1:
                raise CentralError("the central app is down")
            if len(runs) == 2:
                stop.set()
            return Report()

    def almost_three() -> datetime:
        return datetime(2026, 11, 11, 2, 59, 59, 990_000, tzinfo=UTC)

    with caplog.at_level(logging.ERROR):
        await asyncio.wait_for(run_nightly(Fake(), time(3, 0), stop, almost_three), 5)  # type: ignore[arg-type]
    assert len(runs) == 2  # the failure did not end it
    assert "reconciliation failed" in caplog.text


@pytest.mark.parametrize("value", ["03:00", "00:00", "23:59", "7:30".rjust(5, "0")])
def test_reconcile_at_accepts_a_time_of_day(settings: Settings, value: str) -> None:
    assert (
        Settings.model_validate({**settings.model_dump(), "reconcile_at": value}).reconcile_at
        == value
    )


@pytest.mark.parametrize("value", ["", "3am", "24:00", "12:60", "12:5", "12:00:00"])
def test_reconcile_at_refuses_anything_else(settings: Settings, value: str) -> None:
    with pytest.raises(ValueError, match="RECONCILE_AT"):
        Settings.model_validate({**settings.model_dump(), "reconcile_at": value})


# --- Asking the central app (no database) --------------------------------------------------------


def versions_client(handler: Callable[[httpx.Request], httpx.Response]) -> CentralClient:
    return CentralClient(
        "https://central.test",
        RequestSigner(KEY, clock=lambda: 1_700_000_000),
        transport=httpx.MockTransport(handler),
    )


async def test_the_versions_are_read_page_by_page_with_a_signed_empty_body() -> None:
    first, second = ident(), ident()
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body: dict[str, Any]
        if request.url.params.get("cursor") is None:
            body = {
                "items": [{"aggregate_id": str(first), "version": 3, "state": "published"}],
                "next_cursor": "c1",
            }
        else:
            body = {
                "items": [{"aggregate_id": str(second), "version": 1, "state": "unpublished"}],
                "next_cursor": None,
            }
        return httpx.Response(200, json=body)

    client = versions_client(handler)
    held = await client.versions("product")
    await client.close()
    assert held == {first: (3, "published"), second: (1, "unpublished")}
    assert [r.url.params.get("cursor") for r in seen] == [None, "c1"]
    request = seen[0]
    assert request.method == "GET"
    assert request.url.path == "/internal/v1/versions"
    assert request.url.params["aggregate_type"] == "product"
    assert request.url.params["limit"] == "500"
    assert request.content == b""
    assert request.headers[KEY_ID_HEADER] == "k1"
    assert request.headers[TIMESTAMP_HEADER] == "1700000000"
    assert request.headers[SIGNATURE_HEADER] == sign(b"s" * 32, 1_700_000_000, b"")


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(401, json={"error": {"code": "bad_signature"}}),
        httpx.Response(503),
        httpx.Response(200, json={"oops": True}),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"items": [{"aggregate_id": "x", "version": 1, "state": "p"}]}),
    ],
)
async def test_an_unusable_answer_stops_the_run_with_a_clear_error(answer: httpx.Response) -> None:
    client = versions_client(lambda request: answer)
    with pytest.raises(CentralError):
        await client.versions("vendor")
    await client.close()


async def test_an_unreachable_central_app_is_a_central_error() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    client = versions_client(refuse)
    with pytest.raises(CentralError, match="ConnectError"):
        await client.versions("vendor")
    await client.close()


# --- A database ----------------------------------------------------------------------------------


class FakeCentral:
    """What the central app holds, per aggregate type."""

    def __init__(self) -> None:
        self.held: dict[str, dict[uuid.UUID, tuple[int, str]]] = {k: {} for k in AGGREGATE_TYPES}
        self.error: str | None = None
        self.asked: list[str] = []

    async def versions(self, aggregate_type: str) -> dict[uuid.UUID, tuple[int, str]]:
        self.asked.append(aggregate_type)
        if self.error:
            raise CentralError(self.error)
        return dict(self.held[aggregate_type])

    def hold(self, kind: str, aggregate_id: uuid.UUID, version: int, state: str) -> None:
        self.held[kind][aggregate_id] = (version, state)

    def receive(self, rows: list[OutboxEvent]) -> None:
        for row in rows:
            if row.aggregate_type == "vendor":
                state = PUBLISHED if row.payload.get("status") == "approved" else UNPUBLISHED
            else:
                state = PUBLISHED if row.event_type.endswith(".published") else UNPUBLISHED
            current = self.held[row.aggregate_type].get(row.aggregate_id)
            if current is None or row.version > current[0]:
                self.hold(row.aggregate_type, row.aggregate_id, row.version, state)


def shared(session: AsyncSession) -> Callable[[], Any]:
    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncSession]:
        yield session

    return open_session


def reconciler(
    session: AsyncSession, central: FakeCentral | None = None, **options: Any
) -> Reconciler:
    options.setdefault("pause", 0)
    return Reconciler(
        shared(session),
        OutboxWriter(True),
        central,
        clock=lambda: T0,
        **options,
    )


async def outbox(session: AsyncSession) -> list[OutboxEvent]:
    rows = await session.scalars(
        select(OutboxEvent)
        .order_by(OutboxEvent.aggregate_type, OutboxEvent.aggregate_id, OutboxEvent.version)
        .execution_options(populate_existing=True)
    )
    return list(rows)


def shown(rows: list[OutboxEvent]) -> set[tuple[str, int]]:
    return {(row.event_type, row.version) for row in rows}


async def deliver(session: AsyncSession, central: FakeCentral) -> None:
    """The publisher and a healthy central app: every waiting event is sent and held there."""
    waiting = [r for r in await outbox(session) if r.status == "pending"]
    ids = [row.id for row in waiting]
    if ids:
        await session.execute(
            update(OutboxEvent)
            .where(OutboxEvent.id.in_(ids))
            .values(status="sending", locked_at=T0)
        )
        await session.execute(
            update(OutboxEvent)
            .where(OutboxEvent.id.in_(ids))
            .values(status="sent", locked_at=None, sent_at=T0)
        )
    central.receive(waiting)


async def put_event(
    session: AsyncSession,
    vendor_id: uuid.UUID,
    kind: str,
    aggregate_id: uuid.UUID,
    version: int,
    event_type: str,
    **payload: Any,
) -> OutboxEvent:
    """An event that was written and sent in the past."""
    row = OutboxEvent(
        vendor_id=vendor_id,
        aggregate_type=kind,
        aggregate_id=aggregate_id,
        event_type=event_type,
        version=version,
        payload=payload or {"x": 1},
        status="sent",
        sent_at=T0 - timedelta(days=1),
        next_attempt_at=T0 - timedelta(days=1),
    )
    session.add(row)
    await session.flush()
    return row


async def live_product(
    session: AsyncSession, tenants: Tenants, sku: str, vendor: str = "a"
) -> Product:
    tenant = tenants.a if vendor == "a" else tenants.b
    product, revision = await submitted_product(session, tenant, sku, 1)
    product.live_revision_id = revision.id
    product.status = "approved"
    await session.flush()
    return product


@pytest.fixture
async def world(tenants: Tenants, session: AsyncSession) -> Tenants:
    """Vendor A approved with a published brand page; vendor B still pending."""
    await session.execute(
        update(Vendor).where(Vendor.id == tenants.a.vendor.id).values(status="approved")
    )
    await session.execute(
        update(Vendor).where(Vendor.id == tenants.b.vendor.id).values(status="pending")
    )
    await profile(session, tenants.a, 1, "published")
    await session.commit()
    return tenants


async def test_what_the_central_app_is_missing_is_sent(
    world: Tenants, session: AsyncSession
) -> None:
    vendor_id = world.a.vendor.id
    product = await live_product(session, world, "P-1")
    product_id = product.id
    await session.commit()

    report = await reconciler(session, FakeCentral()).reconcile()
    assert dict(report.written) == {"vendor": 1, "brand_profile": 1, "product": 1}
    rows = {r.aggregate_type: r for r in await outbox(session)}
    assert rows["vendor"].event_type == "vendor.status_changed"
    assert rows["vendor"].payload["status"] == "approved"
    assert rows["brand_profile"].event_type == "brand_profile.published"
    assert rows["brand_profile"].aggregate_id == vendor_id
    assert rows["product"].event_type == "product.published"
    assert rows["product"].aggregate_id == product_id
    # Nothing was sent before: a page and a product go out at their own versions.
    assert rows["brand_profile"].version == rows["product"].version == 1
    assert {r.status for r in rows.values()} == {"pending"}
    # Vendor B is pending: not reported, and its things are not shown.
    assert all(r.vendor_id == vendor_id for r in rows.values())


async def test_a_second_run_changes_nothing(world: Tenants, session: AsyncSession) -> None:
    await live_product(session, world, "P-1")
    await session.commit()
    central = FakeCentral()
    first = await reconciler(session, central).reconcile()
    assert first.total == 3

    # Before the events are delivered they are on their way: nothing more is written.
    waiting = await reconciler(session, central).reconcile()
    assert waiting.total == 0
    assert waiting.in_flight == 3

    # After they are delivered the central app is in step: still nothing.
    await deliver(session, central)
    again = await reconciler(session, central).reconcile()
    assert (again.total, again.in_flight) == (0, 0)
    assert len(await outbox(session)) == 3


async def test_after_reconciliation_the_central_app_matches(
    world: Tenants, session: AsyncSession
) -> None:
    products = [await live_product(session, world, f"P-{n}") for n in range(3)]
    ids = {p.id for p in products}
    await session.commit()
    central = FakeCentral()
    await reconciler(session, central).reconcile()
    await deliver(session, central)
    assert set(central.held["product"]) == ids
    assert {state for _, state in central.held["product"].values()} == {PUBLISHED}
    assert set(central.held["brand_profile"]) == {world.a.vendor.id}
    assert central.held["vendor"][world.a.vendor.id][1] == PUBLISHED


async def test_a_central_app_that_is_behind_gets_a_newer_version(
    world: Tenants, session: AsyncSession
) -> None:
    product = await live_product(session, world, "P-1")
    product_id, vendor_id = product.id, world.a.vendor.id
    # Version 2 was written and sent, but the central app only has 1 (a restored database).
    await session.execute(update(Product).where(Product.id == product_id).values(version=2))
    await put_event(session, vendor_id, "product", product_id, 1, "product.published")
    await put_event(session, vendor_id, "product", product_id, 2, "product.published")
    await session.commit()
    central = FakeCentral()
    central.hold("product", product_id, 1, PUBLISHED)

    await reconciler(session, central).reconcile()
    events = [r for r in await outbox(session) if r.aggregate_id == product_id]
    assert [(r.version, r.status) for r in events] == [(1, "sent"), (2, "sent"), (3, "pending")]
    assert events[-1].event_type == "product.published"
    # The product's own version follows its events, so its next approval continues from there.
    version = await session.scalar(
        select(Product.version)
        .where(Product.id == product_id)
        .execution_options(populate_existing=True)
    )
    assert version == 3


async def test_a_central_app_that_is_ahead_or_in_step_is_left_alone(
    world: Tenants, session: AsyncSession
) -> None:
    ahead = await live_product(session, world, "AHEAD")
    level = await live_product(session, world, "LEVEL")
    vendor_id = world.a.vendor.id
    for product, version in ((ahead, 2), (level, 2)):
        await put_event(session, vendor_id, "product", product.id, 1, "product.published")
        await put_event(session, vendor_id, "product", product.id, version, "product.published")
    ahead_id, level_id = ahead.id, level.id
    await session.commit()
    central = FakeCentral()
    central.hold("product", ahead_id, 9, PUBLISHED)
    central.hold("product", level_id, 2, PUBLISHED)
    await reconciler(session, central).reconcile()
    assert [
        r for r in await outbox(session) if r.aggregate_type == "product" and r.status == "pending"
    ] == []


async def test_a_withdrawn_aggregate_that_is_still_shown_is_unpublished(
    world: Tenants, session: AsyncSession
) -> None:
    archived = await live_product(session, world, "OLD")
    archived.status = "archived"
    vendor_id, archived_id = world.a.vendor.id, archived.id
    await put_event(session, vendor_id, "product", archived_id, 1, "product.published")
    await session.commit()
    central = FakeCentral()
    central.hold("product", archived_id, 1, PUBLISHED)  # the unpublished event never arrived

    await reconciler(session, central).reconcile()
    (event,) = [
        r for r in await outbox(session) if r.status == "pending" and r.aggregate_type == "product"
    ]
    assert (event.event_type, event.version) == ("product.unpublished", 2)
    assert event.payload["reason"] == "archived"
    assert event.aggregate_id == archived_id


async def test_a_suspended_vendor_is_hidden_everywhere(
    world: Tenants, session: AsyncSession
) -> None:
    product = await live_product(session, world, "P-1")
    vendor_id, product_id = world.a.vendor.id, product.id
    await put_event(session, vendor_id, "product", product_id, 1, "product.published")
    await put_event(session, vendor_id, "brand_profile", vendor_id, 1, "brand_profile.published")
    await put_event(
        session, vendor_id, "vendor", vendor_id, 1, "vendor.status_changed", status="approved"
    )
    await session.execute(
        update(Vendor)
        .where(Vendor.id == vendor_id)
        .values(status="suspended", status_reason="Quality complaints", status_changed_at=T0)
    )
    await session.commit()
    central = FakeCentral()
    central.hold("product", product_id, 1, PUBLISHED)
    central.hold("brand_profile", vendor_id, 1, PUBLISHED)
    central.hold("vendor", vendor_id, 1, PUBLISHED)

    await reconciler(session, central).reconcile()
    pending = {r.event_type: r for r in await outbox(session) if r.status == "pending"}
    assert set(pending) == {
        "product.unpublished",
        "brand_profile.unpublished",
        "vendor.status_changed",
    }
    assert pending["product.unpublished"].payload["reason"] == "vendor_suspended"
    assert pending["brand_profile.unpublished"].payload["reason"] == "vendor_suspended"
    assert pending["vendor.status_changed"].payload["status"] == "suspended"
    assert pending["product.unpublished"].version == 2
    assert pending["brand_profile.unpublished"].version == 2
    assert pending["vendor.status_changed"].version >= 2


async def test_the_central_app_being_unreachable_writes_nothing(
    world: Tenants, session: AsyncSession
) -> None:
    await live_product(session, world, "P-1")
    await session.commit()
    central = FakeCentral()
    central.error = "the central app answered HTTP 503 to the versions"
    with pytest.raises(CentralError):
        await reconciler(session, central).reconcile()
    assert await outbox(session) == []


async def test_a_run_that_finds_another_running_does_nothing(
    world: Tenants, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await live_product(session, world, "P-1")
    await session.commit()

    async def taken(db: AsyncSession) -> bool:
        return False

    monkeypatch.setattr(Reconciler, "_lock", staticmethod(taken))
    central = FakeCentral()
    report = await reconciler(session, central).reconcile()
    assert report.another_run_active and report.total == 0
    assert central.asked == []


async def test_events_cannot_be_written_while_they_are_off(
    world: Tenants, session: AsyncSession
) -> None:
    off = Reconciler(shared(session), OutboxWriter(False), FakeCentral())
    with pytest.raises(RuntimeError, match="OUTBOX_EVENTS_ENABLED"):
        await off.reconcile()
    with pytest.raises(RuntimeError, match="OUTBOX_EVENTS_ENABLED"):
        await off.resync(Scope(everything=True))


async def test_a_full_outbox_stops_the_run_and_the_next_one_carries_on(
    world: Tenants, session: AsyncSession
) -> None:
    for n in range(5):
        await live_product(session, world, f"P-{n}")
    await session.commit()
    central = FakeCentral()
    # The vendor status goes first and fills the outbox (a limit of 1), so nothing else is written.
    first = await reconciler(session, central, max_pending=1).reconcile()
    assert first.stopped_for_backlog
    assert dict(first.written) == {"vendor": 1}
    await deliver(session, central)
    # The outbox has drained: the next run writes the rest, in chunks, within the limit.
    second = await reconciler(session, central, max_pending=3, chunk=2).reconcile()
    assert second.stopped_for_backlog  # three events were enough to fill it again
    await deliver(session, central)
    third = await reconciler(session, central, max_pending=100, chunk=2).reconcile()
    assert not third.stopped_for_backlog
    await deliver(session, central)
    assert len(central.held["product"]) == 5
    done = await reconciler(session, central).reconcile()
    assert done.total == 0


# --- Resync --------------------------------------------------------------------------------------


async def test_a_resync_of_everything_is_the_first_sync_of_an_old_catalog(
    world: Tenants, session: AsyncSession
) -> None:
    for n in range(2):
        await live_product(session, world, f"P-{n}")
    await session.commit()
    report = await reconciler(session).resync(Scope(everything=True))
    assert dict(report.written) == {"vendor": 1, "brand_profile": 1, "product": 2}
    assert {r.status for r in await outbox(session)} == {"pending"}
    # A second resync does not pile events on top of ones still waiting.
    again = await reconciler(session).resync(Scope(everything=True))
    assert (again.total, again.in_flight) == (0, 4)


async def test_a_resync_never_writes_a_stale_version(world: Tenants, session: AsyncSession) -> None:
    central = FakeCentral()
    await live_product(session, world, "P-1")
    await session.commit()
    versions: list[int] = []
    for _ in range(3):
        await reconciler(session).resync(Scope(everything=True))
        await deliver(session, central)
        rows = [r for r in await outbox(session) if r.aggregate_type == "product"]
        versions.append(max(r.version for r in rows))
    assert versions == [1, 2, 3]
    assert len(rows) == 3  # one event per run, each above the last


async def test_a_resync_is_limited_to_what_was_asked(world: Tenants, session: AsyncSession) -> None:
    await session.execute(
        update(Vendor).where(Vendor.id == world.b.vendor.id).values(status="approved")
    )
    await profile(session, world.b, 1, "published")
    mine = await live_product(session, world, "MINE")
    other = await live_product(session, world, "OTHER")
    theirs = await live_product(session, world, "THEIRS", vendor="b")
    a_id, b_id, mine_id, other_id, theirs_id = (
        world.a.vendor.id,
        world.b.vendor.id,
        mine.id,
        other.id,
        theirs.id,
    )
    await session.commit()

    one = await reconciler(session).resync(Scope(product_id=mine_id))
    assert dict(one.written) == {"product": 1}
    assert {r.aggregate_id for r in await outbox(session)} == {mine_id}

    vendor_b = await reconciler(session).resync(Scope(vendor_id=b_id))
    assert dict(vendor_b.written) == {"vendor": 1, "brand_profile": 1, "product": 1}
    rows = await outbox(session)
    assert {r.vendor_id for r in rows} == {a_id, b_id}
    assert {r.aggregate_id for r in rows if r.vendor_id == b_id} == {b_id, theirs_id}
    assert other_id not in {r.aggregate_id for r in rows}  # vendor A's other product: not asked for


async def test_a_resync_unpublishes_what_was_shown_and_is_not_now_and_skips_the_rest(
    world: Tenants, session: AsyncSession
) -> None:
    vendor_id = world.a.vendor.id
    was_shown = await live_product(session, world, "SHOWN")
    was_shown.status = "archived"
    never_shown = await live_product(session, world, "NEVER")
    never_shown.status = "archived"
    already_hidden = await live_product(session, world, "HIDDEN")
    already_hidden.status = "archived"
    ids = (was_shown.id, never_shown.id, already_hidden.id)
    await put_event(session, vendor_id, "product", ids[0], 1, "product.published")
    await put_event(session, vendor_id, "product", ids[2], 1, "product.published")
    await put_event(
        session, vendor_id, "product", ids[2], 2, "product.unpublished", reason="archived"
    )
    await session.commit()

    await reconciler(session).resync(Scope(vendor_id=vendor_id))
    new = [
        r for r in await outbox(session) if r.status == "pending" and r.aggregate_type == "product"
    ]
    assert [(r.aggregate_id, r.event_type, r.version) for r in new] == [
        (ids[0], "product.unpublished", 2)
    ]


# --- The command ----------------------------------------------------------------------------------


async def test_the_command_finds_what_it_is_told_to_resync(
    world: Tenants, session: AsyncSession
) -> None:
    product = await live_product(session, world, "Kurta-01")
    product_id, vendor_id, slug = product.id, world.a.vendor.id, world.a.vendor.slug
    other_vendor = world.b.vendor.slug
    await session.commit()

    assert await cli._resync_scope(session, None, None, True) == Scope(everything=True)
    assert await cli._resync_scope(session, slug, None, False) == Scope(vendor_id=vendor_id)
    assert await cli._resync_scope(session, str(vendor_id), None, False) == Scope(
        vendor_id=vendor_id
    )
    # A SKU is found inside its vendor, whatever its case; a product id needs no vendor.
    assert await cli._resync_scope(session, slug, "KURTA-01", False) == Scope(product_id=product_id)
    assert await cli._resync_scope(session, None, str(product_id), False) == Scope(
        product_id=product_id
    )

    for vendor, sku, everything, message in [
        (None, None, False, "say what to resync"),
        (slug, None, True, "--all stands alone"),
        (None, "Kurta-01", False, "add --vendor"),
        ("no-such-brand", None, False, "no vendor"),
        (slug, "NOPE", False, "no product"),
        (other_vendor, "Kurta-01", False, "no product"),  # a SKU of another vendor
    ]:
        with pytest.raises(cli.CommandError, match=message):
            await cli._resync_scope(session, vendor, sku, everything)


def test_the_command_says_how_many_it_wrote(capsys: pytest.CaptureFixture[str]) -> None:
    report = Report()
    report.written.update({"product": 3, "brand_profile": 1})
    report.in_flight = 2
    cli._print_resync(report)
    out = capsys.readouterr().out
    assert "Wrote 4 event(s) (1 brand page, 3 product)." in out
    assert "2 already had an event waiting" in out
    cli._print_resync(Report())
    assert "Wrote 0 event(s)." in capsys.readouterr().out


def test_the_command_is_registered() -> None:
    with pytest.raises(SystemExit):
        cli.main(["resync", "--help"])


# --- A reconciliation raises later versions ------------------------------------------------------


async def test_a_status_change_after_a_reconciliation_continues_above_it(
    world: Tenants, session: AsyncSession
) -> None:
    vendor_id = world.a.vendor.id
    # Reconciliation wrote a status event at version 5; the history has only one change.
    await put_event(
        session, vendor_id, "vendor", vendor_id, 5, "vendor.status_changed", status="approved"
    )
    audit = VendorStatusEvent(
        vendor_id=vendor_id,
        from_status="approved",
        to_status="suspended",
        actor_type="admin",
        actor_id=ident(),
        reason="Because",
    )
    session.add(audit)
    await session.flush()
    vendor = await session.get(Vendor, vendor_id)
    assert vendor is not None
    await OutboxWriter(True).vendor_status_changed(
        session, vendor, audit.id, "suspended", "Because", T0
    )
    latest = await session.scalar(
        select(func.max(OutboxEvent.version)).where(
            OutboxEvent.aggregate_type == "vendor", OutboxEvent.aggregate_id == vendor_id
        )
    )
    assert latest == 6  # not the change's own number: the central app would ignore it


async def test_the_lock_is_released_after_a_run(world: Tenants, session: AsyncSession) -> None:
    await reconciler(session, FakeCentral()).reconcile()
    held = await session.scalar(
        text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()")
    )
    assert held == 0
