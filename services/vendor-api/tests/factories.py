"""Builders for database tests: valid rows that a test then bends one field at a time."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Asset,
    AssetKind,
    AssetStatus,
    BrandProfile,
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
