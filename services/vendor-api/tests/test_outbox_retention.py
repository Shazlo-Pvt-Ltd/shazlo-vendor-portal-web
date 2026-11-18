"""The publisher's 30-day cleanup and the outbox writer (ADR 0003, section 5).

The writer reads the latest event of each aggregate to know what the central app holds: whether a
withdrawal is due, what to hide or show again, and which version comes next (a brand page's event
version lives only in the outbox). The cleanup therefore keeps the latest row of every aggregate,
however old. These tests run it between the events and the change that reads them.

Everything goes through the API, like `test_unpublish_events.py`, whose helpers they use. The
events are then made old and `sent` (the trigger that guards the table is lifted for that one
statement: no other way makes a row 40 days old).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from conftest import Tenants
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from test_outbox_writer import decide, envelope, outbox, pending_profile
from test_publisher import Clock, Receiver, build
from test_unpublish_events import (
    act,
    archive,
    of_type,
    product_version,
    publish_brand,
    publish_product,
    versions_of,
)

from vendor_api.db.models import OutboxEvent, Vendor
from vendor_api.services.central_contract import contract

AGED = timedelta(days=40)


@pytest.fixture(autouse=True)
async def approved_vendor(tenants: Tenants, session: AsyncSession) -> None:
    await session.execute(
        update(Vendor).where(Vendor.id == tenants.a.vendor.id).values(status="approved")
    )
    await session.commit()


@pytest.fixture
def later() -> Clock:
    """A clock 40 days after the events were written: everything they sent is old."""
    clock = Clock()
    clock.now = datetime.now(UTC) + AGED
    return clock


async def delivered(session: AsyncSession) -> None:
    """Marks every pending event as sent (as the worker would have), so cleanup may remove it."""
    await session.execute(text("ALTER TABLE outbox_events DISABLE TRIGGER outbox_events_protect"))
    await session.execute(
        text(
            "UPDATE outbox_events SET status = 'sent', sent_at = created_at WHERE status <> 'sent'"
        )
    )
    await session.execute(text("ALTER TABLE outbox_events ENABLE TRIGGER outbox_events_protect"))
    await session.commit()


async def clean_up(session: AsyncSession, clock: Clock) -> int:
    await delivered(session)
    _, removed = await build(session, Receiver(), clock).maintain()
    await session.commit()
    return removed


async def rows(session: AsyncSession) -> list[OutboxEvent]:
    return list(
        await session.scalars(
            select(OutboxEvent)
            .order_by(OutboxEvent.aggregate_id, OutboxEvent.version)
            .execution_options(populate_existing=True)
        )
    )


def latest_versions(events: list[OutboxEvent]) -> dict[uuid.UUID, int]:
    latest: dict[uuid.UUID, int] = {}
    for event in events:
        latest[event.aggregate_id] = max(latest.get(event.aggregate_id, 0), event.version)
    return latest


async def test_archiving_an_old_published_product_still_withdraws_it(
    tenants: Tenants, session: AsyncSession, later: Clock
) -> None:
    product_id = await publish_product(tenants, session, "OLD-1")
    assert await clean_up(session, later) == 0  # its only event is the latest: it stays
    assert versions_of(await outbox(session), product_id) == [1]

    assert await archive(tenants, product_id) == 204

    events = await outbox(session)
    (unpublished,) = of_type(events, "product.unpublished")
    assert (unpublished.aggregate_id, unpublished.version) == (product_id, 2)
    assert unpublished.payload["reason"] == "archived"
    assert await product_version(session, product_id) == 2
    contract().validate(envelope(unpublished))


async def test_suspending_a_vendor_with_old_listings_still_hides_them(
    tenants: Tenants, session: AsyncSession, later: Clock
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)
    first = await publish_product(tenants, session, "OLD-2")
    second = await publish_product(tenants, session, "OLD-3")
    assert await clean_up(session, later) == 0

    assert await act(tenants, vendor_id, "suspend") == 200

    events = await outbox(session)
    hidden = [
        *of_type(events, "brand_profile.unpublished"),
        *of_type(events, "product.unpublished"),
    ]
    assert {e.aggregate_id for e in hidden} == {vendor_id, first, second}
    assert {e.payload["reason"] for e in hidden} == {"vendor_suspended"}
    assert all(e.version == 2 for e in hidden)


async def test_reinstating_a_vendor_whose_suspension_events_are_old_shows_everything_again(
    tenants: Tenants, session: AsyncSession, later: Clock
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)
    live = await publish_product(tenants, session, "OLD-4")
    archived = await publish_product(tenants, session, "OLD-5")
    assert await archive(tenants, archived) == 204
    assert await act(tenants, vendor_id, "suspend") == 200

    before = latest_versions(await rows(session))
    removed = await clean_up(session, later)  # the first events of the page and the live product
    after = await rows(session)
    assert removed == 3  # the first event of the page and of each product
    assert latest_versions(after) == before  # and the latest of every aggregate stayed
    assert {e.aggregate_id for e in after if e.event_type.endswith(".unpublished")} == {
        vendor_id,
        live,
        archived,
    }

    assert await act(tenants, vendor_id, "approve") == 200

    events = await outbox(session)
    again = [e for e in events if e.event_type.endswith(".published") and e.version == 3]
    assert {e.aggregate_id for e in again} == {vendor_id, live}  # what was archived stays hidden
    assert versions_of(events, archived) == [2]  # (its first event was cleaned up)
    for event in again:
        contract().validate(envelope(event))


async def test_the_next_brand_event_stays_above_what_the_central_app_has_seen(
    tenants: Tenants, session: AsyncSession, later: Clock
) -> None:
    vendor_id = tenants.a.vendor.id
    await publish_brand(tenants, session)  # version 1
    # Version 2 of the page is in review while the vendor is suspended (2) and reinstated (3).
    _, review_id = await pending_profile(session, tenants.a, 2, tagline="Second")
    assert await act(tenants, vendor_id, "suspend") == 200
    assert await act(tenants, vendor_id, "approve") == 200

    # The page's versions 1 and 2, and the first of the vendor's two status events.
    assert await clean_up(session, later) == 3
    brand = [e for e in await rows(session) if e.aggregate_type == "brand_profile"]
    assert [(e.event_type, e.version) for e in brand] == [("brand_profile.published", 3)]

    response = await decide(tenants, review_id, "approve", {"version": 2})

    assert response.status_code == 200
    brand = [e for e in await rows(session) if e.aggregate_type == "brand_profile"]
    latest = max(brand, key=lambda e: e.version)
    assert (latest.event_type, latest.version) == ("brand_profile.published", 4)
    assert latest.payload["tagline"] == "Second"
    contract().validate(envelope(latest))


async def test_the_vendors_status_history_keeps_its_latest_version_too(
    tenants: Tenants, session: AsyncSession, later: Clock
) -> None:
    vendor_id = tenants.a.vendor.id
    assert await act(tenants, vendor_id, "suspend") == 200
    assert await act(tenants, vendor_id, "approve") == 200
    assert await clean_up(session, later) == 1
    (status,) = await rows(session)
    assert (status.event_type, status.payload["status"]) == ("vendor.status_changed", "approved")
