"""The admins' summary: figures for the home and the queue header, over HTTP (#299).

Rows are built straight in the database. The service's clock is fixed (`NOW`, 10:00 IST on
2026-11-12), so "today", "over 24 hours" and the IST day boundary do not depend on when the tests
run.
"""

import uuid
from datetime import UTC, datetime, timedelta, timezone

import httpx
from conftest import Tenants
from factories import saved_review
from review_builders import decision, product_review, profile, profile_review, submitted_product
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Commission,
    OutboxEvent,
    Vendor,
    VendorChangeEvent,
    VendorStatusEvent,
)
from vendor_api.services.admin_summary import IST, AdminSummaryService, start_of_day_ist

SUMMARY = "/v1/admin/summary"
# 10:00 IST on 12 November 2026; midnight IST was 18:30 UTC the evening before.
NOW = datetime(2026, 11, 12, 4, 30, tzinfo=UTC)
MIDNIGHT = datetime(2026, 11, 11, 18, 30, tzinfo=UTC)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def hours_ago(hours: float) -> datetime:
    return NOW - timedelta(hours=hours)


async def get(tenants: Tenants, token: str | None = None) -> httpx.Response:
    tenants.api.app.state.admin_summary = AdminSummaryService(clock=lambda: NOW)
    return await tenants.api.http.get(SUMMARY, headers=bearer(token or tenants.admin_token))


async def summary(tenants: Tenants) -> dict[str, object]:
    response = await get(tenants)
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


async def settle(session: AsyncSession, tenants: Tenants, status: str = "approved") -> None:
    """Both vendors out of `pending`, so only what a test adds counts as an application."""
    await session.execute(update(Vendor).values(status=status))
    await session.flush()


# --- The IST day -----------------------------------------------------------------------------


def test_the_day_starts_at_midnight_in_india() -> None:
    assert start_of_day_ist(NOW) == MIDNIGHT


def test_a_moment_before_midnight_ist_is_still_the_old_day() -> None:
    before = datetime(2026, 11, 11, 18, 29, tzinfo=UTC)  # 23:59 IST on the 11th
    after = datetime(2026, 11, 11, 18, 31, tzinfo=UTC)  # 00:01 IST on the 12th
    assert start_of_day_ist(before) == MIDNIGHT - timedelta(days=1)
    assert start_of_day_ist(after) == MIDNIGHT


def test_the_zone_of_the_clock_does_not_matter() -> None:
    assert start_of_day_ist(NOW.astimezone(IST)) == MIDNIGHT
    assert start_of_day_ist(NOW.astimezone(timezone(timedelta(hours=-8)))) == MIDNIGHT


# --- Who may ask -----------------------------------------------------------------------------


async def test_a_reviewer_and_a_super_admin_may_ask(tenants: Tenants) -> None:
    assert (await get(tenants)).status_code == 200
    assert (await get(tenants, tenants.identity.token(["super_admin"]))).status_code == 200


async def test_an_admin_without_the_role_is_403_and_no_token_is_401(tenants: Tenants) -> None:
    assert (await get(tenants, tenants.identity.token([]))).status_code == 403
    assert (await tenants.api.http.get(SUMMARY)).status_code == 401


async def test_a_vendor_token_is_refused(tenants: Tenants) -> None:
    assert (await get(tenants, tenants.a.owner_token)).status_code == 401


async def test_the_answer_is_not_cached(tenants: Tenants) -> None:
    assert (await get(tenants)).headers["cache-control"] == "no-store"


# --- Nothing yet -----------------------------------------------------------------------------


