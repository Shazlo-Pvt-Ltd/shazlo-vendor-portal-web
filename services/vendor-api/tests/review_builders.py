"""Reviews built straight in the database, for the reviewers' tests.

The review endpoints read (and decide) what the tables hold, so these build rows with the
factories instead of going through the vendor endpoints. Times are hours after `T0`, so a test can
say which review was submitted first.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from conftest import Tenant
from factories import (
    saved_asset,
    saved_image,
    saved_profile,
    saved_review,
    saved_revision,
    saved_revision_variant,
    saved_variant,
    submittable_revision,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import BrandProfile, Product, ProductRevision, ProductVariant, Review

T0 = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)


def at(hours: float) -> datetime:
    return T0 + timedelta(hours=hours)


async def profile(
    session: AsyncSession, tenant: Tenant, version: int, state: str, **changes: Any
) -> BrandProfile:
    values: dict[str, Any] = {"version": version, "state": state, "categories": ["kurtas"]}
    if state != "draft":
        values["submitted_at"] = at(version)
    if state in {"published", "superseded"}:
        values["published_at"] = at(version + 0.5)
    return await saved_profile(session, tenant.vendor, **{**values, **changes})


async def profile_review(
    session: AsyncSession, tenant: Tenant, version: BrandProfile, when: float, **changes: Any
) -> Review:
    return await saved_review(
        session, tenant.vendor, tenant.owner, profile=version, submitted_at=at(when), **changes
    )


def decision(status: str, hours: float, **changes: Any) -> dict[str, Any]:
    values: dict[str, Any] = {"status": status, "decided_at": at(hours)}
    if status in {"approved", "rejected"}:
        values["reviewer_id"] = uuid.uuid4()
    if status == "rejected":
        values["reason"] = "Photos are blurry"
    return {**values, **changes}


async def submitted_product(
    session: AsyncSession, tenant: Tenant, sku: str, when: float
) -> tuple[Product, ProductRevision]:
    """A product whose first revision (one variant, one image) was submitted."""
    product, revision = await submittable_revision(session, tenant.vendor, tenant.owner, sku)
    revision.submitted_at = at(when)
    await session.flush()
    return product, revision


async def product_review(
    session: AsyncSession,
    tenant: Tenant,
    revision: ProductRevision,
    when: float,
    **changes: Any,
) -> Review:
    return await saved_review(
        session, tenant.vendor, tenant.owner, revision=revision, submitted_at=at(when), **changes
    )


async def two_revisions(
    session: AsyncSession, tenant: Tenant, sku: str = "KURTA-01"
) -> tuple[Product, ProductRevision, ProductRevision]:
    """An approved product (revision 1 live) and a submitted revision 2 that changes the title,
    lowers the price of one variant, adds a variant and swaps the image."""
    product, first = await submitted_product(session, tenant, sku, 1)
    product.live_revision_id = first.id
    product.status = "approved"
    await session.flush()
    existing = (
        await session.scalars(select(ProductVariant).where(ProductVariant.product_id == product.id))
    ).one()
    second = await saved_revision(
        session, product, tenant.owner, version=2, title="Block-print kurta (new cut)"
    )
    await saved_revision_variant(session, second, existing, price_paise=89_900, mrp_paise=129_900)
    added = await saved_variant(session, product, f"{sku}-L", size="L", color="indigo")
    await saved_revision_variant(session, second, added)
    asset = await saved_asset(
        session, tenant.vendor, tenant.owner, public_id=f"shazlo/{sku}-2", kind="product_image"
    )
    await saved_image(session, second, asset, position=1)
    second.submitted_at = at(2)
    await session.flush()
    return product, first, second
