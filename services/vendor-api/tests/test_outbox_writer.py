"""An approval writes its central-app event in the same transaction (ADR 0003, section 5).

A refused decision rolls the shared test session back, so each test commits what it sets up first,
keeps ids instead of rows, and reads everything again from the database afterwards.
"""

import logging
import uuid
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from factories import saved_asset, saved_image, saved_revision, saved_revision_variant
from review_builders import (
    product_review,
    profile,
    profile_review,
    submitted_product,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import ADMIN_ID

from vendor_api.db.models import (
    BrandProfile,
    OutboxEvent,
    Product,
    ProductVariant,
    Review,
    ReviewEvent,
)
from vendor_api.services.central_contract import contract
from vendor_api.services.central_events import iso
from vendor_api.services.outbox import CANNOT_PUBLISH, OUTBOX_CONFLICT, OutboxWriter
from vendor_api.services.review_decisions import Decision, ReviewDecisionService

QUEUE = "/v1/admin/reviews"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def decide(
    tenants: Tenants, review_id: uuid.UUID, action: str, body: dict[str, Any]
) -> httpx.Response:
    return await tenants.api.http.post(
        f"{QUEUE}/{review_id}/{action}", json=body, headers=bearer(tenants.admin_token)
    )


async def outbox(session: AsyncSession) -> list[OutboxEvent]:
    rows = await session.scalars(
        select(OutboxEvent)
        .order_by(OutboxEvent.created_at, OutboxEvent.version)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def reload[T](session: AsyncSession, model: type[T], row_id: uuid.UUID) -> T:
    id_column = model.id  # type: ignore[attr-defined]
    result = await session.scalars(
        select(model).where(id_column == row_id).execution_options(populate_existing=True)
    )
    return result.one()


def envelope(event: OutboxEvent) -> dict[str, Any]:
    """What the sender will put on the wire, rebuilt from the row alone."""
    return {
        "event_id": str(event.id),
        "type": event.event_type,
        "version": event.version,
        "occurred_at": iso(event.created_at),
        "producer": "vendor-api",
        "aggregate": {"type": event.aggregate_type, "id": str(event.aggregate_id)},
        "payload": event.payload,
    }


async def pending_profile(
    session: AsyncSession, tenant: Tenant, version: int = 1, **changes: Any
) -> tuple[uuid.UUID, uuid.UUID]:
    """A brand profile version in review. Returns (profile id, review id), committed."""
    version_row = await profile(session, tenant, version, "pending_review", **changes)
    review = await profile_review(session, tenant, version_row, version)
    session.add(
        ReviewEvent(
            review_id=review.id, action="submitted", actor_type="vendor", actor_id=tenant.owner.id
        )
    )
    await session.flush()
    ids = (version_row.id, review.id)
    await session.commit()
    return ids


async def pending_first_product(
    session: AsyncSession, tenant: Tenant, sku: str = "NEW-1"
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A product whose first revision is in review. Returns (product, revision, review ids)."""
    product, revision = await submitted_product(session, tenant, sku, 1)
    product.pending_revision_id = revision.id
    product.status = "pending_review"
    await session.flush()
    review = await product_review(session, tenant, revision, 2)
    ids = (product.id, revision.id, review.id)
    await session.commit()
    return ids


async def edit_in_review(
    session: AsyncSession, tenant: Tenant, product_id: uuid.UUID, version: int, title: str
) -> uuid.UUID:
    """A new revision of a live product, submitted and in review. Returns the review id."""
    product = await reload(session, Product, product_id)
    variant = (
        await session.scalars(select(ProductVariant).where(ProductVariant.product_id == product.id))
    ).first()
    assert variant is not None
    revision = await saved_revision(session, product, tenant.owner, version=version, title=title)
    await saved_revision_variant(session, revision, variant, price_paise=89_900, mrp_paise=129_900)
    asset = await saved_asset(
        session,
        tenant.vendor,
        tenant.owner,
        public_id=f"shazlo/edit-{version}",
        kind="product_image",
    )
    await saved_image(session, revision, asset, position=1)
    revision.submitted_at = revision.created_at
    product.pending_revision_id = revision.id
    await session.flush()
    review = await product_review(session, tenant, revision, 10 + version)
    review_id = review.id
    await session.commit()
    return review_id


# --- A brand profile ---------------------------------------------------------------------


async def test_approving_a_brand_profile_writes_exactly_one_pending_event(
    tenants: Tenants, session: AsyncSession
) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    response = await decide(tenants, review_id, "approve", {"version": 1})
    assert response.status_code == 200

    (event,) = await outbox(session)
    published = await reload(session, BrandProfile, profile_id)
    assert event.status == "pending"
    assert (event.attempts, event.sent_at, event.locked_at, event.last_error) == (
        0,
        None,
        None,
        None,
    )
    assert event.event_type == "brand_profile.published"
    assert (event.aggregate_type, event.aggregate_id) == ("brand_profile", tenants.a.vendor.id)
    assert event.vendor_id == tenants.a.vendor.id
    assert event.version == published.version == 1
    assert event.payload["vendor_id"] == str(tenants.a.vendor.id)
    assert event.payload["slug"] == tenants.a.vendor.slug
    contract().validate(envelope(event))  # a valid event, as the receiver will see it


async def test_the_event_is_dated_by_the_decision(tenants: Tenants, session: AsyncSession) -> None:
    _, review_id = await pending_profile(session, tenants.a)
    await decide(tenants, review_id, "approve", {"version": 1})
    (event,) = await outbox(session)
    review = await reload(session, Review, review_id)
    assert review.decided_at is not None
    assert iso(event.created_at) == iso(review.decided_at)
    assert event.payload["published_at"] == iso(review.decided_at)


async def test_a_newer_version_gets_its_own_higher_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, first = await pending_profile(session, tenants.a, 1)
    await decide(tenants, first, "approve", {"version": 1})
    _, second = await pending_profile(session, tenants.a, 2)
    await decide(tenants, second, "approve", {"version": 2})
    events = await outbox(session)
    assert [e.version for e in events] == [1, 2]
    assert {e.aggregate_id for e in events} == {tenants.a.vendor.id}  # one page, two versions
    assert len({e.id for e in events}) == 2


# --- A product ---------------------------------------------------------------------------


async def test_approving_the_first_revision_writes_the_products_first_event(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, _, review_id = await pending_first_product(session, tenants.a)
    assert (await decide(tenants, review_id, "approve", {"version": 1})).status_code == 200

    (event,) = await outbox(session)
    assert event.event_type == "product.published"
    assert (event.aggregate_type, event.aggregate_id) == ("product", product_id)
    assert event.version == (await reload(session, Product, product_id)).version == 1
    assert event.payload["product_id"] == str(product_id)
    assert event.payload["sku"] == "NEW-1"
    assert event.payload["variants"] and event.payload["images"]
    contract().validate(envelope(event))


async def test_two_approvals_of_one_product_give_versions_in_order(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, _, first_review = await pending_first_product(session, tenants.a)
    await decide(tenants, first_review, "approve", {"version": 1})
    second_review = await edit_in_review(session, tenants.a, product_id, 2, "Block-print kurta v2")
    await decide(tenants, second_review, "approve", {"version": 2})

    events = await outbox(session)
    assert [e.version for e in events] == [1, 2]
    assert all(e.aggregate_id == product_id for e in events)
    assert (await reload(session, Product, product_id)).version == 2
    assert events[-1].payload["title"] == "Block-print kurta v2"  # the full state at that time
    assert events[0].payload["title"] != events[-1].payload["title"]
    for event in events:
        contract().validate(envelope(event))


# --- Rejections and the rest -------------------------------------------------------------


async def test_a_rejection_writes_no_event(tenants: Tenants, session: AsyncSession) -> None:
    _, profile_review_id = await pending_profile(session, tenants.a)
    _, _, product_review_id = await pending_first_product(session, tenants.b)
    for review_id in (profile_review_id, product_review_id):
        response = await decide(tenants, review_id, "reject", {"version": 1, "reason": "Not yet"})
        assert response.status_code == 200
    assert await outbox(session) == []


async def test_every_approval_has_exactly_one_event(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, one = await pending_profile(session, tenants.a)
    _, two = await pending_profile(session, tenants.b)
    _, _, three = await pending_first_product(session, tenants.a, "P-1")
    _, _, four = await pending_first_product(session, tenants.b, "P-2")
    for review_id in (one, two, three, four):
        assert (await decide(tenants, review_id, "approve", {"version": 1})).status_code == 200
    events = await outbox(session)
    assert len(events) == 4
    assert len({(e.aggregate_type, e.aggregate_id, e.version) for e in events}) == 4


async def test_the_event_is_only_about_the_vendors_own_data(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, review_id = await pending_profile(session, tenants.a)
    await decide(tenants, review_id, "approve", {"version": 1})
    (event,) = await outbox(session)
    text = str(event.payload)
    assert tenants.b.vendor.slug not in text
    for forbidden in ("phone", "email", "contact", "password", "stock"):
        assert forbidden not in event.payload  # the contract has no such fields


# --- When writing the event fails, the approval does not happen --------------------------


async def test_a_duplicate_version_refuses_the_approval_and_saves_nothing(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_a = tenants.a.vendor.id
    profile_id, review_id = await pending_profile(session, tenants.a)
    # Someone already wrote an event for version 1 of this page.
    session.add(
        OutboxEvent(
            vendor_id=vendor_a,
            aggregate_type="brand_profile",
            aggregate_id=vendor_a,
            event_type="brand_profile.published",
            version=1,
            payload={"already": "there"},
        )
    )
    await session.commit()

    response = await decide(tenants, review_id, "approve", {"version": 1})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == OUTBOX_CONFLICT
    assert "version 1" in response.json()["error"]["message"]
    review = await reload(session, Review, review_id)
    assert (review.status, review.reviewer_id, review.decided_at) == ("pending", None, None)
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"
    assert [e.payload for e in await outbox(session)] == [{"already": "there"}]  # still only that
    decisions = await session.scalar(
        select(func.count())
        .select_from(ReviewEvent)
        .where(ReviewEvent.review_id == review_id, ReviewEvent.action == "approved")
    )
    assert decisions == 0


async def test_an_image_that_is_not_ready_cannot_be_published(
    tenants: Tenants, session: AsyncSession
) -> None:
    asset = await saved_asset(
        session,
        tenants.a.vendor,
        tenants.a.owner,
        public_id="shazlo/unfinished",
        kind="brand_logo",
        status="pending",
        format=None,
        bytes=None,
        width=None,
        height=None,
    )
    profile_id, review_id = await pending_profile(session, tenants.a, logo_asset_id=asset.id)

    response = await decide(tenants, review_id, "approve", {"version": 1})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == CANNOT_PUBLISH
    assert "Nothing was saved" in response.json()["error"]["message"]
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"
    assert (await reload(session, Review, review_id)).status == "pending"
    assert await outbox(session) == []


async def test_a_failure_after_the_event_leaves_no_event_behind(
    tenants: Tenants, session: AsyncSession
) -> None:
    """The event is written before the commit: a later hook that fails must take it with it."""

    async def broken(db: AsyncSession, outcome: Decision) -> None:
        raise RuntimeError("a later step failed")

    tenants.api.app.state.review_decisions.add_hook(broken)
    profile_id, review_id = await pending_profile(session, tenants.a)
    with pytest.raises(RuntimeError, match="later step"):
        await decide(tenants, review_id, "approve", {"version": 1})
    assert await outbox(session) == []
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"
    assert (await reload(session, Review, review_id)).status == "pending"


async def test_the_events_of_a_decided_approval_survive_the_next_refused_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_a = tenants.a.vendor.id  # read now: a refused request rolls the session back
    _, good = await pending_profile(session, tenants.a)
    await decide(tenants, good, "approve", {"version": 1})
    _, stale = await pending_profile(session, tenants.b)
    await decide(tenants, stale, "approve", {"version": 9})  # refused: not the version reviewed
    events = await outbox(session)
    assert [e.vendor_id for e in events] == [vendor_a]


# --- The switch --------------------------------------------------------------------------


async def test_with_publishing_off_an_approval_writes_no_event_and_says_so(
    tenants: Tenants, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        service = ReviewDecisionService(hooks=[OutboxWriter(enabled=False).on_decision])
        _, review_id = await pending_profile(session, tenants.a)
        await service.approve(session, review_id, ADMIN_ID, 1)
    assert await outbox(session) == []
    assert (await reload(session, Review, review_id)).status == "approved"  # still approved
    messages = [record.getMessage() for record in caplog.records]
    assert any("outbox events are off" in message for message in messages)  # said at start
    assert any("without an outbox event" in message for message in messages)  # and per approval


async def test_a_rejection_with_publishing_off_logs_nothing_about_events(
    tenants: Tenants, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    service = ReviewDecisionService(hooks=[OutboxWriter(enabled=False).on_decision])
    _, review_id = await pending_profile(session, tenants.a)
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        await service.reject(session, review_id, ADMIN_ID, 1, "No")
    assert not any("outbox" in record.getMessage() for record in caplog.records)


async def test_the_app_registers_the_writer_on_the_decision_service(
    tenants: Tenants,
) -> None:
    app = tenants.api.app
    assert isinstance(app.state.outbox_writer, OutboxWriter)
    assert app.state.outbox_writer.on_decision in app.state.review_decisions._hooks  # noqa: SLF001