async def test_with_nothing_to_show_every_figure_is_zero(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    assert await summary(tenants) == {
        "waiting": {"product": 0, "brand_page": 0, "application": 0, "over_24h": 0},
        "decisions": {"decided_today": 0, "median_minutes": None},
        "resubmissions": 0,
        "commission_proposals": 0,
        "publishing": {"delivered_24h": 0, "waiting": 0, "retrying": 0, "failed": 0},
        "recent": [],
    }


# --- Waiting ---------------------------------------------------------------------------------


async def test_waiting_counts_by_kind_and_what_is_over_a_day(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    a, b = tenants.a, tenants.b
    first_profile = await profile(session, a, 1, "pending_review")
    await saved_review(
        session, a.vendor, a.owner, profile=first_profile, submitted_at=hours_ago(30)
    )
    _, revision = await submitted_product(session, b, "B-1", 1)
    await saved_review(session, b.vendor, b.owner, revision=revision, submitted_at=hours_ago(2))
    _, another = await submitted_product(session, b, "B-2", 1)
    await saved_review(session, b.vendor, b.owner, revision=another, submitted_at=hours_ago(25))
    # An application waiting for two days.
    await session.execute(
        update(Vendor)
        .where(Vendor.id == a.vendor.id)
        .values(status="pending", created_at=hours_ago(48))
    )
    await session.flush()

    body = await summary(tenants)
    assert body["waiting"] == {"product": 2, "brand_page": 1, "application": 1, "over_24h": 3}


async def test_a_decided_or_withdrawn_review_is_not_waiting(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    a = tenants.a
    _, one = await submitted_product(session, a, "A-1", 1)
    await product_review(session, a, one, 1, **decision("approved", 2))
    _, two = await submitted_product(session, a, "A-2", 1)
    await product_review(session, a, two, 1, status="withdrawn", decided_at=hours_ago(1))
    body = await summary(tenants)
    assert body["waiting"] == {"product": 0, "brand_page": 0, "application": 0, "over_24h": 0}


async def test_resubmissions_are_waiting_reviews_of_a_later_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    a = tenants.a
    first = await profile(session, a, 1, "pending_review")
    await saved_review(session, a.vendor, a.owner, profile=first, submitted_at=hours_ago(1))
    second = await profile(session, a, 2, "pending_review")
    await saved_review(session, a.vendor, a.owner, profile=second, submitted_at=hours_ago(1))
    body = await summary(tenants)
    assert body["resubmissions"] == 1


async def test_commission_proposals_count_the_vendors_that_wait(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    session.add(Commission(vendor_id=tenants.a.vendor.id, state="proposed", proposed_bps=1200))
    session.add(Commission(vendor_id=tenants.b.vendor.id, state="agreed", agreed_bps=1000))
    await session.flush()
    assert (await summary(tenants))["commission_proposals"] == 1


# --- Decisions -------------------------------------------------------------------------------


async def decided(
    session: AsyncSession,
    tenants: Tenants,
    sku: str,
    submitted: datetime,
    decided_at: datetime,
    status: str = "approved",
) -> None:
    _, revision = await submitted_product(session, tenants.a, sku, 1)
    await saved_review(
        session,
        tenants.a.vendor,
        tenants.a.owner,
        revision=revision,
        submitted_at=submitted,
        reviewer_id=uuid.uuid4(),
        status=status,
        decided_at=decided_at,
        reason="Photos are blurry" if status == "rejected" else None,
    )


async def test_decided_today_starts_at_midnight_ist(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    # 23:59 IST yesterday and 00:01 IST today.
    await decided(
        session, tenants, "A-1", MIDNIGHT - timedelta(hours=3), MIDNIGHT - timedelta(minutes=1)
    )
    await decided(
        session, tenants, "A-2", MIDNIGHT - timedelta(hours=3), MIDNIGHT + timedelta(minutes=1)
    )
    await decided(session, tenants, "A-3", MIDNIGHT - timedelta(hours=3), hours_ago(1), "rejected")
    body = await summary(tenants)
    assert body["decisions"]["decided_today"] == 2  # type: ignore[index]


async def test_the_median_of_one_decision_is_its_wait(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    await decided(session, tenants, "A-1", hours_ago(3), hours_ago(1))
    assert (await summary(tenants))["decisions"] == {"decided_today": 1, "median_minutes": 120}


async def test_the_median_of_an_even_number_is_the_middle_of_the_two(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    await decided(session, tenants, "A-1", hours_ago(3), hours_ago(2))  # 60 minutes
    await decided(session, tenants, "A-2", hours_ago(4), hours_ago(1))  # 180 minutes
    assert (await summary(tenants))["decisions"] == {"decided_today": 2, "median_minutes": 120}


async def test_the_median_of_an_odd_number_is_the_middle_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    await decided(session, tenants, "A-1", hours_ago(3), hours_ago(2))  # 60
    await decided(session, tenants, "A-2", hours_ago(4), hours_ago(1))  # 180
    await decided(session, tenants, "A-3", hours_ago(3.5), hours_ago(1), "rejected")  # 150
    assert (await summary(tenants))["decisions"] == {"decided_today": 3, "median_minutes": 150}


async def test_an_approved_application_counts_as_a_decision(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    admin = uuid.uuid4()
    await session.execute(
        update(Vendor).where(Vendor.id == tenants.a.vendor.id).values(created_at=hours_ago(5))
    )
    session.add(
        VendorStatusEvent(
            vendor_id=tenants.a.vendor.id,
            from_status="pending",
            to_status="approved",
            actor_type="admin",
            actor_id=admin,
            created_at=hours_ago(3),
        )
    )
    await session.flush()
    body = await summary(tenants)
    assert body["decisions"] == {"decided_today": 1, "median_minutes": 120}


# --- Publishing ------------------------------------------------------------------------------


async def outbox(session: AsyncSession, tenants: Tenants, status: str, **changes: object) -> None:
    values: dict[str, object] = {
        "vendor_id": tenants.a.vendor.id,
        "aggregate_type": "product",
        "aggregate_id": uuid.uuid4(),
        "event_type": "product.published",
        "version": 1,
        "payload": {"sku": "A-1"},
        "status": status,
        "created_at": hours_ago(1),
        "next_attempt_at": hours_ago(1),
    }
    session.add(OutboxEvent(**{**values, **changes}))
    await session.flush()


async def test_publishing_counts_what_was_delivered_waits_retries_and_failed(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    await outbox(session, tenants, "sent", sent_at=hours_ago(2))
    await outbox(session, tenants, "sent", sent_at=hours_ago(30))  # too old to count
    await outbox(session, tenants, "pending")
    await outbox(session, tenants, "pending", attempts=2, last_error="HTTP 503")
    await outbox(session, tenants, "sending", locked_at=hours_ago(0.01))
    await outbox(session, tenants, "dead", attempts=8, last_error="HTTP 503 (after 8 attempts)")
    body = await summary(tenants)
    assert body["publishing"] == {"delivered_24h": 1, "waiting": 2, "retrying": 1, "failed": 1}


# --- Recent decisions ------------------------------------------------------------------------


async def test_recent_decisions_are_the_latest_five_of_every_kind_newest_first(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    a = tenants.a
    reviewer = uuid.uuid4()
    for i in range(4):
        await decided(session, tenants, f"A-{i}", hours_ago(10), hours_ago(9 - i))
    session.add(
        VendorStatusEvent(
            vendor_id=a.vendor.id,
            from_status="pending",
            to_status="rejected",
            actor_type="admin",
            actor_id=reviewer,
            created_at=hours_ago(5),
        )
    )
    session.add(
        VendorChangeEvent(
            vendor_id=a.vendor.id,
            subject="commission",
            action="sent_back",
            actor_type="admin",
            actor_id=reviewer,
            detail={"note": "Too high"},
            created_at=hours_ago(0.5),
        )
    )
    await session.flush()
    recent = (await summary(tenants))["recent"]
    assert isinstance(recent, list)
    assert [r["kind"] for r in recent] == [
        "commission",
        "product",
        "product",
        "product",
        "product",
    ]
    assert recent[0]["decision"] == "rejected"
    assert recent[0]["reviewer_id"] == str(reviewer)
    assert recent[0]["vendor_name"] == a.vendor.name
    times = [r["at"] for r in recent]
    assert times == sorted(times, reverse=True)


async def test_a_recent_review_decision_carries_what_the_home_links_to(
    tenants: Tenants, session: AsyncSession
) -> None:
    await settle(session, tenants)
    a = tenants.a
    product, revision = await submitted_product(session, a, "A-1", 1)
    review = await product_review(session, a, revision, 1, **decision("approved", 2))
    brand = await profile(session, a, 1, "published", brand_name="Indigo House")
    brand_review = await profile_review(session, a, brand, 0, **decision("rejected", 3))
    recent = {r["kind"]: r for r in (await summary(tenants))["recent"]}  # type: ignore[attr-defined]
    assert recent["product"]["review_id"] == str(review.id)
    assert recent["product"]["subject_id"] == str(product.id)
    assert recent["product"]["title"] == revision.title
    assert recent["brand_page"]["review_id"] == str(brand_review.id)
    assert recent["brand_page"]["subject_id"] == str(a.vendor.id)
    assert recent["brand_page"]["title"] == "Indigo House"
