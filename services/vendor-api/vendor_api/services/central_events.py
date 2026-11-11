"""The events vendor-api sends to the central app (ADR 0003): full-state payloads.

Every event carries the **whole current state** of its aggregate, not a change, so a missed
event is repaired by the next one. The builders here are pure functions of rows already read from
the database: they never query, never read the clock (unless the caller lets them) and never
write. `load_*` below do the reading. Whatever a builder returns has been validated against the
contract's schemas, which refuse unknown fields (so stock, a phone number or an email cannot be
added by accident); a payload that does not validate is a bug and raises `InvalidEvent`.

Versions are monotonic per aggregate and are the caller's to assign:

- `brand_profile`: the aggregate is the vendor's brand page (its id is the vendor id);
  `published` carries the published profile's own `version`, unless the page's events have
  already gone past it (a suspension and reinstatement): the caller then gives the next one.
- `product`: `Product.version`, which the catalog service raises whenever the live product changes.
- `vendor`: the number of the status change, counting the vendor's creation as the first (see
  `vendor_status_version`), so the first change an admin makes is version 2.
- an `unpublished` event needs a version above the one last published, and is refused for
  something that was never published.

Times are UTC with whole seconds, `2026-10-24T08:00:00Z`, like the contract's examples, so the
same state always serialises to the same bytes.
"""

import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Asset,
    AssetStatus,
    BrandProfile,
    BrandProfileState,
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductStatus,
    ProductVariant,
    Vendor,
    VendorStatus,
    VendorStatusEvent,
)
from vendor_api.services.central_contract import MAX_BODY_BYTES, InvalidEvent, contract

PRODUCER = "vendor-api"
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
# The contract's limit on `vendor.status_changed.payload.reason`.
MAX_STATUS_REASON = 500
BRAND_UNPUBLISH_REASONS = frozenset({"withdrawn", "vendor_suspended", "rejected_after_publish"})
PRODUCT_UNPUBLISH_REASONS = frozenset(
    {"withdrawn", "archived", "back_in_review", "vendor_suspended", "rejected_after_publish"}
)


class EventBuildError(Exception):
    """The state cannot be turned into this event (for example: it is not published)."""


class EventTooLarge(EventBuildError):
    """The serialised event is over the contract's 256 KB limit."""


def iso(moment: datetime) -> str:
    """UTC, whole seconds, `Z`: the contract's form."""
    if moment.tzinfo is None:
        raise EventBuildError("a time needs a time zone")
    return moment.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class BuiltEvent:
    """A validated event. The fields are the outbox row's columns (`event_type`, `aggregate_type`,
    `aggregate_id`, `vendor_id`, `version`, `payload`) plus what the envelope needs."""

    event_id: uuid.UUID
    event_type: str
    aggregate_type: str
    aggregate_id: uuid.UUID
    vendor_id: uuid.UUID
    version: int
    occurred_at: datetime
    payload: dict[str, Any]

    def envelope(self) -> dict[str, Any]:
        return {
            "event_id": str(self.event_id),
            "type": self.event_type,
            "version": self.version,
            "occurred_at": iso(self.occurred_at),
            "producer": PRODUCER,
            "aggregate": {"type": self.aggregate_type, "id": str(self.aggregate_id)},
            "payload": self.payload,
        }

    def body(self) -> bytes:
        """The exact bytes to send and to sign: compact JSON, keys in a fixed order."""
        return json.dumps(self.envelope(), separators=(",", ":"), ensure_ascii=False).encode()


def _build(
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: uuid.UUID,
    vendor_id: uuid.UUID,
    version: int,
    payload: dict[str, Any],
    event_id: uuid.UUID | None,
    occurred_at: datetime | None,
) -> BuiltEvent:
    event = BuiltEvent(
        event_id=event_id or uuid.uuid4(),
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        vendor_id=vendor_id,
        version=version,
        occurred_at=occurred_at or datetime.now(UTC),
        payload=payload,
    )
    contract().validate(event.envelope())  # raises InvalidEvent
    if len(event.body()) > MAX_BODY_BYTES:
        raise EventTooLarge(f"the {event_type} event is over {MAX_BODY_BYTES} bytes")
    return event


def _present(**fields: Any) -> dict[str, Any]:
    """The fields that have a value: the contract has no `null`, an absent field means none."""
    return {name: value for name, value in fields.items() if value is not None}


# --- brand pages ----------------------------------------------------------------------------


@dataclass(frozen=True)
class BrandSnapshot:
    vendor: Vendor
    profile: BrandProfile
    logo: Asset | None
    banner: Asset | None


