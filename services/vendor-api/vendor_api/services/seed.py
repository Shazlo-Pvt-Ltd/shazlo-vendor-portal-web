import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from shazlo_security.passwords import PasswordService
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    ActorType,
    Asset,
    AssetKind,
    AssetStatus,
    BrandProfile,
    BrandProfileState,
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductStatus,
    ProductVariant,
    Review,
    ReviewAction,
    ReviewEvent,
    ReviewStatus,
    ReviewSubject,
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


# --- The catalog: vendors in every state, products in every state, reviews to do -------------

SEED_PENDING_SLUG = "demo-pending"
SEED_PENDING_EMAIL = "owner@demo-pending.test"
SEED_SUSPENDED_SLUG = "demo-suspended"
SEED_SUSPENDED_EMAIL = "owner@demo-suspended.test"
# The `reviewer_id` on the decided reviews of the seed. Reviewers are identity-api admins and this
# service cannot create one, so no admin has this id: it only shows what a decided review looks
# like. To review, sign in to identity-api with the admin its own seed creates (a `super_admin`,
# who passes every reviewer check) and use its token on `/v1/admin/*`.
SEED_REVIEWER_ID = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
CLOUDINARY_DEMO = "https://res.cloudinary.com/demo/image/upload"


@dataclass(frozen=True)
class CatalogSeed:
    """What `seed_demo_catalog` made, for the command to print."""

    vendors: list[str]
    products: list[str]
    pending_reviews: int


async def _owner(
    db: AsyncSession, vendor: Vendor, email: str, password_hash: str, now: datetime
) -> VendorUser:
    user = VendorUser(
        vendor_id=vendor.id,
        email=email,
        password_hash=password_hash,
        role=VendorUserRole.OWNER,
        status=VendorUserStatus.ACTIVE,
        email_verified_at=now,
        terms_accepted_at=now,
    )
    db.add(user)
    await db.flush()
    return user


def _status_event(
    vendor: Vendor, status: VendorStatus, reason: str | None = None
) -> VendorStatusEvent:
    return VendorStatusEvent(
        vendor_id=vendor.id,
        from_status=None,
        to_status=status,
        actor_type=ActorType.SYSTEM,
        reason=reason or "dev seed",
    )


async def _asset(
    db: AsyncSession, vendor: Vendor, user: VendorUser, kind: AssetKind, name: str
) -> Asset:
    public_id = f"shazlo-dev/{vendor.slug}/{name}"
    asset = Asset(
        vendor_id=vendor.id,
        kind=kind,
        public_id=public_id,
        url=f"{CLOUDINARY_DEMO}/{public_id}.jpg",
        format="jpg",
        bytes=120_000,
        width=1200,
        height=1500,
        status=AssetStatus.READY,
        created_by=user.id,
    )
    db.add(asset)
    await db.flush()
    return asset


async def _profile(
    db: AsyncSession,
    vendor: Vendor,
    user: VendorUser,
    version: int,
    state: BrandProfileState,
    when: datetime,
    **content: Any,
) -> BrandProfile:
    published = state in {BrandProfileState.PUBLISHED, BrandProfileState.SUPERSEDED}
    values: dict[str, Any] = {
        "brand_name": vendor.name,
        "categories": ["kurtas", "dupattas"],
        "price_min_paise": vendor.price_min_paise,
        "price_max_paise": vendor.price_max_paise,
        **content,
    }
    profile = BrandProfile(
        vendor_id=vendor.id,
        version=version,
        state=state,
        submitted_at=when,
        published_at=when if published else None,
        updated_by=user.id,
        **values,
    )
    db.add(profile)
    await db.flush()
    return profile


async def _review(
    db: AsyncSession,
    vendor: Vendor,
    user: VendorUser,
    *,
    profile: BrandProfile | None = None,
    revision: ProductRevision | None = None,
    submitted: datetime,
    decided: datetime | None = None,
) -> Review:
    """A review with its audit trail: submitted, and approved too if `decided`."""
    review = Review(
        vendor_id=vendor.id,
        subject=ReviewSubject.BRAND_PROFILE if profile else ReviewSubject.PRODUCT,
        brand_profile_id=profile.id if profile else None,
        product_revision_id=revision.id if revision else None,
        submitted_by=user.id,
        submitted_at=submitted,
    )
    if decided is not None:
        review.status = ReviewStatus.APPROVED
        review.reviewer_id = SEED_REVIEWER_ID
        review.decided_at = decided
    db.add(review)
    await db.flush()
    db.add(
        ReviewEvent(
            review_id=review.id,
            action=ReviewAction.SUBMITTED,
            actor_type=ActorType.VENDOR,
            actor_id=user.id,
        )
    )
    if decided is not None:
        db.add(
            ReviewEvent(
                review_id=review.id,
                action=ReviewAction.APPROVED,
                actor_type=ActorType.ADMIN,
                actor_id=SEED_REVIEWER_ID,
                detail={"subject": review.subject, "note": "dev seed"},
            )
        )
    await db.flush()
    return review


