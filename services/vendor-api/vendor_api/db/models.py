import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
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
