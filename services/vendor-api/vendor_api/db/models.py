import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
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
from sqlalchemy.dialects.postgresql import ARRAY, UUID
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