def brand_profile_published(
    snapshot: BrandSnapshot,
    *,
    version: int | None = None,
    event_id: uuid.UUID | None = None,
    occurred_at: datetime | None = None,
) -> BuiltEvent:
    """The vendor's published brand page, in full. Its version is the profile's own, unless the
    page's events have gone past it: then the caller gives the next event version."""
    vendor, profile = snapshot.vendor, snapshot.profile
    if profile.vendor_id != vendor.id:
        raise EventBuildError("the profile belongs to another vendor")
    if profile.state != BrandProfileState.PUBLISHED or profile.published_at is None:
        raise EventBuildError("only the published profile can be published")
    for asset in (snapshot.logo, snapshot.banner):
        if asset is not None and (
            asset.status != AssetStatus.READY or asset.vendor_id != vendor.id
        ):
            raise EventBuildError("an image of the brand page is not a ready file of the vendor")
    payload = _present(
        vendor_id=str(vendor.id),
        slug=vendor.slug,
        brand_name=profile.brand_name,
        tagline=profile.tagline,
        about=profile.about,
        logo_url=snapshot.logo.url if snapshot.logo else None,
        banner_url=snapshot.banner.url if snapshot.banner else None,
        website_url=profile.website_url,
        instagram_handle=profile.instagram_handle,
        categories=list(profile.categories),
        price_range={"min_paise": profile.price_min_paise, "max_paise": profile.price_max_paise},
        published_at=iso(profile.published_at),
    )
    return _build(
        event_type="brand_profile.published",
        aggregate_type="brand_profile",
        aggregate_id=vendor.id,
        vendor_id=vendor.id,
        version=profile.version if version is None else version,
        payload=payload,
        event_id=event_id,
        occurred_at=occurred_at,
    )


def brand_profile_unpublished(
    vendor_id: uuid.UUID,
    *,
    version: int,
    last_published_version: int | None,
    reason: str,
    unpublished_at: datetime,
    event_id: uuid.UUID | None = None,
    occurred_at: datetime | None = None,
) -> BuiltEvent:
    """The brand page is no longer shown. `last_published_version` is the version of the last
    `brand_profile.published` event, or None if there never was one (then this is refused)."""
    _require_published_before(last_published_version, version, "brand page")
    if reason not in BRAND_UNPUBLISH_REASONS:
        raise EventBuildError(
            f"a brand page is unpublished for one of {sorted(BRAND_UNPUBLISH_REASONS)}"
        )
    return _build(
        event_type="brand_profile.unpublished",
        aggregate_type="brand_profile",
        aggregate_id=vendor_id,
        vendor_id=vendor_id,
        version=version,
        payload={
            "vendor_id": str(vendor_id),
            "reason": reason,
            "unpublished_at": iso(unpublished_at),
        },
        event_id=event_id,
        occurred_at=occurred_at,
    )


# --- products ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class ProductSnapshot:
    product: Product
    revision: ProductRevision
    variants: Sequence[tuple[ProductVariant, ProductRevisionVariant]]
    images: Sequence[tuple[ProductImage, Asset]]


def product_published(
    snapshot: ProductSnapshot,
    *,
    published_at: datetime,
    version: int | None = None,
    event_id: uuid.UUID | None = None,
    occurred_at: datetime | None = None,
) -> BuiltEvent:
    """The live revision of an approved product, in full: its offered variants and its images in
    order, prices in paise. There is no stock here, and no contact data."""
    product, revision = snapshot.product, snapshot.revision
    if product.status != ProductStatus.APPROVED or product.live_revision_id != revision.id:
        raise EventBuildError("only the live revision of an approved product can be published")
    variants = sorted(
        (
            (variant, offer)
            for variant, offer in snapshot.variants
            if offer.is_active and offer.revision_id == revision.id
        ),
        # The order the vendor created them in; variants made together fall back to the SKU.
        key=lambda pair: (pair[0].created_at or _EPOCH, pair[0].sku_key, str(pair[0].id)),
    )
    images = sorted(snapshot.images, key=lambda pair: pair[0].position)
    if any(
        asset.status != AssetStatus.READY or asset.vendor_id != product.vendor_id
        for _, asset in images
    ):
        raise EventBuildError("an image of the product is not a ready file of the vendor")
    payload = _present(
        product_id=str(product.id),
        vendor_id=str(product.vendor_id),
        sku=product.sku,
        title=revision.title,
        description=revision.description,
        category=revision.category,
        subcategory=revision.subcategory,
        gender=revision.gender,
        fabric=revision.fabric,
        variants=[
            _present(
                variant_id=str(variant.id),
                sku=variant.sku,
                # An empty size or colour means "none": it is left out.
                size=variant.size or None,
                color=variant.color or None,
                price_paise=offer.price_paise,
                mrp_paise=offer.mrp_paise,
            )
            for variant, offer in variants
        ],
        images=[
            _present(url=asset.url, position=image.position, alt=image.alt_text)
            for image, asset in images
        ],
        weight_grams=revision.weight_grams,
        returnable=revision.returnable,
        return_window_days=revision.return_window_days,
        published_at=iso(published_at),
    )
    return _build(
        event_type="product.published",
        aggregate_type="product",
        aggregate_id=product.id,
        vendor_id=product.vendor_id,
        version=product.version if version is None else version,
        payload=payload,
        event_id=event_id,
        occurred_at=occurred_at,
    )


