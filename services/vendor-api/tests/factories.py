"""Builders for database tests: valid rows that a test then bends one field at a time."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Asset,
    AssetKind,
    AssetStatus,
    BrandProfile,
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductVariant,
    Review,
    ReviewEvent,
    Vendor,
    VendorUser,
    VendorUserRole,
    VendorUserStatus,
)


def make_vendor(slug: str = "acme", email: str = "owner@acme.test", **changes: Any) -> Vendor:
    values: dict[str, Any] = {
        "name": "Acme",
        "slug": slug,
        "email": email,
        "phone": "+911234567890",
        "contact_name": "Asha",
        "product_type": "apparel",
        "price_min_paise": 49_900,
        "price_max_paise": 499_900,
    }
    return Vendor(**{**values, **changes})


def make_user(vendor: Vendor, email: str = "asha@acme.test", **changes: Any) -> VendorUser:
    values: dict[str, Any] = {
        "vendor_id": vendor.id,
        "email": email,
        "password_hash": "not-a-real-hash",  # noqa: S106  (placeholder; hashing comes later)
        "role": VendorUserRole.STAFF,
        "status": VendorUserStatus.ACTIVE,
    }
    return VendorUser(**{**values, **changes})


async def saved_vendor(session: AsyncSession, **changes: Any) -> Vendor:
    vendor = make_vendor(**changes)
    session.add(vendor)
    await session.flush()
    return vendor


async def saved_user(session: AsyncSession, vendor: Vendor, **changes: Any) -> VendorUser:
    user = make_user(vendor, **changes)
    session.add(user)
    await session.flush()
    return user


async def count(session: AsyncSession, model: Any) -> int:
    return await session.scalar(select(func.count()).select_from(model)) or 0


def make_asset(
    vendor: Vendor, user: VendorUser, public_id: str = "shazlo/logo-1", **changes: Any
) -> Asset:
    values: dict[str, Any] = {
        "vendor_id": vendor.id,
        "kind": AssetKind.BRAND_LOGO,
        "public_id": public_id,
        "url": f"https://res.cloudinary.test/{public_id}.png",
        "format": "png",
        "bytes": 12_345,
        "width": 400,
        "height": 400,
        "status": AssetStatus.READY,
        "created_by": user.id,
    }
    return Asset(**{**values, **changes})


async def saved_asset(
    session: AsyncSession, vendor: Vendor, user: VendorUser, **changes: Any
) -> Asset:
    asset = make_asset(vendor, user, **changes)
    session.add(asset)
    await session.flush()
    return asset


def make_profile(vendor: Vendor, **changes: Any) -> BrandProfile:
    values: dict[str, Any] = {
        "vendor_id": vendor.id,
        "version": 1,
        "brand_name": "Acme",
        "price_min_paise": 49_900,
        "price_max_paise": 499_900,
    }
    return BrandProfile(**{**values, **changes})


async def saved_profile(session: AsyncSession, vendor: Vendor, **changes: Any) -> BrandProfile:
    profile = make_profile(vendor, **changes)
    session.add(profile)
    await session.flush()
    return profile


def make_product(vendor: Vendor, sku: str = "KURTA-01", **changes: Any) -> Product:
    return Product(**{"vendor_id": vendor.id, "sku": sku, **changes})


async def saved_product(
    session: AsyncSession, vendor: Vendor, sku: str = "KURTA-01", **changes: Any
) -> Product:
    product = make_product(vendor, sku, **changes)
    session.add(product)
    await session.flush()
    return product


def make_revision(
    product: Product, user: VendorUser, version: int = 1, **changes: Any
) -> ProductRevision:
    values: dict[str, Any] = {
        "product_id": product.id,
        "vendor_id": product.vendor_id,
        "version": version,
        "title": "Block-print kurta",
        "category": "kurtas",
        "gender": "women",
        "created_by": user.id,
    }
    return ProductRevision(**{**values, **changes})


async def saved_revision(
    session: AsyncSession, product: Product, user: VendorUser, version: int = 1, **changes: Any
) -> ProductRevision:
    revision = make_revision(product, user, version, **changes)
    session.add(revision)
    await session.flush()
    return revision


async def saved_variant(
    session: AsyncSession, product: Product, sku: str = "KURTA-01-M", **changes: Any
) -> ProductVariant:
    values: dict[str, Any] = {
        "product_id": product.id,
        "vendor_id": product.vendor_id,
        "sku": sku,
        "size": "M",
        "color": "indigo",
    }
    variant = ProductVariant(**{**values, **changes})
    session.add(variant)
    await session.flush()
    return variant


def make_revision_variant(
    revision: ProductRevision, variant: ProductVariant, **changes: Any
) -> ProductRevisionVariant:
    values: dict[str, Any] = {
        "revision_id": revision.id,
        "variant_id": variant.id,
        "product_id": revision.product_id,
        "price_paise": 99_900,
        "mrp_paise": 129_900,
    }
    return ProductRevisionVariant(**{**values, **changes})


async def saved_revision_variant(
    session: AsyncSession, revision: ProductRevision, variant: ProductVariant, **changes: Any
) -> ProductRevisionVariant:
    row = make_revision_variant(revision, variant, **changes)
    session.add(row)
    await session.flush()
    return row


def make_image(
    revision: ProductRevision, asset: Asset, position: int = 1, **changes: Any
) -> ProductImage:
    values: dict[str, Any] = {
        "revision_id": revision.id,
        "vendor_id": revision.vendor_id,
        "asset_id": asset.id,
        "position": position,
    }
    return ProductImage(**{**values, **changes})


async def saved_image(
    session: AsyncSession,
    revision: ProductRevision,
    asset: Asset,
    position: int = 1,
    **changes: Any,
) -> ProductImage:
    image = make_image(revision, asset, position, **changes)
    session.add(image)
    await session.flush()
    return image


async def submittable_revision(
    session: AsyncSession, vendor: Vendor, user: VendorUser, sku: str = "KURTA-01"
) -> tuple[Product, ProductRevision]:
    """A product with a draft revision that has one active variant and one image."""
    product = await saved_product(session, vendor, sku)
    revision = await saved_revision(session, product, user)
    variant = await saved_variant(session, product, f"{sku}-M")
    await saved_revision_variant(session, revision, variant)
    asset = await saved_asset(
        session, vendor, user, public_id=f"shazlo/{sku}-1", kind="product_image"
    )
    await saved_image(session, revision, asset)
    return product, revision


def make_review(
    vendor: Vendor,
    user: VendorUser,
    *,
    profile: BrandProfile | None = None,
    revision: ProductRevision | None = None,
    **changes: Any,
) -> Review:
    """A pending review of a brand profile version or a product revision."""
    values: dict[str, Any] = {"vendor_id": vendor.id, "submitted_by": user.id}
    if profile is not None:
        values.update(subject="brand_profile", brand_profile_id=profile.id)
    if revision is not None:
        values.update(subject="product", product_revision_id=revision.id)
    return Review(**{**values, **changes})


async def saved_review(
    session: AsyncSession,
    vendor: Vendor,
    user: VendorUser,
    *,
    profile: BrandProfile | None = None,
    revision: ProductRevision | None = None,
    **changes: Any,
) -> Review:
    review = make_review(vendor, user, profile=profile, revision=revision, **changes)
    session.add(review)
    await session.flush()
    return review


def make_event(review: Review, **changes: Any) -> ReviewEvent:
    values: dict[str, Any] = {
        "review_id": review.id,
        "action": "submitted",
        "actor_type": "vendor",
        "actor_id": review.submitted_by,
    }
    return ReviewEvent(**{**values, **changes})
