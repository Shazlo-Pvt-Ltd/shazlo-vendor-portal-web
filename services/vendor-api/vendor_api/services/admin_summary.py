"""The figures on the admins' home and on the review queue's header (#299).

Every figure is one query over indexed columns: counts over reviews, vendors, commissions and the
outbox, one median, and the latest few decisions. Nothing is loaded row by row, so ten thousand
waiting items cost the same as ten.

"Today" starts at midnight in India (IST, UTC+05:30, no daylight saving), whatever the server's
clock zone is: a decision at 23:59 IST belongs to that day and one at 00:01 IST to the next.

Who decided is an identity-api admin id. This service never looks a name up (admins live in another
service): the shell asks identity-api for the names of the ids it shows.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import ColumnElement, func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    ActorType,
    BrandProfile,
    ChangeSubject,
    Commission,
    CommissionState,
    OutboxEvent,
    OutboxStatus,
    Product,
    ProductRevision,
    Review,
    ReviewStatus,
    ReviewSubject,
    Vendor,
    VendorChangeEvent,
    VendorStatus,
    VendorStatusEvent,
)

IST = timezone(timedelta(hours=5, minutes=30))
RECENT_LIMIT = 5
OVER = timedelta(hours=24)

Kind = Literal["product", "brand_page", "application", "commission"]
Decision = Literal["approved", "rejected"]
DECIDED = (ReviewStatus.APPROVED, ReviewStatus.REJECTED)


def start_of_day_ist(now: datetime) -> datetime:
    """Midnight IST of the day `now` falls in, as a moment in UTC."""
    return now.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


@dataclass(frozen=True)
class RecentDecision:
    id: str  # the review's id; "application-<n>" or "commission-<n>" for the other kinds
    kind: Kind
    # The review to open (products and brand pages); None where the vendor is what opens.
    review_id: uuid.UUID | None
    # The product's id for a product; the vendor's id for everything else.
    subject_id: uuid.UUID
    title: str
    vendor_id: uuid.UUID
    vendor_name: str
    decision: Decision
    at: datetime
    reviewer_id: uuid.UUID | None


@dataclass(frozen=True)
class AdminSummary:
    waiting_product: int
    waiting_brand_page: int
    waiting_application: int
    over_24h: int
    decided_today: int
    median_minutes: int | None
    resubmissions: int
    commission_proposals: int
    delivered_24h: int
    publishing_waiting: int
    publishing_retrying: int
    publishing_failed: int
    recent: list[RecentDecision]


@dataclass(frozen=True)
class _Waiting:
    product: int
    brand_page: int
    application: int
    over: int


def _application_decision() -> list[ColumnElement[bool]]:
    """An admin approving or rejecting an application: a vendor leaving `pending`."""
    return [
        VendorStatusEvent.actor_type == ActorType.ADMIN,
        VendorStatusEvent.from_status == VendorStatus.PENDING,
        VendorStatusEvent.to_status.in_([VendorStatus.APPROVED, VendorStatus.REJECTED]),
    ]


class AdminSummaryService:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock

    async def summary(self, db: AsyncSession) -> AdminSummary:
        now = self._clock()
        waiting = await self._waiting(db, now - OVER)
        decided_today, median = await self._decided_since(db, start_of_day_ist(now))
        publishing = await self._publishing(db, now - OVER)
        return AdminSummary(
            waiting_product=waiting.product,
            waiting_brand_page=waiting.brand_page,
            waiting_application=waiting.application,
            over_24h=waiting.over,
            decided_today=decided_today,
            median_minutes=median,
            resubmissions=await self._resubmissions(db),
            commission_proposals=await self._commission_proposals(db),
            delivered_24h=publishing[0],
            publishing_waiting=publishing[1],
            publishing_retrying=publishing[2],
            publishing_failed=publishing[3],
            recent=await self._recent(db),
        )

    async def _waiting(self, db: AsyncSession, cutoff: datetime) -> _Waiting:
        reviews = (
            await db.execute(
                select(
                    func.count().filter(Review.subject == ReviewSubject.PRODUCT),
                    func.count().filter(Review.subject == ReviewSubject.BRAND_PROFILE),
                    func.count().filter(Review.submitted_at < cutoff),
                ).where(Review.status == ReviewStatus.PENDING)
            )
        ).one()
        applications = (
            await db.execute(
                select(func.count(), func.count().filter(Vendor.created_at < cutoff)).where(
                    Vendor.status == VendorStatus.PENDING
                )
            )
        ).one()
        return _Waiting(
            product=int(reviews[0]),
            brand_page=int(reviews[1]),
            application=int(applications[0]),
            over=int(reviews[2]) + int(applications[1]),
        )

    async def _decided_since(self, db: AsyncSession, since: datetime) -> tuple[int, int | None]:
        """How many decisions since `since`, and the median minutes from submission to decision
        over them: the reviews, and the applications an admin approved or rejected."""
        waited = union_all(
            select(
                func.extract("epoch", Review.decided_at - Review.submitted_at).label("seconds")
            ).where(Review.status.in_(DECIDED), Review.decided_at >= since),
            select(
                func.extract("epoch", VendorStatusEvent.created_at - Vendor.created_at).label(
                    "seconds"
                )
            )
            .join(Vendor, Vendor.id == VendorStatusEvent.vendor_id)
            .where(*_application_decision(), VendorStatusEvent.created_at >= since),
        ).subquery()
        count, median = (
            await db.execute(
                select(func.count(), func.percentile_cont(0.5).within_group(waited.c.seconds))
            )
        ).one()
        minutes = None if median is None else max(0, round(float(median) / 60))
        return int(count), minutes

    async def _resubmissions(self, db: AsyncSession) -> int:
        """Waiting reviews of a second or later version: a brand page or product already seen."""
        version = func.coalesce(BrandProfile.version, ProductRevision.version)
        count = await db.scalar(
            select(func.count())
            .select_from(Review)
            .outerjoin(BrandProfile, BrandProfile.id == Review.brand_profile_id)
            .outerjoin(ProductRevision, ProductRevision.id == Review.product_revision_id)
            .where(Review.status == ReviewStatus.PENDING, version > 1)
        )
        return int(count or 0)

    async def _commission_proposals(self, db: AsyncSession) -> int:
        count = await db.scalar(
            select(func.count())
            .select_from(Commission)
            .where(Commission.state == CommissionState.PROPOSED)
        )
        return int(count or 0)

    async def _publishing(self, db: AsyncSession, since: datetime) -> tuple[int, int, int, int]:
        """Delivered in the last day, waiting, retrying, failed. `waiting` has not been tried
        yet, `retrying` has failed and will be tried again, `failed` gave up and needs a person."""
        open_ = [OutboxStatus.PENDING, OutboxStatus.SENDING]
        row = (
            await db.execute(
                select(
                    func.count().filter(
                        OutboxEvent.status == OutboxStatus.SENT, OutboxEvent.sent_at >= since
                    ),
                    func.count().filter(OutboxEvent.status.in_(open_), OutboxEvent.attempts == 0),
                    func.count().filter(OutboxEvent.status.in_(open_), OutboxEvent.attempts > 0),
                    func.count().filter(OutboxEvent.status == OutboxStatus.DEAD),
                )
                # The `sent` rows are by far the most (kept 30 days); only the last day's count.
                .where((OutboxEvent.status != OutboxStatus.SENT) | (OutboxEvent.sent_at >= since))
            )
        ).one()
        return int(row[0]), int(row[1]), int(row[2]), int(row[3])

    async def _recent(self, db: AsyncSession) -> list[RecentDecision]:
        """The latest decisions of the three kinds, newest first. Each source is cut to the limit
        in the database, so at most three times the limit is ever read."""
        found = [
            *await self._recent_reviews(db),
            *await self._recent_applications(db),
            *await self._recent_commissions(db),
        ]
        found.sort(key=lambda d: (d.at, d.id), reverse=True)
        return found[:RECENT_LIMIT]

    async def _recent_reviews(self, db: AsyncSession) -> list[RecentDecision]:
        rows = await db.execute(
            select(
                Review,
                Vendor.name,
                func.coalesce(BrandProfile.brand_name, ProductRevision.title),
                Product.id,
            )
            .join(Vendor, Vendor.id == Review.vendor_id)
            .outerjoin(BrandProfile, BrandProfile.id == Review.brand_profile_id)
            .outerjoin(ProductRevision, ProductRevision.id == Review.product_revision_id)
            .outerjoin(Product, Product.id == ProductRevision.product_id)
            .where(Review.status.in_(DECIDED), Review.decided_at.is_not(None))
            .order_by(Review.decided_at.desc(), Review.id.desc())
            .limit(RECENT_LIMIT)
            .execution_options(populate_existing=True)
        )
        return [
            RecentDecision(
                id=str(review.id),
                kind="product" if review.subject == ReviewSubject.PRODUCT else "brand_page",
                review_id=review.id,
                subject_id=product_id or review.vendor_id,
                title=title or vendor_name,
                vendor_id=review.vendor_id,
                vendor_name=vendor_name,
                decision="approved" if review.status == ReviewStatus.APPROVED else "rejected",
                at=review.decided_at,
                reviewer_id=review.reviewer_id,
            )
            for review, vendor_name, title, product_id in rows
            if review.decided_at is not None
        ]

    async def _recent_applications(self, db: AsyncSession) -> list[RecentDecision]:
        rows = await db.execute(
            select(VendorStatusEvent, Vendor.name)
            .join(Vendor, Vendor.id == VendorStatusEvent.vendor_id)
            .where(*_application_decision())
            .order_by(VendorStatusEvent.created_at.desc(), VendorStatusEvent.id.desc())
            .limit(RECENT_LIMIT)
        )
        return [
            RecentDecision(
                id=f"application-{event.id}",
                kind="application",
                review_id=None,
                subject_id=event.vendor_id,
                title=name,
                vendor_id=event.vendor_id,
                vendor_name=name,
                decision="approved" if event.to_status == VendorStatus.APPROVED else "rejected",
                at=event.created_at,
                reviewer_id=event.actor_id,
            )
            for event, name in rows
        ]

    async def _recent_commissions(self, db: AsyncSession) -> list[RecentDecision]:
        # `approved` and `set` put a rate in force; `sent_back` gives the proposal back.
        rows = await db.execute(
            select(VendorChangeEvent, Vendor.name)
            .join(Vendor, Vendor.id == VendorChangeEvent.vendor_id)
            .where(
                VendorChangeEvent.subject == ChangeSubject.COMMISSION,
                VendorChangeEvent.actor_type == ActorType.ADMIN,
                VendorChangeEvent.action.in_(["approved", "sent_back", "set"]),
            )
            .order_by(VendorChangeEvent.created_at.desc(), VendorChangeEvent.id.desc())
            .limit(RECENT_LIMIT)
        )
        return [
            RecentDecision(
                id=f"commission-{event.id}",
                kind="commission",
                review_id=None,
                subject_id=event.vendor_id,
                title=f"Commission: {name}",
                vendor_id=event.vendor_id,
                vendor_name=name,
                decision="rejected" if event.action == "sent_back" else "approved",
                at=event.created_at,
                reviewer_id=event.actor_id,
            )
            for event, name in rows
        ]