def product_unpublished(
    product_id: uuid.UUID,
    vendor_id: uuid.UUID,
    *,
    version: int,
    last_published_version: int | None,
    reason: str,
    unpublished_at: datetime,
    event_id: uuid.UUID | None = None,
    occurred_at: datetime | None = None,
) -> BuiltEvent:
    """The product is no longer for sale. Refused if it was never published."""
    _require_published_before(last_published_version, version, "product")
    if reason not in PRODUCT_UNPUBLISH_REASONS:
        raise EventBuildError(
            f"a product is unpublished for one of {sorted(PRODUCT_UNPUBLISH_REASONS)}"
        )
    return _build(
        event_type="product.unpublished",
        aggregate_type="product",
        aggregate_id=product_id,
        vendor_id=vendor_id,
        version=version,
        payload={
            "product_id": str(product_id),
            "vendor_id": str(vendor_id),
            "reason": reason,
            "unpublished_at": iso(unpublished_at),
        },
        event_id=event_id,
        occurred_at=occurred_at,
    )


def _require_published_before(last_published_version: int | None, version: int, what: str) -> None:
    if last_published_version is None:
        raise EventBuildError(f"this {what} was never published, so it cannot be unpublished")
    if version <= last_published_version:
        raise EventBuildError(
            f"an unpublished {what} needs a version above the published one "
            f"({version} is not above {last_published_version})"
        )


# --- vendors ----------------------------------------------------------------------------------

REPORTED_STATUSES = frozenset(
    {VendorStatus.APPROVED, VendorStatus.REJECTED, VendorStatus.SUSPENDED}
)


def vendor_status_changed(
    vendor_id: uuid.UUID,
    *,
    status: str,
    reason: str | None,
    changed_at: datetime,
    version: int,
    event_id: uuid.UUID | None = None,
    occurred_at: datetime | None = None,
) -> BuiltEvent:
    """The vendor's new status (`approved`, `rejected` or `suspended`; `pending` is the state it
    is created in and is never sent). A reason longer than the contract allows is cut."""
    if status not in REPORTED_STATUSES:
        raise EventBuildError(f"a status change to {status!r} is not sent to the central app")
    text = (reason or "").strip() or None
    if text is not None and len(text) > MAX_STATUS_REASON:
        text = text[: MAX_STATUS_REASON - 1].rstrip() + "…"
    return _build(
        event_type="vendor.status_changed",
        aggregate_type="vendor",
        aggregate_id=vendor_id,
        vendor_id=vendor_id,
        version=version,
        payload=_present(
            vendor_id=str(vendor_id), status=status, reason=text, changed_at=iso(changed_at)
        ),
        event_id=event_id,
        occurred_at=occurred_at,
    )


# --- reading the state ---------------------------------------------------------------------


async def load_brand_snapshot(db: AsyncSession, vendor_id: uuid.UUID) -> BrandSnapshot:
    """The vendor's published brand page with its logo and banner."""
    vendor = await db.get(Vendor, vendor_id)
    profile = await db.scalar(
        select(BrandProfile).where(
            BrandProfile.vendor_id == vendor_id, BrandProfile.state == BrandProfileState.PUBLISHED
        )
    )
    if vendor is None or profile is None:
        raise EventBuildError("the vendor has no published brand page")
    logo = await db.get(Asset, profile.logo_asset_id) if profile.logo_asset_id else None
    banner = await db.get(Asset, profile.banner_asset_id) if profile.banner_asset_id else None
    return BrandSnapshot(vendor, profile, logo, banner)


async def load_product_snapshot(db: AsyncSession, product_id: uuid.UUID) -> ProductSnapshot:
    """An approved product's live revision with its variants and images."""
    product = await db.get(Product, product_id)
    if product is None or product.live_revision_id is None:
        raise EventBuildError("the product has no live revision")
    revision = await db.get(ProductRevision, product.live_revision_id)
    if revision is None:
        raise EventBuildError("the product has no live revision")
    variant_rows = await db.execute(
        select(ProductVariant, ProductRevisionVariant)
        .join(ProductRevisionVariant, ProductRevisionVariant.variant_id == ProductVariant.id)
        .where(ProductRevisionVariant.revision_id == revision.id)
    )
    image_rows = await db.execute(
        select(ProductImage, Asset)
        .join(Asset, Asset.id == ProductImage.asset_id)
        .where(ProductImage.revision_id == revision.id)
    )
    return ProductSnapshot(
        product,
        revision,
        [(variant, offer) for variant, offer in variant_rows.tuples()],
        [(image, asset) for image, asset in image_rows.tuples()],
    )


async def vendor_status_version(db: AsyncSession, vendor_id: uuid.UUID, event_id: int) -> int:
    """The number of a status change: how many the vendor has had up to and including it (the
    audit table is append-only, so the number never changes). The creation of the vendor counts."""
    count = await db.scalar(
        select(func.count())
        .select_from(VendorStatusEvent)
        .where(VendorStatusEvent.vendor_id == vendor_id, VendorStatusEvent.id <= event_id)
    )
    return int(count or 0)


__all__ = [
    "BuiltEvent",
    "EventBuildError",
    "EventTooLarge",
    "InvalidEvent",
    "brand_profile_published",
    "brand_profile_unpublished",
    "product_published",
    "product_unpublished",
    "vendor_status_changed",
]
