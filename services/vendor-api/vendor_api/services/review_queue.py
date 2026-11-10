"""The reviewers' side of reviews: the queue, and one review with what changed.

Reviewers (identity-api admins) see every vendor's submissions, so nothing here is scoped to a
vendor. It only reads: deciding a review is a separate step.

**What a review is compared with.** A review points at the exact version row a vendor submitted.
The version it is compared with is **the last one that went live before it**:
- a brand profile: the newest version with a `published_at` and a lower version number (so a
  pending version 3 is compared with the published 2, and with 1 if 2 was never published, and an
  approved version is still shown against what it replaced);
- a product revision: the product's live revision if it is older, otherwise the newest older
  revision that was ever approved.
With nothing before it (a first submission) every field that has a value is listed as added.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import (
    Asset,
    BrandProfile,
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductVariant,
    Review,
    ReviewEvent,
    ReviewStatus,
    ReviewSubject,
    Vendor,
    VendorUser,
)
from vendor_api.services.review_diff import (
    BRAND_FIELDS,
    PRODUCT_FIELDS,
    Change,
    diff_brand_profile,
    diff_product,
)

REVIEW_NOT_FOUND = ApiError(404, "review_not_found", "Review not found")
MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class ReviewRow:
    """One line of the queue."""

    review: Review
    vendor_name: str
    vendor_slug: str
    vendor_status: str
    submitted_by_email: str
    # The version under review. Brand profile: its version and name. Product: the product, its
    # SKU, the revision's version and its title.
    version: int
    title: str
    product_id: uuid.UUID | None
    sku: str | None


@dataclass(frozen=True)
class ReviewPage:
    items: list[ReviewRow]
    total: int
    limit: int
    offset: int


@dataclass(frozen=True)
class Version:
    """A version of the thing reviewed, as the reviewer sees it."""

    version: int
    content: dict[str, Any]
    published_at: datetime | None = None


@dataclass(frozen=True)
class ReviewDetail:
    row: ReviewRow
    events: list[ReviewEvent]
    content: Version
    # What it is compared with; None for a first submission.
    base: Version | None
    changes: list[Change] = field(default_factory=list)


class ReviewQueueService:
    """Lists reviews and shows one with its changes. Read only."""

    async def list_reviews(
        self,
        db: AsyncSession,
        *,
        status: ReviewStatus | None,
        subject: ReviewSubject | None,
        vendor_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> ReviewPage:
        """The queue. Pending reviews come oldest first (the one waiting longest is first); any
        other status, or all, newest first."""
        conditions: list[Any] = []
        if status is not None:
            conditions.append(Review.status == status)
        if subject is not None:
            conditions.append(Review.subject == subject)
        if vendor_id is not None:
            conditions.append(Review.vendor_id == vendor_id)
        query = self._base_query().where(*conditions)
        total = await db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
        if status == ReviewStatus.PENDING:
            order = (Review.submitted_at.asc(), Review.id)
        else:
            order = (Review.submitted_at.desc(), Review.id)
        rows = await db.execute(
            query.order_by(*order)
            .limit(limit)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
        return ReviewPage([_row(r) for r in rows], total or 0, limit, offset)

    async def get_review(self, db: AsyncSession, review_id: uuid.UUID) -> ReviewDetail:
        result = await db.execute(
            self._base_query()
            .where(Review.id == review_id)
            .execution_options(populate_existing=True)
        )
        found = result.first()
        if found is None:
            raise REVIEW_NOT_FOUND
        row = _row(found)
        events = list(
            await db.scalars(
                select(ReviewEvent)
                .where(ReviewEvent.review_id == review_id)
                .order_by(ReviewEvent.id)
            )
        )
        if row.review.subject == ReviewSubject.BRAND_PROFILE:
            content, base, changes = await self._brand_profile(db, row.review)
        else:
            content, base, changes = await self._product(db, row.review)
        return ReviewDetail(row, events, content, base, changes)

    # --- The queue's query -------------------------------------------------------------------

    def _base_query(self) -> Any:
        profile_name = BrandProfile.brand_name
        return (
            select(
                Review,
                Vendor.name,
                Vendor.slug,
                Vendor.status,
                VendorUser.email,
                func.coalesce(BrandProfile.version, ProductRevision.version).label("version"),
                func.coalesce(profile_name, ProductRevision.title).label("title"),
                Product.id.label("product_id"),
                Product.sku,
            )
            .join(Vendor, Vendor.id == Review.vendor_id)
            .join(VendorUser, VendorUser.id == Review.submitted_by)
            .outerjoin(BrandProfile, BrandProfile.id == Review.brand_profile_id)
            .outerjoin(ProductRevision, ProductRevision.id == Review.product_revision_id)
            .outerjoin(Product, Product.id == ProductRevision.product_id)
        )

    # --- A brand profile ---------------------------------------------------------------------

    async def _brand_profile(
        self, db: AsyncSession, review: Review
    ) -> tuple[Version, Version | None, list[Change]]:
        profile = await db.scalar(
            select(BrandProfile)
            .where(BrandProfile.id == review.brand_profile_id)
            .execution_options(populate_existing=True)
        )
        if profile is None:  # the foreign key makes this impossible
            raise REVIEW_NOT_FOUND
        earlier = await db.scalar(
            select(BrandProfile)
            .where(
                BrandProfile.vendor_id == profile.vendor_id,
                BrandProfile.version < profile.version,
                BrandProfile.published_at.is_not(None),
            )
            .order_by(BrandProfile.version.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        assets = await self._assets(
            db,
            [
                a
                for p in (profile, earlier)
                if p is not None
                for a in (p.logo_asset_id, p.banner_asset_id)
            ],
        )
        content = _brand_content(profile, assets)
        base = _brand_content(earlier, assets) if earlier is not None else None
        changes = diff_brand_profile(base, content)
        return (
            Version(profile.version, content, profile.published_at),
            Version(earlier.version, base or {}, earlier.published_at) if earlier else None,
            changes,
        )

    async def _assets(
        self, db: AsyncSession, ids: list[uuid.UUID | None]
    ) -> dict[uuid.UUID, Asset]:
        wanted = {i for i in ids if i is not None}
        if not wanted:
            return {}
        rows = await db.scalars(select(Asset).where(Asset.id.in_(wanted)))
        return {a.id: a for a in rows}

    # --- A product revision ------------------------------------------------------------------

    async def _product(
        self, db: AsyncSession, review: Review
    ) -> tuple[Version, Version | None, list[Change]]:
        revision = await db.scalar(
            select(ProductRevision)
            .where(ProductRevision.id == review.product_revision_id)
            .execution_options(populate_existing=True)
        )
        if revision is None:
            raise REVIEW_NOT_FOUND
        earlier = await self._earlier_live_revision(db, revision)
        content = await self._revision_content(db, revision)
        base = await self._revision_content(db, earlier) if earlier is not None else None
        changes = diff_product(base, content)
        return (
            Version(revision.version, content),
            Version(earlier.version, base or {}) if earlier is not None and base else None,
            changes,
        )

    async def _earlier_live_revision(
        self, db: AsyncSession, revision: ProductRevision
    ) -> ProductRevision | None:
        """What this revision replaces: the live revision if it is older, else the newest older
        revision that was ever approved."""
        product = await db.scalar(
            select(Product)
            .where(Product.id == revision.product_id)
            .execution_options(populate_existing=True)
        )
        if product is not None and product.live_revision_id is not None:
            live = await db.scalar(
                select(ProductRevision)
                .where(ProductRevision.id == product.live_revision_id)
                .execution_options(populate_existing=True)
            )
            if live is not None and live.version < revision.version:
                return live
        approved = exists().where(
            Review.product_revision_id == ProductRevision.id,
            Review.status == ReviewStatus.APPROVED,
        )
        return await db.scalar(
            select(ProductRevision)
            .where(
                ProductRevision.product_id == revision.product_id,
                ProductRevision.version < revision.version,
                approved,
            )
            .order_by(ProductRevision.version.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )

    async def _revision_content(
        self, db: AsyncSession, revision: ProductRevision
    ) -> dict[str, Any]:
        variant_rows = await db.execute(
            select(ProductVariant, ProductRevisionVariant)
            .join(ProductRevisionVariant, ProductRevisionVariant.variant_id == ProductVariant.id)
            .where(ProductRevisionVariant.revision_id == revision.id)
            .order_by(ProductVariant.sku_key)
        )
        image_rows = await db.execute(
            select(ProductImage, Asset.url)
            .join(Asset, Asset.id == ProductImage.asset_id)
            .where(ProductImage.revision_id == revision.id)
            .order_by(ProductImage.position)
        )
        content: dict[str, Any] = {name: getattr(revision, name) for name in PRODUCT_FIELDS}
        content["variants"] = [
            {
                "sku": v.sku,
                "size": v.size,
                "color": v.color,
                "price_paise": rv.price_paise,
                "mrp_paise": rv.mrp_paise,
                "is_active": rv.is_active,
            }
            for v, rv in variant_rows
        ]
        content["images"] = [
            {
                "position": image.position,
                "asset_id": str(image.asset_id),
                "url": url,
                "alt_text": image.alt_text,
            }
            for image, url in image_rows
        ]
        return content


def _row(found: Any) -> ReviewRow:
    review, name, slug, vendor_status, email, version, title, product_id, sku = found
    return ReviewRow(
        review=review,
        vendor_name=name,
        vendor_slug=slug,
        vendor_status=vendor_status,
        submitted_by_email=email,
        version=version,
        title=title,
        product_id=product_id,
        sku=sku,
    )


def _asset_ref(asset: Asset | None) -> dict[str, str] | None:
    return None if asset is None else {"asset_id": str(asset.id), "url": asset.url}


def _brand_content(profile: BrandProfile, assets: dict[uuid.UUID, Asset]) -> dict[str, Any]:
    content: dict[str, Any] = {name: getattr(profile, name, None) for name in BRAND_FIELDS}
    content["logo"] = _asset_ref(
        assets.get(profile.logo_asset_id) if profile.logo_asset_id else None
    )
    content["banner"] = _asset_ref(
        assets.get(profile.banner_asset_id) if profile.banner_asset_id else None
    )
    content["categories"] = list(profile.categories)
    return content
