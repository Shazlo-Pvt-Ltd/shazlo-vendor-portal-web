"""The admin queue: everything waiting for a reviewer, as one list (#294).

Three kinds of thing wait, and they live in three places: a product revision under review, a
brand profile version under review, and a vendor that applied. The reviewers' screen sorts, filters
and pages them together, which cannot be done by merging three lists in the browser: page 2 of a
merged list is not page 2 of any one of them. So the list is a `UNION ALL` of three selects with the
same columns, and the filters, the order and the paging run on that union, in the database.

**What each item is** (the same shape the screen has always read):
- product: the review's id; the subject is the product; the detail is its SKU. `edit` when the
  product is already live (`live_revision_id`), else `new`. The thumbnail is the revision's image
  in position 1 (there are no named photo slots yet, #288).
- brand page: the review's id; the subject is the vendor (a vendor has one brand page). `edit`
  when an earlier version was ever published, else `new`. The thumbnail is the banner, else the
  logo.
- application: the vendor's id; the subject is the vendor too. Applications cannot be sent back
  (a rejected vendor does not return to pending), so `resubmission` is always 0 for them.

**`resubmission`** is how many reviews of the same product (or the vendor's brand page) were
rejected before this one was submitted.

**Counts and vendors** describe the whole waiting queue, not the filtered list: the tabs and the
vendor filter must keep showing every choice while one is selected.

**Order:** oldest submission first (the one waiting longest is on top), or newest first. Items
with the same time keep a fixed order (by id), so paging never repeats or skips one.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import (
    Integer,
    String,
    and_,
    case,
    cast,
    exists,
    func,
    literal_column,
    null,
    or_,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from vendor_api.db.models import (
    Asset,
    BrandProfile,
    Product,
    ProductImage,
    ProductRevision,
    Review,
    ReviewStatus,
    ReviewSubject,
    Vendor,
    VendorStatus,
)

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 50
MAX_TEXT = 200

Kind = Literal["product", "brand_page", "application"]
Submitted = Literal["today", "24h", "older"]
Sort = Literal["oldest", "newest"]

KINDS: tuple[Kind, ...] = ("product", "brand_page", "application")


@dataclass(frozen=True)
class QueueVendor:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class QueueItem:
    id: uuid.UUID
    kind: str
    subject_id: uuid.UUID
    title: str
    detail: str
    vendor: QueueVendor
    submitted_at: datetime
    change: str
    resubmission: int
    thumbnail_url: str | None


@dataclass(frozen=True)
class QueuePage:
    items: list[QueueItem]
    # How many items match the filters (what paging walks through).
    total: int
    limit: int
    offset: int
    # The whole waiting queue by kind, whatever the filters.
    counts: dict[str, int]
    # Every vendor with something waiting, whatever the filters, by name.
    vendors: list[QueueVendor]


def like_pattern(text: str) -> str:
    """`text` as a `LIKE` pattern that matches it literally: `%`, `_` and `\\` are escaped."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _kind(name: str) -> Any:
    return literal_column(f"'{name}'", String)


def _waiting_products() -> Any:
    earlier = aliased(Review)
    earlier_revision = aliased(ProductRevision)
    sent_back = (
        select(func.count())
        .select_from(earlier)
        .join(earlier_revision, earlier_revision.id == earlier.product_revision_id)
        .where(
            earlier_revision.product_id == Product.id,
            earlier.status == ReviewStatus.REJECTED,
            earlier.submitted_at < Review.submitted_at,
        )
        .correlate(Review, Product)
        .scalar_subquery()
    )
    first_photo = (
        select(Asset.url)
        .select_from(ProductImage)
        .join(Asset, Asset.id == ProductImage.asset_id)
        .where(ProductImage.revision_id == ProductRevision.id)
        .order_by(ProductImage.position)
        .limit(1)
        .correlate(ProductRevision)
        .scalar_subquery()
    )
    return (
        select(
            Review.id.label("id"),
            _kind("product").label("kind"),
            Product.id.label("subject_id"),
            ProductRevision.title.label("title"),
            Product.sku.label("detail"),
            Vendor.id.label("vendor_id"),
            Vendor.name.label("vendor_name"),
            Review.submitted_at.label("submitted_at"),
            case(
                (Product.live_revision_id.is_not(None), literal_column("'edit'", String)),
                else_=literal_column("'new'", String),
            ).label("change"),
            cast(sent_back, Integer).label("resubmission"),
            first_photo.label("thumbnail_url"),
        )
        .select_from(Review)
        .join(ProductRevision, ProductRevision.id == Review.product_revision_id)
        .join(Product, Product.id == ProductRevision.product_id)
        .join(Vendor, Vendor.id == Review.vendor_id)
        .where(Review.status == ReviewStatus.PENDING, Review.subject == ReviewSubject.PRODUCT)
    )


