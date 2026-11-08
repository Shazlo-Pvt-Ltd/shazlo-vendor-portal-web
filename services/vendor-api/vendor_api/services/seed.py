from datetime import UTC, datetime

from shazlo_security.passwords import PasswordService
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    ActorType,
    Vendor,
    VendorStatus,
    VendorStatusEvent,
    VendorUser,
    VendorUserRole,
    VendorUserStatus,
)

SEED_SLUG = "demo-brand"
SEED_OWNER_EMAIL = "owner@demo-brand.test"
SEED_STAFF_EMAIL = "staff@demo-brand.test"
# The demo users' password when none is given. It is for a local database only: the command
# refuses to run outside ENV=dev. Set SEED_VENDOR_PASSWORD (or --password) to use another one.
DEV_SEED_PASSWORD = "demo-password-1234"  # noqa: S105


async def seed_demo_vendor(db: AsyncSession, passwords: PasswordService, password: str) -> bool:
    """Creates one approved vendor with a verified owner and one staff user, for local work (the
    vendor portal of Phase 5 signs in with them). Returns False if it already exists.

    Safe to run twice: an existing demo vendor, or any user with one of the two addresses, is
    left untouched, so a later run never changes a password someone has set.
    """
    taken = await db.scalar(
        select(Vendor.id).where(Vendor.slug == SEED_SLUG).limit(1)
    ) or await db.scalar(
        select(VendorUser.id)
        .where(VendorUser.email.in_([SEED_OWNER_EMAIL, SEED_STAFF_EMAIL]))
        .limit(1)
    )
    if taken is not None:
        return False
    now = datetime.now(UTC)
    password_hash = await passwords.hash(password)
    vendor = Vendor(
        name="Demo Brand",
        slug=SEED_SLUG,
        email=SEED_OWNER_EMAIL,
        phone="+919999999999",
        contact_name="Demo Owner",
        product_type="apparel",
        price_min_paise=49_900,
        price_max_paise=499_900,
        status=VendorStatus.APPROVED,
        status_changed_at=now,
        status_reason="dev seed",
    )
    db.add(vendor)
    await db.flush()
    owner, staff = (
        VendorUser(
            vendor_id=vendor.id,
            email=email,
            password_hash=password_hash,
            role=role,
            status=VendorUserStatus.ACTIVE,
            email_verified_at=now,
            terms_accepted_at=now,
        )
        for email, role in (
            (SEED_OWNER_EMAIL, VendorUserRole.OWNER),
            (SEED_STAFF_EMAIL, VendorUserRole.STAFF),
        )
    )
    db.add_all([owner, staff])
    db.add(
        VendorStatusEvent(
            vendor_id=vendor.id,
            from_status=None,
            to_status=VendorStatus.APPROVED,
            actor_type=ActorType.SYSTEM,
            reason="dev seed",
        )
    )
    await db.commit()
    return True
