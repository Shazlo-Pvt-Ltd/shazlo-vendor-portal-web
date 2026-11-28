"""What happened to everything a vendor submitted: one list of its reviews.

Reads only. The reviewer is private, so the rows built here have no reviewer field to leak: a
vendor sees the decision, the reason and the times, never who made it.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    BrandProfile,
    Product,
    ProductRevision,
    Review,
    ReviewStatus,
    ReviewSubject,
)
from vendor_api.db.scoped import scoped_select

MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class Submission:
    subject: ReviewSubject
    # The brand profile's id, or the product's id (not the revision's).
    item_id: uuid.UUID
    sku: str | None
    title: str | None
    version: int
    status: str
    reason: str | None
    reason_code: str | None
    submitted_at: datetime
    decided_at: datetime | None


@dataclass(frozen=True)
class SubmissionPage:
    items: list[Submission]
    total: int
    limit: int
    offset: int


class SubmissionService:
    async def list_submissions(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        *,
        status: ReviewStatus | None,
        subject: ReviewSubject | None,
        limit: int,
        offset: int,
    ) -> SubmissionPage:
        """The vendor's reviews, newest submission first."""
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        offset = max(0, offset)
        base = (
            scoped_select(Review, vendor_id)
            .outerjoin(BrandProfile, BrandProfile.id == Review.brand_profile_id)
            .outerjoin(ProductRevision, ProductRevision.id == Review.product_revision_id)
            .outerjoin(Product, Product.id == ProductRevision.product_id)
        )
        if status is not None:
            base = base.where(Review.status == status)
        if subject is not None:
            base = base.where(Review.subject == subject)
        total = await db.scalar(
            select(func.count()).select_from(base.with_only_columns(Review.id).subquery())
        )
        rows = await db.execute(
            base.with_only_columns(
                Review,
                Product.id.label("product_id"),
                Product.sku.label("sku"),
                ProductRevision.title.label("title"),
                BrandProfile.version.label("brand_version"),
                ProductRevision.version.label("revision_version"),
            )
            .order_by(Review.submitted_at.desc(), Review.id.desc())
            .limit(limit)
            .offset(offset)
        )
        items = []
        for row in rows:
            review = row.Review
            is_brand = review.subject == ReviewSubject.BRAND_PROFILE
            item_id = review.brand_profile_id if is_brand else row.product_id
            version = row.brand_version if is_brand else row.revision_version
            if item_id is None or version is None:  # the foreign keys make this impossible
                continue
            items.append(
                Submission(
                    subject=ReviewSubject(review.subject),
                    item_id=item_id,
                    sku=row.sku,
                    title=row.title,
                    version=version,
                    status=review.status,
                    reason=review.reason,
                    reason_code=review.reason_code,
                    submitted_at=review.submitted_at,
                    decided_at=review.decided_at,
                )
            )
        return SubmissionPage(items, total or 0, limit, offset)