async def _revision(
    db: AsyncSession,
    product: Product,
    user: VendorUser,
    version: int,
    title: str,
    variants: list[tuple[ProductVariant, int, int]],
    images: list[Asset],
    submitted: datetime | None,
    **content: Any,
) -> ProductRevision:
    """A revision with its variants' prices and images. It is submitted last: the database
    refuses a submitted revision that has no active variant and no image."""
    details: dict[str, Any] = {
        "category": "kurtas",
        "gender": "women",
        "fabric": "cotton",
        "returnable": True,
        "return_window_days": 7,
        **content,
    }
    revision = ProductRevision(
        product_id=product.id,
        vendor_id=product.vendor_id,
        version=version,
        title=title,
        created_by=user.id,
        **details,
    )
    db.add(revision)
    await db.flush()
    for variant, price, mrp in variants:
        db.add(
            ProductRevisionVariant(
                revision_id=revision.id,
                variant_id=variant.id,
                product_id=product.id,
                price_paise=price,
                mrp_paise=mrp,
            )
        )
    for position, asset in enumerate(images, start=1):
        db.add(
            ProductImage(
                revision_id=revision.id,
                vendor_id=product.vendor_id,
                asset_id=asset.id,
                position=position,
                alt_text=f"{title}, view {position}",
            )
        )
    await db.flush()
    if submitted is not None:
        revision.submitted_at = submitted
        await db.flush()
    return revision


async def _product(
    db: AsyncSession, vendor: Vendor, sku: str, sizes: list[str]
) -> tuple[Product, list[ProductVariant]]:
    product = Product(vendor_id=vendor.id, sku=sku)
    db.add(product)
    await db.flush()
    variants = [
        ProductVariant(
            product_id=product.id,
            vendor_id=vendor.id,
            sku=f"{sku}-{size}",
            size=size,
            color="Indigo",
        )
        for size in sizes
    ]
    db.add_all(variants)
    await db.flush()
    return product, variants


