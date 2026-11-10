"""Approving and rejecting what vendors submitted.

A decision is one transaction: the review is decided, the thing reviewed moves along its
documented path, one audit event is written, and the hooks run. If any step fails, none of it
happened. The reviewer is an identity-api admin whose id comes from the verified token; the caller
passes it in and nothing here ever reads it from a request body.

**What approving does.**
- A brand profile version: the published version becomes `superseded`, then the reviewed one
  becomes `published` (two updates in this order, because the database allows one published
  version per vendor and checks it per statement).
- A product revision: it becomes the product's live revision and the pending slot is emptied.
  The product becomes `approved`. Its `version` (what the central app uses to drop stale events)
  is raised when the live content *changes*, so the first time a product goes live it stays at 1.

**What rejecting does.** A brand profile version becomes `rejected`. A product that never went
live becomes `rejected`; a product that is live stays `approved` and keeps its live revision. The
rejected revision stays where it is, so the vendor sees the reason and edits a new revision.

**Stale reviews.** A review is refused with `409` when it is not what the reviewer looked at:
- `review_already_decided`: someone decided it first (so a double click or two reviewers cannot
  decide twice, and every decision has exactly one audit event);
- `stale_review`: the version the reviewer saw is not the one under review, the thing is no longer
  waiting for a decision (a product was archived, its pending slot moved on), or, for an approval,
  a newer version of the profile is already live (approving would put an older page over it).

All decisions of one vendor are serialised (its row is locked), so two reviewers working on the
same vendor cannot interleave the two updates of an approval.

**Hooks.** `add_hook(hook)` registers a coroutine that runs inside the transaction, after the
changes and the audit event and before the commit, with the `Decision` that was made. This is where
Phase 4 writes the central-app outbox row: it commits with the approval or not at all, and a hook
that raises undoes the whole decision.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import (
    ActorType,
    BrandProfile,
    BrandProfileState,
    Product,
    ProductRevision,
    ProductStatus,
    Review,
    ReviewAction,
    ReviewEvent,
    ReviewStatus,
    ReviewSubject,
    Vendor,
)
from vendor_api.services.review_queue import REVIEW_NOT_FOUND

Clock = Callable[[], datetime]

STALE_REVIEW = "stale_review"


def stale(message: str) -> ApiError:
    return ApiError(409, STALE_REVIEW, message)


@dataclass(frozen=True)
class Decision:
    """What a hook is told: the decided review and what the decision did."""

    review: Review
    action: ReviewAction  # approved or rejected
    reviewer_id: uuid.UUID
    # The audit event's `detail`: the subject and its state before and after.
    detail: dict[str, Any]
    brand_profile: BrandProfile | None = None
    # The version of the profile that went out of date because this one replaced it.
    superseded: BrandProfile | None = None
    product: Product | None = None
    revision: ProductRevision | None = None


DecisionHook = Callable[[AsyncSession, Decision], Awaitable[None]]


class ReviewDecisionService:
    """Decides reviews. Commits its own changes."""

    def __init__(
        self,
        clock: Clock = lambda: datetime.now(UTC),
        hooks: list[DecisionHook] | None = None,
    ) -> None:
        self._clock = clock
        self._hooks: list[DecisionHook] = list(hooks or [])

    def add_hook(self, hook: DecisionHook) -> None:
        """Runs `hook(db, decision)` inside every decision's transaction, before the commit."""
        self._hooks.append(hook)

    async def approve(
        self, db: AsyncSession, review_id: uuid.UUID, reviewer_id: uuid.UUID, version: int
    ) -> None:
        await self._decide(db, review_id, reviewer_id, version, ReviewAction.APPROVED, None)

    async def reject(
        self,
        db: AsyncSession,
        review_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        version: int,
        reason: str,
    ) -> None:
        if not reason.strip():
            raise ApiError(422, "reason_required", "A rejection needs a reason")
        await self._decide(
            db, review_id, reviewer_id, version, ReviewAction.REJECTED, reason.strip()
        )

    async def _decide(
        self,
        db: AsyncSession,
        review_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        version: int,
        action: ReviewAction,
        reason: str | None,
    ) -> None:
        try:
            review = await db.scalar(
                select(Review)
                .where(Review.id == review_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if review is None:
                raise REVIEW_NOT_FOUND
            # Always review first, then vendor: the same order everywhere, so no deadlock.
            await db.execute(
                select(Vendor.id).where(Vendor.id == review.vendor_id).with_for_update()
            )
            if review.status != ReviewStatus.PENDING:
                raise ApiError(
                    409, "review_already_decided", f"This review is already {review.status}"
                )
            # A clock a little behind the one that stamped the submission must not break
            # `decided_at >= submitted_at`.
            now = max(self._clock(), review.submitted_at)
            approving = action == ReviewAction.APPROVED
            if review.subject == ReviewSubject.BRAND_PROFILE:
                decision = await self._brand_profile(db, review, version, approving, now)
            else:
                decision = await self._product(db, review, version, approving)

            review.status = ReviewStatus.APPROVED if approving else ReviewStatus.REJECTED
            review.reviewer_id = reviewer_id
            review.decided_at = now
            review.reason = reason
            await db.flush()
            db.add(
                ReviewEvent(
                    review_id=review.id,
                    action=action,
                    actor_type=ActorType.ADMIN,
                    actor_id=reviewer_id,
                    reason=reason,
                    detail=decision["detail"],
                )
            )
            await db.flush()
            outcome = Decision(
                review=review,
                action=action,
                reviewer_id=reviewer_id,
                detail=decision["detail"],
                brand_profile=decision.get("profile"),
                superseded=decision.get("superseded"),
                product=decision.get("product"),
                revision=decision.get("revision"),
            )
            for hook in self._hooks:
                await hook(db, outcome)
            await db.commit()
        except BaseException:
            await db.rollback()
            raise

    # --- A brand profile version -------------------------------------------------------------

    async def _brand_profile(
        self, db: AsyncSession, review: Review, version: int, approving: bool, now: datetime
    ) -> dict[str, Any]:
        profile = await db.scalar(
            select(BrandProfile)
            .where(BrandProfile.id == review.brand_profile_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if profile is None:
            raise REVIEW_NOT_FOUND
        if profile.version != version:
            raise stale(
                f"You reviewed version {version}, but this review is about version "
                f"{profile.version}"
            )
        if profile.state != BrandProfileState.PENDING_REVIEW:
            raise stale(f"This version is no longer waiting for a decision (it is {profile.state})")
        live = await db.scalar(
            select(BrandProfile)
            .where(
                BrandProfile.vendor_id == profile.vendor_id,
                BrandProfile.state == BrandProfileState.PUBLISHED,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        before: dict[str, Any] = {
            "state": BrandProfileState.PENDING_REVIEW,
            "published_version": live.version if live else None,
        }
        superseded = None
        if approving:
            if live is not None and live.version > profile.version:
                raise stale(
                    f"Version {live.version} is already live: approving version {profile.version} "
                    "would replace it with an older page"
                )
            if live is not None:
                live.state = BrandProfileState.SUPERSEDED
                await db.flush()  # first, so there is never a moment with two published versions
                superseded = live
            profile.state = BrandProfileState.PUBLISHED
            profile.published_at = now
            after: dict[str, Any] = {
                "state": BrandProfileState.PUBLISHED,
                "superseded_version": superseded.version if superseded else None,
            }
        else:
            profile.state = BrandProfileState.REJECTED
            after = {
                "state": BrandProfileState.REJECTED,
                "published_version": before["published_version"],
            }
        await db.flush()
        return {
            "profile": profile,
            "superseded": superseded,
            "detail": {
                "subject": ReviewSubject.BRAND_PROFILE,
                "brand_profile_id": str(profile.id),
                "version": profile.version,
                "before": before,
                "after": after,
            },
        }

    # --- A product revision ------------------------------------------------------------------

    async def _product(
        self, db: AsyncSession, review: Review, version: int, approving: bool
    ) -> dict[str, Any]:
        revision = await db.scalar(
            select(ProductRevision)
            .where(ProductRevision.id == review.product_revision_id)
            .execution_options(populate_existing=True)
        )
        if revision is None:
            raise REVIEW_NOT_FOUND
        product = await db.scalar(
            select(Product)
            .where(Product.id == revision.product_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if product is None:
            raise REVIEW_NOT_FOUND
        if revision.version != version:
            raise stale(
                f"You reviewed version {version}, but this review is about version "
                f"{revision.version}"
            )
        if product.status == ProductStatus.ARCHIVED:
            raise stale("This product was archived")
        if product.pending_revision_id != revision.id or revision.submitted_at is None:
            raise stale("This revision is no longer the one waiting for a decision")

        live = None
        if product.live_revision_id is not None:
            live = await db.scalar(
                select(ProductRevision).where(ProductRevision.id == product.live_revision_id)
            )
        before: dict[str, Any] = {
            "status": product.status,
            "product_version": product.version,
            "live_revision_version": live.version if live else None,
        }
        if approving:
            was_live = product.live_revision_id is not None
            # One UPDATE: the revision cannot be both live and pending (a check constraint).
            product.live_revision_id = revision.id
            product.pending_revision_id = None
            product.status = ProductStatus.APPROVED
            if was_live:
                product.version += 1  # the live content changed: the central app must hear of it
        elif product.live_revision_id is None:
            product.status = ProductStatus.REJECTED
        # A live product that is rejected stays approved, with its live revision; the rejected
        # revision stays in the pending slot so the vendor sees why.
        await db.flush()
        after: dict[str, Any] = {
            "status": product.status,
            "product_version": product.version,
            "live_revision_version": (
                revision.version if approving else (live.version if live else None)
            ),
        }
        return {
            "product": product,
            "revision": revision,
            "detail": {
                "subject": ReviewSubject.PRODUCT,
                "product_id": str(product.id),
                "sku": product.sku,
                "revision_id": str(revision.id),
                "version": revision.version,
                "before": before,
                "after": after,
            },
        }