def _waiting_brand_pages() -> Any:
    earlier = aliased(Review)
    earlier_version = aliased(BrandProfile)
    banner = aliased(Asset)
    logo = aliased(Asset)
    was_published = exists().where(
        earlier_version.vendor_id == BrandProfile.vendor_id,
        earlier_version.version < BrandProfile.version,
        earlier_version.published_at.is_not(None),
    )
    sent_back = (
        select(func.count())
        .select_from(earlier)
        .where(
            earlier.vendor_id == Review.vendor_id,
            earlier.subject == ReviewSubject.BRAND_PROFILE,
            earlier.status == ReviewStatus.REJECTED,
            earlier.submitted_at < Review.submitted_at,
        )
        .correlate(Review)
        .scalar_subquery()
    )
    return (
        select(
            Review.id.label("id"),
            _kind("brand_page").label("kind"),
            Vendor.id.label("subject_id"),
            (BrandProfile.brand_name + literal_column("' brand page'", String)).label("title"),
            case(
                (was_published, literal_column("'Edit to a live page'", String)),
                else_=literal_column("'First brand page'", String),
            ).label("detail"),
            Vendor.id.label("vendor_id"),
            Vendor.name.label("vendor_name"),
            Review.submitted_at.label("submitted_at"),
            case(
                (was_published, literal_column("'edit'", String)),
                else_=literal_column("'new'", String),
            ).label("change"),
            cast(sent_back, Integer).label("resubmission"),
            func.coalesce(banner.url, logo.url).label("thumbnail_url"),
        )
        .select_from(Review)
        .join(BrandProfile, BrandProfile.id == Review.brand_profile_id)
        .join(Vendor, Vendor.id == Review.vendor_id)
        .outerjoin(banner, banner.id == BrandProfile.banner_asset_id)
        .outerjoin(logo, logo.id == BrandProfile.logo_asset_id)
        .where(Review.status == ReviewStatus.PENDING, Review.subject == ReviewSubject.BRAND_PROFILE)
    )


def _waiting_applications() -> Any:
    return (
        select(
            Vendor.id.label("id"),
            _kind("application").label("kind"),
            Vendor.id.label("subject_id"),
            Vendor.name.label("title"),
            (literal_column("'Vendor application · '", String) + Vendor.product_type).label(
                "detail"
            ),
            Vendor.id.label("vendor_id"),
            Vendor.name.label("vendor_name"),
            Vendor.created_at.label("submitted_at"),
            _kind("application").label("change"),
            literal_column("0", Integer).label("resubmission"),
            cast(null(), String).label("thumbnail_url"),
        )
        .select_from(Vendor)
        .where(Vendor.status == VendorStatus.PENDING)
    )


class AdminQueueService:
    """Lists what is waiting for a reviewer. Read only."""

    async def list_queue(
        self,
        db: AsyncSession,
        *,
        kind: Kind | None = None,
        vendor_id: uuid.UUID | None = None,
        text: str | None = None,
        submitted: Submitted | None = None,
        resubmissions: bool = False,
        sort: Sort = "oldest",
        limit: int = DEFAULT_PAGE_SIZE,
        offset: int = 0,
        now: datetime | None = None,
    ) -> QueuePage:
        waiting = union_all(
            _waiting_products(), _waiting_brand_pages(), _waiting_applications()
        ).subquery("waiting")
        c = waiting.c

        conditions: list[Any] = []
        if kind is not None:
            conditions.append(c.kind == kind)
        if vendor_id is not None:
            conditions.append(c.vendor_id == vendor_id)
        if text:
            pattern = like_pattern(text)
            conditions.append(
                or_(
                    c.title.ilike(pattern, escape="\\"),
                    c.detail.ilike(pattern, escape="\\"),
                    c.vendor_name.ilike(pattern, escape="\\"),
                )
            )
        if submitted is not None:
            moment = now or datetime.now(UTC)
            day, two_days = moment - timedelta(hours=24), moment - timedelta(hours=48)
            if submitted == "today":
                conditions.append(c.submitted_at > day)
            elif submitted == "24h":
                conditions.append(and_(c.submitted_at <= day, c.submitted_at > two_days))
            else:
                conditions.append(c.submitted_at <= two_days)
        if resubmissions:
            conditions.append(c.resubmission > 0)

        total = await db.scalar(select(func.count()).select_from(waiting).where(*conditions))
        newest = sort == "newest"
        order = (c.submitted_at.desc(), c.id.desc()) if newest else (c.submitted_at, c.id)
        rows = await db.execute(
            select(waiting).where(*conditions).order_by(*order).limit(limit).offset(offset)
        )
        counted = await db.execute(select(c.kind, func.count()).group_by(c.kind))
        by_kind: dict[str, int] = dict(counted.tuples().all())
        counts: dict[str, int] = {name: by_kind.get(name, 0) for name in KINDS}
        vendor_rows = await db.execute(
            select(c.vendor_id, c.vendor_name)
            .group_by(c.vendor_id, c.vendor_name)
            .order_by(func.lower(c.vendor_name), c.vendor_id)
        )
        return QueuePage(
            items=[
                QueueItem(
                    id=r.id,
                    kind=r.kind,
                    subject_id=r.subject_id,
                    title=r.title,
                    detail=r.detail,
                    vendor=QueueVendor(r.vendor_id, r.vendor_name),
                    submitted_at=r.submitted_at,
                    change=r.change,
                    resubmission=r.resubmission,
                    thumbnail_url=r.thumbnail_url,
                )
                for r in rows
            ],
            total=total or 0,
            limit=limit,
            offset=offset,
            counts={"all": sum(counts.values()), **counts},
            vendors=[QueueVendor(v.vendor_id, v.vendor_name) for v in vendor_rows],
        )
