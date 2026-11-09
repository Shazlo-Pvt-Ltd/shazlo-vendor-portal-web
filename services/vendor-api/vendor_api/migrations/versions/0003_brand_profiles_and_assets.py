"""assets and brand profiles (one row per version), with the helpers they need

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-08
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ASSET_KINDS = "('brand_logo', 'brand_banner', 'product_image')"
ASSET_STATUSES = "('pending', 'ready', 'deleted')"
PROFILE_STATES = "('draft', 'pending_review', 'published', 'superseded', 'rejected')"


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
    # True when every item is trimmed, non-empty, at most `max_length` characters and unique.
    # A function, because a CHECK cannot contain a subquery but may call one.
    op.execute(
        """
        CREATE FUNCTION is_clean_text_list(items text[], max_length integer) RETURNS boolean
        LANGUAGE sql IMMUTABLE AS $$
            SELECT coalesce(
                (SELECT count(*) = count(DISTINCT item)
                        AND bool_and(item = btrim(item) AND length(item) BETWEEN 1 AND max_length)
                 FROM unnest(items) AS item),
                true)
        $$
        """
    )
    # Keeps `version` increasing per group (a vendor, later a product) and never changing. The
    # advisory lock serialises concurrent inserts for one group, so two requests cannot both
    # pass the check and insert out of order.
    op.execute(
        """
        CREATE FUNCTION enforce_version_increases() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            group_value uuid;
            has_newer boolean;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF NEW.version IS DISTINCT FROM OLD.version THEN
                    RAISE EXCEPTION '% version cannot change', TG_TABLE_NAME
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
                RETURN NEW;
            END IF;
            group_value := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
            PERFORM pg_advisory_xact_lock(
                hashtextextended(TG_TABLE_NAME || ':' || group_value::text, 0));
            EXECUTE format(
                'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1 AND version >= $2)',
                TG_TABLE_NAME, TG_ARGV[0])
                INTO has_newer USING group_value, NEW.version;
            IF has_newer THEN
                RAISE EXCEPTION '% version must be higher than every earlier version', TG_TABLE_NAME
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )

    op.create_table(
        "assets",
        _uuid_pk(),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column(
            "provider", sa.String(16), server_default=sa.text("'cloudinary'"), nullable=False
        ),
        sa.Column("public_id", sa.String(255), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("format", sa.String(16), nullable=True),
        sa.Column("bytes", sa.BigInteger(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(f"kind IN {ASSET_KINDS}", name=op.f("ck_assets_kind_values")),
        sa.CheckConstraint("provider IN ('cloudinary')", name=op.f("ck_assets_provider_values")),
        sa.CheckConstraint(f"status IN {ASSET_STATUSES}", name=op.f("ck_assets_status_values")),
        sa.CheckConstraint(
            "length(btrim(public_id)) > 0", name=op.f("ck_assets_public_id_not_blank")
        ),
        sa.CheckConstraint("url ~ '^https://[^[:space:]]+$'", name=op.f("ck_assets_url_https")),
        sa.CheckConstraint("bytes IS NULL OR bytes > 0", name=op.f("ck_assets_bytes_positive")),
        sa.CheckConstraint("width IS NULL OR width > 0", name=op.f("ck_assets_width_positive")),
        sa.CheckConstraint("height IS NULL OR height > 0", name=op.f("ck_assets_height_positive")),
        sa.CheckConstraint(
            "status <> 'ready' OR (format IS NOT NULL AND bytes IS NOT NULL "
            "AND width IS NOT NULL AND height IS NOT NULL)",
            name=op.f("ck_assets_ready_has_metadata"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_assets_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["vendor_users.id"],
            name=op.f("fk_assets_created_by_vendor_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assets")),
        sa.UniqueConstraint("public_id", name=op.f("uq_assets_public_id")),
        sa.UniqueConstraint("vendor_id", "id", name=op.f("uq_assets_vendor_id_id")),
    )
    op.create_index(op.f("ix_assets_vendor_id_kind"), "assets", ["vendor_id", "kind"])

    op.create_table(
        "brand_profiles",
        _uuid_pk(),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(16), server_default=sa.text("'draft'"), nullable=False),
        sa.Column("brand_name", sa.String(120), nullable=False),
        sa.Column("tagline", sa.String(160), nullable=True),
        sa.Column("about", sa.String(4000), nullable=True),
        sa.Column("logo_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("banner_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("website_url", sa.String(500), nullable=True),
        sa.Column("instagram_handle", sa.String(30), nullable=True),
        sa.Column(
            "categories",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("price_min_paise", sa.BigInteger(), nullable=False),
        sa.Column("price_max_paise", sa.BigInteger(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            f"state IN {PROFILE_STATES}", name=op.f("ck_brand_profiles_state_values")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_brand_profiles_version_positive")),
        sa.CheckConstraint(
            "length(btrim(brand_name)) > 0", name=op.f("ck_brand_profiles_brand_name_not_blank")
        ),
        sa.CheckConstraint(
            "website_url IS NULL OR website_url ~ '^https://[^[:space:]]+$'",
            name=op.f("ck_brand_profiles_website_https"),
        ),
        sa.CheckConstraint(
            "instagram_handle IS NULL OR instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'",
            name=op.f("ck_brand_profiles_instagram_handle_format"),
        ),
        sa.CheckConstraint(
            "is_clean_text_list(categories, 80)", name=op.f("ck_brand_profiles_categories_clean")
        ),
        sa.CheckConstraint(
            "state = 'draft' OR cardinality(categories) >= 1",
            name=op.f("ck_brand_profiles_categories_required_on_submit"),
        ),
        sa.CheckConstraint(
            "price_min_paise >= 0", name=op.f("ck_brand_profiles_price_min_not_negative")
        ),
        sa.CheckConstraint(
            "price_max_paise >= price_min_paise", name=op.f("ck_brand_profiles_price_range")
        ),
        sa.CheckConstraint(
            "state = 'draft' OR submitted_at IS NOT NULL",
            name=op.f("ck_brand_profiles_submitted_at_set"),
        ),
        sa.CheckConstraint(
            "(state IN ('published', 'superseded')) = (published_at IS NOT NULL)",
            name=op.f("ck_brand_profiles_published_at_matches_state"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_brand_profiles_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id", "logo_asset_id"],
            ["assets.vendor_id", "assets.id"],
            name=op.f("fk_brand_profiles_logo_asset_id_assets"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id", "banner_asset_id"],
            ["assets.vendor_id", "assets.id"],
            name=op.f("fk_brand_profiles_banner_asset_id_assets"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["vendor_users.id"],
            name=op.f("fk_brand_profiles_updated_by_vendor_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_brand_profiles")),
        sa.UniqueConstraint(
            "vendor_id", "version", name=op.f("uq_brand_profiles_vendor_id_version")
        ),
    )
    op.create_index(
        op.f("uq_brand_profiles_one_draft_per_vendor"),
        "brand_profiles",
        ["vendor_id"],
        unique=True,
        postgresql_where=sa.text("state = 'draft'"),
    )
    op.create_index(
        op.f("uq_brand_profiles_one_published_per_vendor"),
        "brand_profiles",
        ["vendor_id"],
        unique=True,
        postgresql_where=sa.text("state = 'published'"),
    )
    op.execute(
        """
        CREATE TRIGGER brand_profiles_version_increases
        BEFORE INSERT OR UPDATE ON brand_profiles
        FOR EACH ROW EXECUTE FUNCTION enforce_version_increases('vendor_id')
        """
    )


def downgrade() -> None:
    op.drop_table("brand_profiles")
    op.drop_table("assets")
    op.execute("DROP FUNCTION enforce_version_increases()")
    op.execute("DROP FUNCTION is_clean_text_list(text[], integer)")
