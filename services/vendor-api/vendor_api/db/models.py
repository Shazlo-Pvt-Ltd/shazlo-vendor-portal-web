import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, validates

from vendor_api.db.base import Base


class VendorStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class VendorUserRole(StrEnum):
    OWNER = "owner"
    STAFF = "staff"


class VendorUserStatus(StrEnum):
    INVITED = "invited"
    ACTIVE = "active"
    DISABLED = "disabled"


class ActorType(StrEnum):
    ADMIN = "admin"
    SYSTEM = "system"
    VENDOR = "vendor"


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    INVITE = "invite"
    RESET_PASSWORD = "reset_password"  # noqa: S105  (a purpose name, not a password)


class AssetKind(StrEnum):
    BRAND_LOGO = "brand_logo"
    BRAND_BANNER = "brand_banner"
    PRODUCT_IMAGE = "product_image"


class AssetProvider(StrEnum):
    CLOUDINARY = "cloudinary"


class AssetStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    DELETED = "deleted"


class BrandProfileState(StrEnum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"
    REJECTED = "rejected"


class ProductStatus(StrEnum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class Gender(StrEnum):
    WOMEN = "women"
    MEN = "men"
    UNISEX = "unisex"


class ReviewSubject(StrEnum):
    BRAND_PROFILE = "brand_profile"
    PRODUCT = "product"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class ReviewAction(StrEnum):
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    REOPENED = "reopened"


def _one_of(column: str, values: type[StrEnum]) -> str:
    """The SQL for a check constraint that limits `column` to the values of an enum.

    Enums are plain text columns with a check constraint, so adding a value is a migration of
    that constraint and not of a Postgres enum type.
    """
    return f"{column} IN ({', '.join(repr(member.value) for member in values)})"


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def _updated_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Vendor(Base):
    """A vendor company. Starts `pending`; an admin approves, rejects or suspends it (Phase 3).

    Money is integer paise (ADR 0003). `status_changed_by` is an identity-api admin id: another
    database, so no foreign key.
    """

    __tablename__ = "vendors"
    __table_args__ = (
        # Stored trimmed and lower-cased (as the ORM normalises it), so the unique constraint is
        # case-insensitive at the database level.
        CheckConstraint("email = lower(btrim(email))", name="email_lower"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("price_min_paise >= 0", name="price_min_not_negative"),
        CheckConstraint("price_max_paise >= price_min_paise", name="price_range"),
        CheckConstraint(_one_of("status", VendorStatus), name="status_values"),
    )
    # Fetch server-generated values (`updated_at` on UPDATE) in the same statement via RETURNING.
    # Otherwise they are expired after a flush, and reading them lazy-loads, which raises
    # MissingGreenlet on an AsyncSession.
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    phone: Mapped[str] = mapped_column(String(32))
    contact_name: Mapped[str] = mapped_column(String(200))
    product_type: Mapped[str] = mapped_column(String(100))
    website_or_instagram: Mapped[str | None] = mapped_column(String(300))
    price_min_paise: Mapped[int] = mapped_column(BigInteger)
    price_max_paise: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(
        String(16), server_default=text(f"'{VendorStatus.PENDING}'")
    )
    status_reason: Mapped[str | None] = mapped_column(Text)
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status_changed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    @validates("email")
    def _normalise_email(self, _key: str, value: str) -> str:
        return value.strip().lower()


class VendorStatusEvent(Base):
    """Append-only audit of every vendor status change. A database trigger refuses UPDATE and
    DELETE, and the vendor cannot be deleted while it has events (RESTRICT)."""

    __tablename__ = "vendor_status_events"
    __table_args__ = (
        CheckConstraint(_one_of("to_status", VendorStatus), name="to_status_values"),
        # NULL from_status is the creation of the vendor.
        CheckConstraint(
            f"from_status IS NULL OR {_one_of('from_status', VendorStatus)}",
            name="from_status_values",
        ),
        CheckConstraint(_one_of("actor_type", ActorType), name="actor_type_values"),
        # An admin or a vendor user acted as someone; only the system acts as nobody.
        CheckConstraint("actor_type = 'system' OR actor_id IS NOT NULL", name="actor_id_required"),
        Index("ix_vendor_status_events_vendor_id_id", "vendor_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class VendorUser(Base):
    """A person who signs in for a vendor.

    `password_hash` stays NULL until an invite is accepted.
    """

    __tablename__ = "vendor_users"
    __table_args__ = (
        CheckConstraint("email = lower(btrim(email))", name="email_lower"),
        CheckConstraint(_one_of("role", VendorUserRole), name="role_values"),
        CheckConstraint(_one_of("status", VendorUserStatus), name="status_values"),
        # Only a user who has not accepted the invite yet (or was disabled before) has no password.
        CheckConstraint(
            "password_hash IS NOT NULL OR status IN ('invited', 'disabled')",
            name="password_set_when_active",
        ),
        Index("ix_vendor_users_vendor_id", "vendor_id"),
        # A vendor has exactly one owner at most.
        Index(
            "uq_vendor_users_one_owner_per_vendor",
            "vendor_id",
            unique=True,
            postgresql_where=text("role = 'owner'"),
        ),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(
        String(16), server_default=text(f"'{VendorUserStatus.INVITED}'")
    )
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    @validates("email")
    def _normalise_email(self, _key: str, value: str) -> str:
        return value.strip().lower()


class AuthToken(Base):
    """A one-time token for email verification, an invite or a password reset.

    Only the SHA-256 of the token (64 hex characters) is stored, never the token.
    """

    __tablename__ = "auth_tokens"
    __table_args__ = (
        CheckConstraint(_one_of("purpose", TokenPurpose), name="purpose_values"),
        CheckConstraint("token_hash ~ '^[0-9a-f]{64}$'", name="token_hash_sha256_hex"),
        Index("ix_auth_tokens_vendor_user_id_purpose", "vendor_user_id", "purpose"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vendor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendor_users.id", ondelete="CASCADE")
    )
    purpose: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class Asset(Base):
    """An uploaded image. The file lives at the provider (Cloudinary); this row is its record.

    `(vendor_id, id)` is unique so other tables can point at an asset with a composite foreign
    key that includes the vendor: that is what stops one vendor from referencing another's file.
    """

    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint(_one_of("kind", AssetKind), name="kind_values"),
        CheckConstraint(_one_of("provider", AssetProvider), name="provider_values"),
        CheckConstraint(_one_of("status", AssetStatus), name="status_values"),
        CheckConstraint("length(btrim(public_id)) > 0", name="public_id_not_blank"),
        CheckConstraint("url ~ '^https://[^[:space:]]+$'", name="url_https"),
        CheckConstraint("bytes IS NULL OR bytes > 0", name="bytes_positive"),
        CheckConstraint("width IS NULL OR width > 0", name="width_positive"),
        CheckConstraint("height IS NULL OR height > 0", name="height_positive"),
        # The file is only usable once the provider has reported what it received.
        CheckConstraint(
            "status <> 'ready' OR (format IS NOT NULL AND bytes IS NOT NULL "
            "AND width IS NOT NULL AND height IS NOT NULL)",
            name="ready_has_metadata",
        ),
        UniqueConstraint("vendor_id", "id"),
        Index("ix_assets_vendor_id_kind", "vendor_id", "kind"),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    kind: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(
        String(16), server_default=text(f"'{AssetProvider.CLOUDINARY}'")
    )
    public_id: Mapped[str] = mapped_column(String(255), unique=True)
    url: Mapped[str] = mapped_column(String(2048))
    format: Mapped[str | None] = mapped_column(String(16))
    bytes: Mapped[int | None] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), server_default=text(f"'{AssetStatus.PENDING}'"))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendor_users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class BrandProfile(Base):
    """One version of a vendor's brand page.

    **Layout: one row per version.** A vendor edits a `draft`; submitting it makes it
    `pending_review`; approving makes it the `published` one and the previous `published` row
    `superseded`; rejecting makes it `rejected`. Shoppers only ever see the `published` row, so
    editing never touches what is live, and old versions stay as history.

    Why rows and not two columns or a JSON blob: the database can then enforce "at most one
    draft and one published per vendor" with partial unique indexes, every version keeps its
    own `version` number for the central app's stale-event check, and the profile can point at
    assets through real foreign keys. Phase 3's approval is two UPDATEs in one transaction, in
    this order: the old `published` row to `superseded`, then the approved row to `published`
    (the partial unique index is checked per statement, so the order matters).

    A trigger keeps `version` increasing per vendor and immutable.
    """

    __tablename__ = "brand_profiles"
    __table_args__ = (
        CheckConstraint(_one_of("state", BrandProfileState), name="state_values"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(btrim(brand_name)) > 0", name="brand_name_not_blank"),
        CheckConstraint(
            "website_url IS NULL OR website_url ~ '^https://[^[:space:]]+$'", name="website_https"
        ),
        CheckConstraint(
            "instagram_handle IS NULL OR instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'",
            name="instagram_handle_format",
        ),
        # Each category is trimmed, non-empty and at most 80 characters; no duplicates.
        CheckConstraint("is_clean_text_list(categories, 80)", name="categories_clean"),
        # A draft may still be empty; anything submitted needs at least one category.
        CheckConstraint(
            "state = 'draft' OR cardinality(categories) >= 1", name="categories_required_on_submit"
        ),
        CheckConstraint("price_min_paise >= 0", name="price_min_not_negative"),
        CheckConstraint("price_max_paise >= price_min_paise", name="price_range"),
        CheckConstraint("state = 'draft' OR submitted_at IS NOT NULL", name="submitted_at_set"),
        CheckConstraint(
            "(state IN ('published', 'superseded')) = (published_at IS NOT NULL)",
            name="published_at_matches_state",
        ),
        UniqueConstraint("vendor_id", "version"),
        # The target of reviews' composite foreign key, which keeps a review and the profile it
        # is about in the same vendor.
        UniqueConstraint("id", "vendor_id"),
        # A profile may only use assets of its own vendor: the vendor is part of the key.
        ForeignKeyConstraint(
            ["vendor_id", "logo_asset_id"],
            ["assets.vendor_id", "assets.id"],
            name="fk_brand_profiles_logo_asset_id_assets",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["vendor_id", "banner_asset_id"],
            ["assets.vendor_id", "assets.id"],
            name="fk_brand_profiles_banner_asset_id_assets",
            ondelete="RESTRICT",
        ),
        Index(
            "uq_brand_profiles_one_draft_per_vendor",
            "vendor_id",
            unique=True,
            postgresql_where=text("state = 'draft'"),
        ),
        Index(
            "uq_brand_profiles_one_published_per_vendor",
            "vendor_id",
            unique=True,
            postgresql_where=text("state = 'published'"),
        ),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(
        String(16), server_default=text(f"'{BrandProfileState.DRAFT}'")
    )
    # Content: the limits are the ones of the published contract (ADR 0003).
    brand_name: Mapped[str] = mapped_column(String(120))
    tagline: Mapped[str | None] = mapped_column(String(160))
    about: Mapped[str | None] = mapped_column(String(4000))
    logo_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    banner_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    website_url: Mapped[str | None] = mapped_column(String(500))
    instagram_handle: Mapped[str | None] = mapped_column(String(30))
    # Text, not varchar(80)[]: a length on an array column silently truncates an element, so the
    # 80-character limit is enforced by the `categories_clean` check, which refuses instead.
    categories: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    price_min_paise: Mapped[int] = mapped_column(BigInteger)
    price_max_paise: Mapped[int] = mapped_column(BigInteger)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendor_users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class Product(Base):
    """A product's identity and where it stands. Its content lives in `ProductRevision` rows.

    **Layout: identity here, content in revisions.** An approved product keeps its live content
    while a new revision is edited and reviewed (Phase 3: "editing an approved product creates a
    pending revision instead of changing the live one"). `live_revision_id` is what shoppers see;
    `pending_revision_id` is the revision being edited or reviewed. Both must be revisions of
    this product (composite foreign keys), so a product can never show another's content.

    `version` is the aggregate version the central app uses to ignore stale events; the service
    raises it whenever the live product changes, and the database never lets it go down.
    The SKU is unique per vendor ignoring letter case (`sku_key` is the lower-cased copy the
    unique constraint uses) and stays reserved when the product is archived.
    """

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(_one_of("status", ProductStatus), name="status_values"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(sku) > 0 AND sku = btrim(sku)", name="sku_clean"),
        # An approved product has something to show.
        CheckConstraint(
            "status <> 'approved' OR live_revision_id IS NOT NULL", name="approved_has_live"
        ),
        # A product that was never approved has no live content.
        CheckConstraint(
            "status NOT IN ('draft', 'pending_review', 'rejected') OR live_revision_id IS NULL",
            name="unapproved_has_no_live",
        ),
        CheckConstraint(
            "live_revision_id IS NULL OR pending_revision_id IS NULL "
            "OR live_revision_id <> pending_revision_id",
            name="live_and_pending_differ",
        ),
        # A product in review has a revision in review (migration 0006).
        CheckConstraint(
            "status <> 'pending_review' OR pending_revision_id IS NOT NULL",
            name="pending_review_has_pending",
        ),
        UniqueConstraint("vendor_id", "sku_key"),
        UniqueConstraint("id", "vendor_id"),
        # Circular with product_revisions: both columns start empty and are filled afterwards.
        ForeignKeyConstraint(
            ["live_revision_id", "id"],
            ["product_revisions.id", "product_revisions.product_id"],
            name="fk_products_live_revision_id_product_revisions",
            ondelete="RESTRICT",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["pending_revision_id", "id"],
            ["product_revisions.id", "product_revisions.product_id"],
            name="fk_products_pending_revision_id_product_revisions",
            ondelete="RESTRICT",
            use_alter=True,
        ),
        Index("ix_products_vendor_id_status", "vendor_id", "status"),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    sku: Mapped[str] = mapped_column(String(64))
    sku_key: Mapped[str] = mapped_column(
        Text, Computed("lower(sku)", persisted=True), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), server_default=text(f"'{ProductStatus.DRAFT}'"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    live_revision_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    pending_revision_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class ProductRevision(Base):
    """One version of a product's content (limits from the published contract, ADR 0003).

    `version` increases per product and never changes (a trigger, like brand profiles); it is
    the version a review refers to. `submitted_at` is NULL while the revision is being edited.
    A revision cannot be submitted without at least one active variant and one image.
    `vendor_id` repeats the product's (a composite foreign key keeps them equal) so the variants
    and images below can be tied to the same vendor.
    """

    __tablename__ = "product_revisions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("length(btrim(title)) > 0", name="title_not_blank"),
        CheckConstraint("length(btrim(category)) > 0", name="category_not_blank"),
        CheckConstraint(_one_of("gender", Gender), name="gender_values"),
        CheckConstraint("weight_grams IS NULL OR weight_grams > 0", name="weight_positive"),
        CheckConstraint(
            "return_window_days IS NULL OR return_window_days BETWEEN 0 AND 30",
            name="return_window_range",
        ),
        CheckConstraint(
            "NOT returnable OR return_window_days IS NOT NULL", name="return_window_required"
        ),
        UniqueConstraint("product_id", "version"),
        UniqueConstraint("id", "product_id"),
        UniqueConstraint("id", "vendor_id"),
        ForeignKeyConstraint(
            ["product_id", "vendor_id"],
            ["products.id", "products.vendor_id"],
            name="fk_product_revisions_product_id_products",
            ondelete="RESTRICT",
        ),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(4000))
    category: Mapped[str] = mapped_column(String(100))
    subcategory: Mapped[str | None] = mapped_column(String(100))
    gender: Mapped[str] = mapped_column(String(8))
    fabric: Mapped[str | None] = mapped_column(String(80))
    weight_grams: Mapped[int | None] = mapped_column(Integer)
    returnable: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    return_window_days: Mapped[int | None] = mapped_column(Integer)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendor_users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class ProductVariant(Base):
    """A sellable variant of a product: its identity (SKU, size, colour).

    The identity is stable across revisions, so `id` can be the contract's `variant_id` and the
    central app can update the same variant. What may change between revisions (price, MRP,
    whether it is offered) is in `ProductRevisionVariant`. There is no stock: the central app
    owns it. The SKU is unique per vendor ignoring letter case; two vendors may use the same.
    An empty `size` or `color` means "none" (and keeps `(product, size, color)` unique).
    """

    __tablename__ = "product_variants"
    __table_args__ = (
        CheckConstraint("length(sku) > 0 AND sku = btrim(sku)", name="sku_clean"),
        UniqueConstraint("vendor_id", "sku_key"),
        UniqueConstraint("product_id", "size", "color"),
        UniqueConstraint("id", "product_id"),
        ForeignKeyConstraint(
            ["product_id", "vendor_id"],
            ["products.id", "products.vendor_id"],
            name="fk_product_variants_product_id_products",
            ondelete="RESTRICT",
        ),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    sku: Mapped[str] = mapped_column(String(64))
    sku_key: Mapped[str] = mapped_column(
        Text, Computed("lower(sku)", persisted=True), nullable=False
    )
    size: Mapped[str] = mapped_column(String(32), server_default=text("''"))
    color: Mapped[str] = mapped_column(String(32), server_default=text("''"))
    created_at: Mapped[datetime] = _created_at()


class ProductRevisionVariant(Base):
    """What a revision says about a variant: its price and MRP (integer paise) and whether it
    is offered. Both foreign keys carry the product, so a revision can only list variants of its
    own product."""

    __tablename__ = "product_revision_variants"
    __table_args__ = (
        CheckConstraint("price_paise > 0", name="price_positive"),
        CheckConstraint("mrp_paise >= price_paise", name="mrp_at_least_price"),
        ForeignKeyConstraint(
            ["revision_id", "product_id"],
            ["product_revisions.id", "product_revisions.product_id"],
            name="fk_product_revision_variants_revision_id_product_revisions",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["variant_id", "product_id"],
            ["product_variants.id", "product_variants.product_id"],
            name="fk_product_revision_variants_variant_id_product_variants",
            ondelete="RESTRICT",
        ),
        Index("ix_product_revision_variants_variant_id", "variant_id"),
    )
    __mapper_args__ = {"eager_defaults": True}

    revision_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    price_paise: Mapped[int] = mapped_column(BigInteger)
    mrp_paise: Mapped[int] = mapped_column(BigInteger)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class ProductImage(Base):
    """An ordered image of a revision. At most 10 (`position` 1 to 10, unique per revision).

    The asset must belong to the same vendor as the revision: `(vendor_id, asset_id)` is a
    composite foreign key to `assets (vendor_id, id)`, and `(revision_id, vendor_id)` ties the
    row to the revision's vendor.
    """

    __tablename__ = "product_images"
    __table_args__ = (
        CheckConstraint("position BETWEEN 1 AND 10", name="position_range"),
        UniqueConstraint("revision_id", "position"),
        ForeignKeyConstraint(
            ["revision_id", "vendor_id"],
            ["product_revisions.id", "product_revisions.vendor_id"],
            name="fk_product_images_revision_id_product_revisions",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["vendor_id", "asset_id"],
            ["assets.vendor_id", "assets.id"],
            name="fk_product_images_asset_id_assets",
            ondelete="RESTRICT",
        ),
        Index("ix_product_images_asset_id", "asset_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    position: Mapped[int] = mapped_column(Integer)
    alt_text: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()


class Review(Base):
    """An admin's review of one version of something a vendor submitted.

    A review points at the **exact version row**: a `brand_profile` (one row per version) or a
    `product_revision`. So "the version reviewed" is that row's `version`, the reference is a
    real foreign key (a polymorphic `subject_id` could not be one), and a later edit can never
    change what was reviewed. Exactly one of the two references is set. Each is a composite
    key with `vendor_id`, so a review and its subject always belong to the same vendor.

    The reviewer is an identity-api admin: only their UUID is stored (another database, so no
    foreign key), and it always comes from the verified token, never from the request body.
    """

    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint(_one_of("subject", ReviewSubject), name="subject_values"),
        CheckConstraint(_one_of("status", ReviewStatus), name="status_values"),
        # Exactly one subject, and it matches `subject`.
        CheckConstraint(
            "(subject = 'brand_profile' AND brand_profile_id IS NOT NULL "
            "AND product_revision_id IS NULL) "
            "OR (subject = 'product' AND product_revision_id IS NOT NULL "
            "AND brand_profile_id IS NULL)",
            name="one_subject",
        ),
        # A rejection says why.
        CheckConstraint(
            "status <> 'rejected' OR coalesce(reason, '') ~ '\\S'",
            name="rejected_needs_reason",
        ),
        # An admin's decision names the admin and the time.
        CheckConstraint(
            "status NOT IN ('approved', 'rejected') "
            "OR (reviewer_id IS NOT NULL AND decided_at IS NOT NULL)",
            name="decision_needs_reviewer",
        ),
        # A withdrawal is the vendor's: it has a time but no reviewer. A pending review has
        # neither, so reopening one clears both.
        CheckConstraint(
            "status <> 'withdrawn' OR (reviewer_id IS NULL AND decided_at IS NOT NULL)",
            name="withdrawn_shape",
        ),
        CheckConstraint(
            "status <> 'pending' OR (reviewer_id IS NULL AND decided_at IS NULL)",
            name="pending_shape",
        ),
        CheckConstraint("decided_at IS NULL OR decided_at >= submitted_at", name="decided_after"),
        ForeignKeyConstraint(
            ["brand_profile_id", "vendor_id"],
            ["brand_profiles.id", "brand_profiles.vendor_id"],
            name="fk_reviews_brand_profile_id_brand_profiles",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["product_revision_id", "vendor_id"],
            ["product_revisions.id", "product_revisions.vendor_id"],
            name="fk_reviews_product_revision_id_product_revisions",
            ondelete="RESTRICT",
        ),
        # At most one pending review per version of each kind of subject.
        Index(
            "uq_reviews_one_pending_per_brand_profile",
            "brand_profile_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "uq_reviews_one_pending_per_product_revision",
            "product_revision_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        # Phase 3's queue: oldest pending first; and a vendor's reviews by status.
        Index(
            "ix_reviews_pending_submitted_at",
            "submitted_at",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_reviews_vendor_id_status", "vendor_id", "status"),
        Index("ix_reviews_status_submitted_at", "status", "submitted_at"),
        # Full indexes for the two subject foreign keys (the unique ones above are partial).
        Index("ix_reviews_brand_profile_id", "brand_profile_id"),
        Index("ix_reviews_product_revision_id", "product_revision_id"),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    subject: Mapped[str] = mapped_column(String(16))
    brand_profile_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    product_revision_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(
        String(16), server_default=text(f"'{ReviewStatus.PENDING}'")
    )
    submitted_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendor_users.id", ondelete="RESTRICT")
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class ReviewEvent(Base):
    """Append-only audit trail of every step of a review. A database trigger refuses UPDATE,
    DELETE and TRUNCATE, so even a bug in the application cannot rewrite history; a review with
    events cannot be deleted (RESTRICT). `actor_id` is the vendor user or the admin (no foreign
    key to an admin: another database); only the system acts as nobody."""

    __tablename__ = "review_events"
    __table_args__ = (
        CheckConstraint(_one_of("action", ReviewAction), name="action_values"),
        CheckConstraint(_one_of("actor_type", ActorType), name="actor_type_values"),
        CheckConstraint("actor_type = 'system' OR actor_id IS NOT NULL", name="actor_id_required"),
        CheckConstraint(
            "action <> 'rejected' OR coalesce(reason, '') ~ '\\S'",
            name="rejected_needs_reason",
        ),
        Index("ix_review_events_review_id_id", "review_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reviews.id", ondelete="RESTRICT")
    )
    action: Mapped[str] = mapped_column(String(16))
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str | None] = mapped_column(Text)
    # What the decision changed: the thing reviewed before and after, as JSON. None for events
    # that need nothing more, such as a submission.
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class OutboxAggregate(StrEnum):
    BRAND_PROFILE = "brand_profile"
    PRODUCT = "product"
    VENDOR = "vendor"


class OutboxEventType(StrEnum):
    BRAND_PROFILE_PUBLISHED = "brand_profile.published"
    BRAND_PROFILE_UNPUBLISHED = "brand_profile.unpublished"
    PRODUCT_PUBLISHED = "product.published"
    PRODUCT_UNPUBLISHED = "product.unpublished"
    VENDOR_STATUS_CHANGED = "vendor.status_changed"


class OutboxStatus(StrEnum):
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    DEAD = "dead"


# The central app refuses a body over 256 KB (413); the database is a backstop for the builders.
MAX_OUTBOX_PAYLOAD_BYTES = 262_144


class OutboxEvent(Base):
    """An event for the central app, written in the same transaction as what it announces
    (ADR 0003, section 5), so an approval and its event are saved together or not at all.

    `id` is the `event_id` the central app de-duplicates on. `version` is the aggregate's
    version: the central app applies an event only if it is higher than the one it holds, and the
    worker sends one aggregate's events one at a time in version order. `payload` is the whole
    event body (the full state of the aggregate), exactly as it will be signed and sent.

    A trigger keeps the content of a row (everything but its delivery state) from ever changing,
    makes `sent` final, and allows only the worker's path between statuses: pending to sending,
    sending to pending, sent or dead, and dead back to pending (an admin's retry).
    """

    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint(_one_of("aggregate_type", OutboxAggregate), name="aggregate_type_values"),
        CheckConstraint(_one_of("event_type", OutboxEventType), name="event_type_values"),
        CheckConstraint(_one_of("status", OutboxStatus), name="status_values"),
        # An event is about its own kind of aggregate.
        CheckConstraint(
            "(aggregate_type = 'brand_profile' AND event_type IN "
            "('brand_profile.published', 'brand_profile.unpublished')) "
            "OR (aggregate_type = 'product' AND event_type IN "
            "('product.published', 'product.unpublished')) "
            "OR (aggregate_type = 'vendor' AND event_type = 'vendor.status_changed')",
            name="event_type_matches_aggregate",
        ),
        # The aggregate of a vendor event is the vendor itself.
        CheckConstraint(
            "aggregate_type <> 'vendor' OR aggregate_id = vendor_id",
            name="vendor_event_is_about_the_vendor",
        ),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
        CheckConstraint("jsonb_typeof(payload) = 'object'", name="payload_is_object"),
        CheckConstraint(
            f"octet_length(payload::text) <= {MAX_OUTBOX_PAYLOAD_BYTES}", name="payload_size"
        ),
        # What a failure says is kept short: it is a reason, not a copy of the response.
        CheckConstraint(
            "last_error IS NULL OR length(last_error) <= 1000", name="last_error_bounded"
        ),
        CheckConstraint("status <> 'dead' OR last_error IS NOT NULL", name="dead_has_reason"),
        CheckConstraint("(status = 'sent') = (sent_at IS NOT NULL)", name="sent_at_matches_status"),
        CheckConstraint(
            "(status = 'sending') = (locked_at IS NOT NULL)", name="locked_at_matches_status"
        ),
        UniqueConstraint("aggregate_type", "aggregate_id", "version"),
        # The worker's claim: the rows that are due, oldest first.
        Index(
            "ix_outbox_events_due", "next_attempt_at", postgresql_where=text("status = 'pending'")
        ),
        # One vendor's events (the admins' filter, and the fan-out when a vendor is suspended).
        Index("ix_outbox_events_vendor_id_status", "vendor_id", "status"),
        # The admins' view of what is stuck (`dead` first) and the retention job's scan.
        Index("ix_outbox_events_status_created_at", "status", "created_at"),
    )
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Whose event it is: every event is about one vendor's page, product or account.
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT")
    )
    aggregate_type: Mapped[str] = mapped_column(String(16))
    aggregate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    event_type: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        String(16), server_default=text(f"'{OutboxStatus.PENDING}'")
    )
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OutboxLogKind(StrEnum):
    ATTEMPT = "attempt"  # the worker tried to deliver the event
    RETRY = "retry"  # an admin put a dead event back


class OutboxEventLog(Base):
    """What happened to an outbox event, one row per step: each delivery attempt (what came of
    it) and each retry an admin asked for (with the admin's id). Gone with its event."""

    __tablename__ = "outbox_event_log"
    __table_args__ = (
        CheckConstraint(_one_of("kind", OutboxLogKind), name="kind_values"),
        # A retry is somebody's: the admin who asked for it.
        CheckConstraint("kind <> 'retry' OR actor_id IS NOT NULL", name="retry_has_actor"),
        # A reason, not a copy of the response.
        CheckConstraint("length(outcome) <= 1000", name="outcome_bounded"),
        Index("ix_outbox_event_log_event_id_id", "event_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("outbox_events.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(16))
    outcome: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _created_at()
