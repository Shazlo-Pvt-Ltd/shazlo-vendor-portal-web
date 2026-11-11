"""What leaves the central app: archiving a live product, and suspending, rejecting or reinstating
a vendor (ADR 0003, section 5). The events are written in the transaction of the change itself.

A refused change rolls the shared test session back, so each test commits what it sets up, keeps
ids instead of rows, and reads everything again from the database afterwards.
"""

import logging
import uuid
from datetime import UTC, datetime

import pytest
from conftest import Tenants
from review_builders import submitted_product
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from test_outbox_writer import decide, envelope, outbox, pending_first_product, pending_profile

from vendor_api.db.models import OutboxEvent, Product, Vendor
from vendor_api.services import outbox as outbox_module
from vendor_api.services.central_contract import contract
from vendor_api.services.outbox import OutboxWriter

PRODUCTS = "/v1/vendor/products"
VENDORS = "/v1/admin/vendors"


@pytest.fixture(autouse=True)
async def approved_vendor(tenants: Tenants, session: AsyncSession) -> None:
    await session.execute(
        update(Vendor).where(Vendor.id == tenants.a.vendor.id).values(status="approved")
    )
    await session.commit()


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def publish_product(tenants: Tenants, session: AsyncSession, sku: str) -> uuid.UUID:
    product_id, _, review_id = await pending_first_product(session, tenants.a, sku)
    assert (await decide(tenants, review_id, "approve", {"version": 1})).status_code == 200
    return product_id


async def publish_brand(tenants: Tenants, session: AsyncSession) -> None:
    _, review_id = await pending_profile(session, tenants.a, 1)
    assert (await decide(tenants, review_id, "approve", {"version": 1})).status_code == 200


async def act(tenants: Tenants, vendor_id: uuid.UUID, action: str, reason: str = "Because") -> int:
    response = await tenants.api.http.post(
        f"{VENDORS}/{vendor_id}/{action}",
        json={"reason": reason},
        headers=bearer(tenants.admin_token),
    )
    return response.status_code


async def archive(tenants: Tenants, product_id: uuid.UUID) -> int:
    response = await tenants.api.http.delete(
        f"{PRODUCTS}/{product_id}", headers=bearer(tenants.a.owner_token)
    )
    return response.status_code


async def product_version(session: AsyncSession, product_id: uuid.UUID) -> int:
    value = await session.scalar(
        select(Product.version)
        .where(Product.id == product_id)
        .execution_options(populate_existing=True)
    )
    assert value is not None
    return int(value)


def of_type(events: list[OutboxEvent], event_type: str) -> list[OutboxEvent]:
    return [event for event in events if event.event_type == event_type]


def versions_of(events: list[OutboxEvent], aggregate_id: uuid.UUID) -> list[int]:
    return sorted(e.version for e in events if e.aggregate_id == aggregate_id)


# --- Archiving a live product --------------------------------------------------------------


