"""vendors, vendor status events, vendor users and one-time auth tokens

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-04
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VENDOR_STATUSES = "('pending', 'approved', 'rejected', 'suspended')"


def _uuid_pk() -> sa.Column[Any]:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _created_at() -> sa.Column[Any]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def _updated_at() -> sa.Column[Any]:
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "vendors",
        _uuid_pk(),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("contact_name", sa.String(200), nullable=False),
        sa.Column("product_type", sa.String(100), nullable=False),
        sa.Column("website_or_instagram", sa.String(300), nullable=True),
        sa.Column("price_min_paise", sa.BigInteger(), nullable=False),
        sa.Column("price_max_paise", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("status_reason", sa.Text(), nullable=True),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status_changed_by", postgresql.UUID(as_uuid=True), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("email = lower(btrim(email))", name=op.f("ck_vendors_email_lower")),
        sa.CheckConstraint(
            "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f("ck_vendors_slug_format")
        ),
        sa.CheckConstraint("length(btrim(name)) > 0", name=op.f("ck_vendors_name_not_blank")),
        sa.CheckConstraint("price_min_paise >= 0", name=op.f("ck_vendors_price_min_not_negative")),
        sa.CheckConstraint(
            "price_max_paise >= price_min_paise", name=op.f("ck_vendors_price_range")
        ),
        sa.CheckConstraint(f"status IN {VENDOR_STATUSES}", name=op.f("ck_vendors_status_values")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendors")),
        sa.UniqueConstraint("slug", name=op.f("uq_vendors_slug")),
        sa.UniqueConstraint("email", name=op.f("uq_vendors_email")),
    )

    op.create_table(
        "vendor_status_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(16), nullable=True),
        sa.Column("to_status", sa.String(16), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            f"to_status IN {VENDOR_STATUSES}", name=op.f("ck_vendor_status_events_to_status_values")
        ),
        sa.CheckConstraint(
            f"from_status IS NULL OR from_status IN {VENDOR_STATUSES}",
            name=op.f("ck_vendor_status_events_from_status_values"),
        ),
        sa.CheckConstraint(
            "actor_type IN ('admin', 'system', 'vendor')",
            name=op.f("ck_vendor_status_events_actor_type_values"),
        ),
        sa.CheckConstraint(
            "actor_type = 'system' OR actor_id IS NOT NULL",
            name=op.f("ck_vendor_status_events_actor_id_required"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_vendor_status_events_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_status_events")),
    )
    op.create_index(
        op.f("ix_vendor_status_events_vendor_id_id"),
        "vendor_status_events",
        ["vendor_id", "id"],
    )
    # Append-only: the audit trail cannot be rewritten, even by a bug in the application.
    op.execute(
        """
        CREATE FUNCTION vendor_status_events_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'vendor_status_events is append-only'
                USING ERRCODE = 'integrity_constraint_violation';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER vendor_status_events_append_only
        BEFORE UPDATE OR DELETE ON vendor_status_events
        FOR EACH ROW EXECUTE FUNCTION vendor_status_events_append_only()
        """
    )

    op.create_table(
        "vendor_users",
        _uuid_pk(),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), server_default=sa.text("'invited'"), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("email = lower(btrim(email))", name=op.f("ck_vendor_users_email_lower")),
        sa.CheckConstraint("role IN ('owner', 'staff')", name=op.f("ck_vendor_users_role_values")),
        sa.CheckConstraint(
            "status IN ('invited', 'active', 'disabled')",
            name=op.f("ck_vendor_users_status_values"),
        ),
        sa.CheckConstraint(
            "password_hash IS NOT NULL OR status IN ('invited', 'disabled')",
            name=op.f("ck_vendor_users_password_set_when_active"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_vendor_users_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_users")),
        sa.UniqueConstraint("email", name=op.f("uq_vendor_users_email")),
    )
    op.create_index(op.f("ix_vendor_users_vendor_id"), "vendor_users", ["vendor_id"])
    op.create_index(
        op.f("uq_vendor_users_one_owner_per_vendor"),
        "vendor_users",
        ["vendor_id"],
        unique=True,
        postgresql_where=sa.text("role = 'owner'"),
    )

    op.create_table(
        "auth_tokens",
        _uuid_pk(),
        sa.Column("vendor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "purpose IN ('verify_email', 'invite', 'reset_password')",
            name=op.f("ck_auth_tokens_purpose_values"),
        ),
        sa.CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'", name=op.f("ck_auth_tokens_token_hash_sha256_hex")
        ),
        sa.ForeignKeyConstraint(
            ["vendor_user_id"],
            ["vendor_users.id"],
            name=op.f("fk_auth_tokens_vendor_user_id_vendor_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_tokens_token_hash")),
    )
    op.create_index(
        op.f("ix_auth_tokens_vendor_user_id_purpose"),
        "auth_tokens",
        ["vendor_user_id", "purpose"],
    )


def downgrade() -> None:
    op.drop_table("auth_tokens")
    op.drop_table("vendor_users")
    op.execute("DROP TRIGGER vendor_status_events_append_only ON vendor_status_events")
    op.drop_table("vendor_status_events")
    op.execute("DROP FUNCTION vendor_status_events_append_only()")
    op.drop_table("vendors")