async def seed_demo_catalog(
    db: AsyncSession, passwords: PasswordService, password: str
) -> CatalogSeed | None:
    """Fills the demo vendor's catalog, and adds a pending and a suspended vendor, so every
    screen and every admin endpoint has something to show. Returns None if there is no demo
    vendor, or if the catalog was already seeded (so a second run changes nothing).

    - **Demo Brand** (approved): a published brand profile and a newer version in review; four
      products: one approved, one approved with an edit in review, one first submission in
      review, one draft (never submitted).
    - **Demo Pending Brand** (pending): a brand profile in review, the first submission of an
      application, and an owner who can sign in (a pending vendor can).
    - **Demo Suspended Brand** (suspended): an owner who cannot sign in.

    That leaves four pending reviews in `GET /v1/admin/reviews` and one pending vendor in
    `GET /v1/admin/vendors`. The owners use the seed password.
    """
    demo = await db.scalar(select(Vendor).where(Vendor.slug == SEED_SLUG))
    owner = await db.scalar(select(VendorUser).where(VendorUser.email == SEED_OWNER_EMAIL))
    if demo is None or owner is None:
        return None
    if await db.scalar(select(BrandProfile.id).where(BrandProfile.vendor_id == demo.id).limit(1)):
        return None
    taken = await db.scalar(
        select(Vendor.id).where(Vendor.slug.in_([SEED_PENDING_SLUG, SEED_SUSPENDED_SLUG])).limit(1)
    )
    if taken is not None:
        return None

    now = datetime.now(UTC)
    day = timedelta(days=1)
    password_hash = await passwords.hash(password)

    # --- Demo Brand: brand profile versions
    logo = await _asset(db, demo, owner, AssetKind.BRAND_LOGO, "logo")
    live = await _profile(
        db,
        demo,
        owner,
        1,
        BrandProfileState.PUBLISHED,
        now - 5 * day,
        tagline="Block prints, made slowly",
        logo_asset_id=logo.id,
        about="A small studio in Jaipur.",
        website_url="https://demo-brand.example",
    )
    await _review(db, demo, owner, profile=live, submitted=now - 6 * day, decided=now - 5 * day)
    edit = await _profile(
        db,
        demo,
        owner,
        2,
        BrandProfileState.PENDING_REVIEW,
        now - day,
        tagline="Hand block prints from Jaipur",
        logo_asset_id=logo.id,
        about="A small studio in Jaipur.",
        website_url="https://demo-brand.example",
        categories=["kurtas", "dupattas", "sarees"],
    )
    await _review(db, demo, owner, profile=edit, submitted=now - day)

    # --- Demo Brand: products
    images = [
        await _asset(db, demo, owner, AssetKind.PRODUCT_IMAGE, f"product-{n}") for n in range(1, 5)
    ]
    kurta, kurta_variants = await _product(db, demo, "KURTA-DEMO-01", ["M", "L"])
    kurta_live = await _revision(
        db,
        kurta,
        owner,
        1,
        "Block-print cotton kurta",
        [(kurta_variants[0], 149_900, 199_900), (kurta_variants[1], 149_900, 199_900)],
        [images[0]],
        now - 4 * day,
    )
    await _review(
        db, demo, owner, revision=kurta_live, submitted=now - 5 * day, decided=now - 4 * day
    )
    kurta_edit = await _revision(
        db,
        kurta,
        owner,
        2,
        "Block-print cotton kurta (new cut)",
        [(kurta_variants[0], 129_900, 199_900), (kurta_variants[1], 149_900, 199_900)],
        [images[1]],
        now - day,
    )
    await _review(db, demo, owner, revision=kurta_edit, submitted=now - day)
    kurta.live_revision_id = kurta_live.id
    kurta.pending_revision_id = kurta_edit.id
    kurta.status = ProductStatus.APPROVED
    await db.flush()

    tote, tote_variants = await _product(db, demo, "TOTE-DEMO-03", ["OS"])
    tote_first = await _revision(
        db,
        tote,
        owner,
        1,
        "Canvas tote bag",
        [(tote_variants[0], 89_900, 99_900)],
        [images[2]],
        now - day,
        category="bags",
        gender="unisex",
        fabric="canvas",
        returnable=False,
        return_window_days=None,
    )
    await _review(db, demo, owner, revision=tote_first, submitted=now - day)
    tote.pending_revision_id = tote_first.id
    tote.status = ProductStatus.PENDING_REVIEW
    await db.flush()

    scarf, scarf_variants = await _product(db, demo, "SCARF-DEMO-02", ["OS"])
    scarf_draft = await _revision(
        db,
        scarf,
        owner,
        1,
        "Silk scarf (draft)",
        [(scarf_variants[0], 59_900, 79_900)],
        [],
        None,
        category="accessories",
        gender="unisex",
        fabric="silk",
    )
    scarf.pending_revision_id = scarf_draft.id
    await db.flush()

    # --- A pending vendor with an application in review, and a suspended one
    pending = Vendor(
        name="Demo Pending Brand",
        slug=SEED_PENDING_SLUG,
        email=SEED_PENDING_EMAIL,
        phone="+919888888888",
        contact_name="Pending Owner",
        product_type="apparel",
        price_min_paise=29_900,
        price_max_paise=299_900,
        status=VendorStatus.PENDING,
    )
    suspended = Vendor(
        name="Demo Suspended Brand",
        slug=SEED_SUSPENDED_SLUG,
        email=SEED_SUSPENDED_EMAIL,
        phone="+919777777777",
        contact_name="Suspended Owner",
        product_type="footwear",
        price_min_paise=99_900,
        price_max_paise=899_900,
        status=VendorStatus.SUSPENDED,
        status_reason="Repeated chargebacks (dev seed)",
        status_changed_at=now - day,
    )
    db.add_all([pending, suspended])
    await db.flush()
    pending_owner = await _owner(db, pending, SEED_PENDING_EMAIL, password_hash, now)
    await _owner(db, suspended, SEED_SUSPENDED_EMAIL, password_hash, now)
    db.add(_status_event(pending, VendorStatus.PENDING, "signed up (dev seed)"))
    db.add(_status_event(suspended, VendorStatus.SUSPENDED, "dev seed"))
    application = await _profile(
        db,
        pending,
        pending_owner,
        1,
        BrandProfileState.PENDING_REVIEW,
        now - day,
        tagline="Contemporary festive wear",
        categories=["lehengas"],
    )
    await _review(db, pending, pending_owner, profile=application, submitted=now - day)

    await db.commit()
    return CatalogSeed(
        vendors=[
            "Demo Brand (approved)",
            "Demo Pending Brand (pending)",
            "Demo Suspended Brand (suspended)",
        ],
        products=[
            "KURTA-DEMO-01 (approved, with an edit in review)",
            "TOTE-DEMO-03 (first submission in review)",
            "SCARF-DEMO-02 (draft)",
        ],
        pending_reviews=4,
    )
