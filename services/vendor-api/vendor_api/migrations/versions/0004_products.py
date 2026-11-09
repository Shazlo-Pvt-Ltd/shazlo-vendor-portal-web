"""products, product revisions, variants (with per-revision prices) and images

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-08
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRODUCT_STATUSES = "('draft', 'pending_review', 'approved', 'rejected', 'archived')"
GENDERS = "('women', 'men', 'unisex')"


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


def _uuid(name: str, *, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION enforce_version_never_decreases() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.version < OLD.version THEN
                RAISE EXCEPTION '% version cannot go down', TG_TABLE_NAME
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    # A revision is submitted for review only when it has something to review: at least one
    # active variant and one image. (Insert it as a draft, add those, then submit.)
    op.execute(
        """
        CREATE FUNCTION require_variant_and_image_on_submit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.submitted_at IS NOT NULL
               AND (TG_OP = 'INSERT' OR OLD.submitted_at IS NULL) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM product_revision_variants
                    WHERE revision_id = NEW.id AND is_active
                ) THEN
                    RAISE EXCEPTION 'a revision needs at least one active variant to be submitted'
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM product_images WHERE revision_id = NEW.id) THEN
                    RAISE EXCEPTION 'a revision needs at least one image to be submitted'
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )

    op.create_table(
        "products",
        _uuid_pk(),
        _uuid("vendor_id"),
        sa.Column("sku", sa.String(64), nullable=False),
        sa.Column("sku_key", sa.Text(), sa.Computed("lower(sku)", persisted=True), nullable=False),
        sa.Column("status", sa.String(16), server_default=sa.text("'draft'"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        _uuid("live_revision_id", nullable=True),
        _uuid("pending_revision_id", nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(f"status IN {PRODUCT_STATUSES}", name=op.f("ck_products_status_values")),
        sa.CheckConstraint("version >= 1", name=op.f("ck_products_version_positive")),
        sa.CheckConstraint(
            "length(sku) > 0 AND sku = btrim(sku)", name=op.f("ck_products_sku_clean")
        ),
        sa.CheckConstraint(
            "status <> 'approved' OR live_revision_id IS NOT NULL",
            name=op.f("ck_products_approved_has_live"),
        ),
        sa.CheckConstraint(
            "status NOT IN ('draft', 'pending_review', 'rejected') OR live_revision_id IS NULL",
            name=op.f("ck_products_unapproved_has_no_live"),
        ),
        sa.CheckConstraint(
            "live_revision_id IS NULL OR pending_revision_id IS NULL "
            "OR live_revision_id <> pending_revision_id",
            name=op.f("ck_products_live_and_pending_differ"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_products_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
        sa.UniqueConstraint("vendor_id", "sku_key", name=op.f("uq_products_vendor_id_sku_key")),
        sa.UniqueConstraint("id", "vendor_id", name=op.f("uq_products_id_vendor_id")),
    )
    op.create_index(op.f("ix_products_vendor_id_status"), "products", ["vendor_id", "status"])
    op.execute(
        """
        CREATE TRIGGER products_version_never_decreases
        BEFORE UPDATE ON products
        FOR EACH ROW EXECUTE FUNCTION enforce_version_never_decreases()
        """
    )

    op.create_table(
        "product_revisions",
        _uuid_pk(),
        _uuid("product_id"),
        _uuid("vendor_id"),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.String(4000), nullable=True),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("subcategory", sa.String(100), nullable=True),
        sa.Column("gender", sa.String(8), nullable=False),
        sa.Column("fabric", sa.String(80), nullable=True),
        sa.Column("weight_grams", sa.Integer(), nullable=True),
        sa.Column("returnable", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("return_window_days", sa.Integer(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        _uuid("created_by"),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("version >= 1", name=op.f("ck_product_revisions_version_positive")),
        sa.CheckConstraint(
            "length(btrim(title)) > 0", name=op.f("ck_product_revisions_title_not_blank")
        ),
        sa.CheckConstraint(
            "length(btrim(category)) > 0", name=op.f("ck_product_revisions_category_not_blank")
        ),
        sa.CheckConstraint(f"gender IN {GENDERS}", name=op.f("ck_product_revisions_gender_values")),
        sa.CheckConstraint(
            "weight_grams IS NULL OR weight_grams > 0",
            name=op.f("ck_product_revisions_weight_positive"),
        ),
        sa.CheckConstraint(
            "return_window_days IS NULL OR return_window_days BETWEEN 0 AND 30",
            name=op.f("ck_product_revisions_return_window_range"),
        ),
        sa.CheckConstraint(
            "NOT returnable OR return_window_days IS NOT NULL",
            name=op.f("ck_product_revisions_return_window_required"),
        ),
        sa.ForeignKeyConstraint(
            ["product_id", "vendor_id"],
            ["products.id", "products.vendor_id"],
            name=op.f("fk_product_revisions_product_id_products"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["vendor_users.id"],
            name=op.f("fk_product_revisions_created_by_vendor_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_revisions")),
        sa.UniqueConstraint(
            "product_id", "version", name=op.f("uq_product_revisions_product_id_version")
        ),
        sa.UniqueConstraint("id", "product_id", name=op.f("uq_product_revisions_id_product_id")),
        sa.UniqueConstraint("id", "vendor_id", name=op.f("uq_product_revisions_id_vendor_id")),
    )
    op.execute(
        """
        CREATE TRIGGER product_revisions_version_increases
        BEFORE INSERT OR UPDATE ON product_revisions
        FOR EACH ROW EXECUTE FUNCTION enforce_version_increases('product_id')
        """
    )
    op.execute(
        """
        CREATE TRIGGER product_revisions_need_variant_and_image
        BEFORE INSERT OR UPDATE OF submitted_at ON product_revisions
        FOR EACH ROW EXECUTE FUNCTION require_variant_and_image_on_submit()
        """
    )

    # The two circular links, now that both tables exist. Each carries the product id, so the
    # revision must belong to this product.
    op.create_foreign_key(
        op.f("fk_products_live_revision_id_product_revisions"),
        "products",
        "product_revisions",
        ["live_revision_id", "id"],
        ["id", "product_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_products_pending_revision_id_product_revisions"),
        "products",
        "product_revisions",
        ["pending_revision_id", "id"],
        ["id", "product_id"],
        ondelete="RESTRICT",
    )

    op.create_table(
        "product_variants",
        _uuid_pk(),
        _uuid("product_id"),
        _uuid("vendor_id"),
        sa.Column("sku", sa.String(64), nullable=False),
        sa.Column("sku_key", sa.Text(), sa.Computed("lower(sku)", persisted=True), nullable=False),
        sa.Column("size", sa.String(32), server_default=sa.text("''"), nullable=False),
        sa.Column("color", sa.String(32), server_default=sa.text("''"), nullable=False),
        _created_at(),
        sa.CheckConstraint(
            "length(sku) > 0 AND sku = btrim(sku)", name=op.f("ck_product_variants_sku_clean")
        ),
        sa.ForeignKeyConstraint(
            ["product_id", "vendor_id"],
            ["products.id", "products.vendor_id"],
            name=op.f("fk_product_variants_product_id_products"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_variants")),
        sa.UniqueConstraint(
            "vendor_id", "sku_key", name=op.f("uq_product_variants_vendor_id_sku_key")
        ),
        sa.UniqueConstraint(
            "product_id", "size", "color", name=op.f("uq_product_variants_product_id_size_color")
        ),
        sa.UniqueConstraint("id", "product_id", name=op.f("uq_product_variants_id_product_id")),
    )

    op.create_table(
        "product_revision_variants",
        _uuid("revision_id"),
        _uuid("variant_id"),
        _uuid("product_id"),
        sa.Column("price_paise", sa.BigInteger(), nullable=False),
        sa.Column("mrp_paise", sa.BigInteger(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "price_paise > 0", name=op.f("ck_product_revision_variants_price_positive")
        ),
        sa.CheckConstraint(
            "mrp_paise >= price_paise", name=op.f("ck_product_revision_variants_mrp_at_least_price")
        ),
        sa.ForeignKeyConstraint(
            ["revision_id", "product_id"],
            ["product_revisions.id", "product_revisions.product_id"],
            name=op.f("fk_product_revision_variants_revision_id_product_revisions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["variant_id", "product_id"],
            ["product_variants.id", "product_variants.product_id"],
            name=op.f("fk_product_revision_variants_variant_id_product_variants"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "revision_id", "variant_id", name=op.f("pk_product_revision_variants")
        ),
    )
    op.create_index(
        op.f("ix_product_revision_variants_variant_id"), "product_revision_variants", ["variant_id"]
    )

    op.create_table(
        "product_images",
        _uuid_pk(),
        _uuid("revision_id"),
        _uuid("vendor_id"),
        _uuid("asset_id"),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("alt_text", sa.String(200), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "position BETWEEN 1 AND 10", name=op.f("ck_product_images_position_range")
        ),
        sa.ForeignKeyConstraint(
            ["revision_id", "vendor_id"],
            ["product_revisions.id", "product_revisions.vendor_id"],
            name=op.f("fk_product_images_revision_id_product_revisions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id", "asset_id"],
            ["assets.vendor_id", "assets.id"],
            name=op.f("fk_product_images_asset_id_assets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_images")),
        sa.UniqueConstraint(
            "revision_id", "position", name=op.f("uq_product_images_revision_id_position")
        ),
    )
    op.create_index(op.f("ix_product_images_asset_id"), "product_images", ["asset_id"])


def downgrade() -> None:
    op.drop_table("product_images")
    op.drop_table("product_revision_variants")
    op.drop_table("product_variants")
    op.drop_constraint(
        "fk_products_live_revision_id_product_revisions", "products", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_products_pending_revision_id_product_revisions", "products", type_="foreignkey"
    )
    op.drop_table("product_revisions")
    op.drop_table("products")
    op.execute("DROP FUNCTION require_variant_and_image_on_submit()")
    op.execute("DROP FUNCTION enforce_version_never_decreases()")