async def test_archiving_a_live_product_writes_product_unpublished(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id = await publish_product(tenants, session, "A-1")
    assert await archive(tenants, product_id) == 204

    events = await outbox(session)
    (unpublished,) = of_type(events, "product.unpublished")
    assert unpublished.aggregate_id == product_id
    assert unpublished.payload["reason"] == "archived"
    assert unpublished.version == 2
    assert await product_version(session, product_id) == 2
    contract().validate(envelope(unpublished))


async def test_archiving_a_product_that_was_never_live_writes_nothing(
    tenants: Tenants, session: AsyncSession
) -> None:
    product, _ = await submitted_product(session, tenants.a, "N-1", 1)
    product_id = product.id
    await session.commit()
    assert await archive(tenants, product_id) == 204
    assert await outbox(session) == []


# --- Suspending, rejecting, reinstating ------------------------------------------------------


async def test_suspending_hides_the_page_and_every_product(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)
    first = await publish_product(tenants, session, "S-1")
    second = await publish_product(tenants, session, "S-2")

    assert await act(tenants, vendor_id, "suspend") == 200

    events = await outbox(session)
    (status,) = of_type(events, "vendor.status_changed")
    assert status.payload["status"] == "suspended"
    assert status.payload["reason"] == "Because"
    hidden = [
        *of_type(events, "brand_profile.unpublished"),
        *of_type(events, "product.unpublished"),
    ]
    assert {e.aggregate_id for e in hidden} == {vendor_id, first, second}
    assert {e.payload["reason"] for e in hidden} == {"vendor_suspended"}
    assert all(e.version == 2 for e in hidden)
    assert await product_version(session, first) == 2
    for event in events:
        contract().validate(envelope(event))


async def test_a_vendor_that_published_nothing_gets_only_the_status_event(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await session.execute(update(Vendor).where(Vendor.id == vendor_id).values(status="pending"))
    await session.commit()
    assert await act(tenants, vendor_id, "reject") == 200
    (event,) = await outbox(session)
    assert event.event_type == "vendor.status_changed"
    assert event.payload["status"] == "rejected"


async def test_reinstating_shows_again_what_the_suspension_hid_and_nothing_else(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)
    live = await publish_product(tenants, session, "R-1")
    archived = await publish_product(tenants, session, "R-2")
    assert await archive(tenants, archived) == 204

    assert await act(tenants, vendor_id, "suspend") == 200
    assert await act(tenants, vendor_id, "approve") == 200

    events = await outbox(session)
    assert versions_of(events, live) == [1, 2, 3]
    brand = [e for e in events if e.aggregate_type == "brand_profile"]
    assert sorted(e.version for e in brand) == [1, 2, 3]
    assert versions_of(events, archived) == [1, 2]  # archived stays archived
    again = [e for e in events if e.event_type.endswith(".published") and e.version == 3]
    assert {e.aggregate_id for e in again} == {live, vendor_id}
    assert await product_version(session, live) == 3
    assert [e.payload["status"] for e in of_type(events, "vendor.status_changed")] == [
        "suspended",
        "approved",
    ]
    for event in events:
        contract().validate(envelope(event))


async def test_a_refused_change_writes_nothing(tenants: Tenants, session: AsyncSession) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_product(tenants, session, "X-1")
    before = len(await outbox(session))
    assert await act(tenants, vendor_id, "approve") == 409  # already approved
    assert len(await outbox(session)) == before


async def test_a_page_drafted_before_a_suspension_is_approved_above_the_central_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)
    # Version 2 is in review when the vendor is suspended (event 2) and reinstated (event 3).
    _, review_id = await pending_profile(session, tenants.a, 2, tagline="Second")
    assert await act(tenants, vendor_id, "suspend") == 200
    assert await act(tenants, vendor_id, "approve") == 200

    response = await decide(tenants, review_id, "approve", {"version": 2})

    assert response.status_code == 200
    brand = [e for e in await outbox(session) if e.aggregate_type == "brand_profile"]
    assert [(e.event_type, e.version) for e in sorted(brand, key=lambda e: e.version)] == [
        ("brand_profile.published", 1),
        ("brand_profile.unpublished", 2),
        ("brand_profile.published", 3),
        ("brand_profile.published", 4),  # above everything the central app has seen
    ]
    latest = max(brand, key=lambda e: e.version)
    assert latest.payload["tagline"] == "Second"
    contract().validate(envelope(latest))
    # And the next approval continues the same counter.
    _, third = await pending_profile(session, tenants.a, 3)
    assert (await decide(tenants, third, "approve", {"version": 3})).status_code == 200
    brand = [e for e in await outbox(session) if e.aggregate_type == "brand_profile"]
    assert max(e.version for e in brand) == 5


async def test_a_page_approved_while_suspended_does_not_collide_with_the_unpublish(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)
    _, review_id = await pending_profile(session, tenants.a, 2)
    assert await act(tenants, vendor_id, "suspend") == 200  # brand_profile.unpublished at 2

    response = await decide(tenants, review_id, "approve", {"version": 2})

    assert response.status_code == 200
    brand = [e for e in await outbox(session) if e.aggregate_type == "brand_profile"]
    assert sorted(e.version for e in brand) == [1, 2, 3]


# --- The fan-out itself ----------------------------------------------------------------------


async def test_the_fan_out_is_idempotent_and_chunked(
    tenants: Tenants, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    vendor_id = tenants.a.vendor.id
    ids = [await publish_product(tenants, session, f"C-{n}") for n in range(5)]
    monkeypatch.setattr(outbox_module, "FANOUT_CHUNK", 2)
    writer: OutboxWriter = tenants.api.app.state.outbox_writer
    now = datetime(2026, 11, 2, tzinfo=UTC)
    assert await writer.unpublish_vendor(session, vendor_id, "vendor_suspended", now) == 5
    assert await writer.unpublish_vendor(session, vendor_id, "vendor_suspended", now) == 0
    await session.commit()
    events = await outbox(session)
    assert len(of_type(events, "product.unpublished")) == 5
    assert {e.aggregate_id for e in events if e.version == 2} == set(ids)


async def test_nothing_is_written_while_events_are_off(
    tenants: Tenants, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    await publish_product(tenants, session, "O-1")
    before = await session.scalar(select(func.count()).select_from(OutboxEvent))
    off = OutboxWriter(False)
    with caplog.at_level(logging.WARNING):
        now = datetime.now(UTC)
        assert (
            await off.unpublish_vendor(session, tenants.a.vendor.id, "vendor_suspended", now) == 0
        )
    assert await session.scalar(select(func.count()).select_from(OutboxEvent)) == before
    assert "publishing is off" in caplog.text
