"""store details, per-brand commission, size charts and their audit (#265)

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-21

- `store_details`: one row per vendor with the sign-up topics the seller keeps up to date. Payout
  numbers are sealed by the application (AES-GCM); only masked parts are kept in clear.
- `commissions`: one row per vendor; no row means no rate (there is no default).
- `size_charts`: one row per vendor and size group, with an optional photo that is one of the
  vendor's own assets (composite foreign key). Assets get the kind `size_chart`.
- `vendor_change_events`: append-only audit of changes to all three (UPDATE, DELETE and TRUNCATE
  raise, with `forbid_update_delete_truncate()` from 0005).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# A payout is nothing, a whole bank account or a whole UPI ID (frozen copy of the model's check).
PAYOUT_WHOLE = (
    "(payout_method IS NULL AND payout_secret IS NULL AND payout_key_id IS NULL "
    "AND payout_holder_name IS NULL AND payout_account_last4 IS NULL "
    "AND payout_ifsc IS NULL AND payout_bank_name IS NULL AND payout_upi_masked IS NULL) "
    "OR (payout_method = 'bank' AND payout_secret IS NOT NULL AND payout_key_id IS NOT NULL "
    "AND payout_holder_name IS NOT NULL AND payout_account_last4 ~ '^[0-9]{4}$' "
    "AND payout_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$' AND payout_upi_masked IS NULL) "
    "OR (payout_method = 'upi' AND payout_secret IS NOT NULL AND payout_key_id IS NOT NULL "
    "AND payout_upi_masked IS NOT NULL AND payout_holder_name IS NULL "
    "AND payout_account_last4 IS NULL AND payout_ifsc IS NULL AND payout_bank_name IS NULL)"
)

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ASSET_KINDS = "('brand_logo', 'brand_banner', 'product_image')"
NEW_ASSET_KINDS = "('brand_logo', 'brand_banner', 'product_image', 'size_chart')"


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.drop_constraint(op.f("ck_assets_kind_values"), "assets", type_="check")
    op.create_check_constraint(
        op.f("ck_assets_kind_values"), "assets", f"kind IN {NEW_ASSET_KINDS}"
    )

    op.create_table(
        "store_details",
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sells", sa.String(8), nullable=True),
        sa.Column("city", sa.String(80), nullable=True),
        sa.Column("instagram_or_website", sa.String(300), nullable=True),
        sa.Column("contact_name", sa.String(200), nullable=True),
        sa.Column("contact_phone", sa.String(10), nullable=True),
        sa.Column("contact_email", sa.String(320), nullable=True),
        sa.Column("delivery", postgresql.JSONB(), nullable=True),
        sa.Column("return_window_days", sa.Integer(), nullable=True),
        sa.Column("return_condition", sa.String(20), nullable=True),
        sa.Column("refund_days", sa.Integer(), nullable=True),
        sa.Column("pod_cash", sa.Boolean(), nullable=True),
        sa.Column("pod_upi", sa.Boolean(), nullable=True),
        sa.Column("payout_method", sa.String(4), nullable=True),
        sa.Column("payout_secret", sa.LargeBinary(), nullable=True),
        sa.Column("payout_key_id", sa.String(64), nullable=True),
        sa.Column("payout_holder_name", sa.String(200), nullable=True),
        sa.Column("payout_account_last4", sa.String(4), nullable=True),
        sa.Column("payout_ifsc", sa.String(11), nullable=True),
        sa.Column("payout_bank_name", sa.String(100), nullable=True),
        sa.Column("payout_upi_masked", sa.String(80), nullable=True),
        sa.Column("legal_name", sa.String(120), nullable=True),
        sa.Column("gstin", sa.String(15), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "sells IS NULL OR sells IN ('women', 'men', 'both')",
            name=op.f("ck_store_details_sells_values"),
        ),
        sa.CheckConstraint(
            "city IS NULL OR length(btrim(city)) >= 2", name=op.f("ck_store_details_city_not_blank")
        ),
        sa.CheckConstraint(
            "(contact_name IS NULL) = (contact_phone IS NULL) "
            "AND (contact_name IS NULL) = (contact_email IS NULL)",
            name=op.f("ck_store_details_contact_whole"),
        ),
        sa.CheckConstraint(
            "contact_phone IS NULL OR contact_phone ~ '^[6-9][0-9]{9}$'",
            name=op.f("ck_store_details_contact_phone"),
        ),
        sa.CheckConstraint(
            "delivery IS NULL OR delivery->>'mode' IN ('shazlo', 'own')",
            name=op.f("ck_store_details_delivery_mode"),
        ),
        sa.CheckConstraint(
            "return_window_days IS NULL OR return_window_days IN (0, 7, 14, 30)",
            name=op.f("ck_store_details_return_window_values"),
        ),
        sa.CheckConstraint(
            "return_condition IS NULL OR return_condition IN "
            "('unworn_with_tags', 'any_reason', 'damaged_or_wrong')",
            name=op.f("ck_store_details_return_condition_values"),
        ),
        sa.CheckConstraint(
            "refund_days IS NULL OR refund_days IN (2, 5, 7)",
            name=op.f("ck_store_details_refund_values"),
        ),
        sa.CheckConstraint(
            "(return_window_days IS NULL AND return_condition IS NULL AND refund_days IS NULL) "
            "OR (return_window_days = 0 AND return_condition IS NULL AND refund_days IS NULL) "
            "OR (return_window_days > 0 AND return_condition IS NOT NULL "
            "AND refund_days IS NOT NULL)",
            name=op.f("ck_store_details_returns_whole"),
        ),
        sa.CheckConstraint(
            "(pod_cash IS NULL) = (pod_upi IS NULL) AND (pod_cash IS NULL OR pod_cash OR pod_upi)",
            name=op.f("ck_store_details_pay_on_delivery_whole"),
        ),
        sa.CheckConstraint(
            "payout_method IS NULL OR payout_method IN ('bank', 'upi')",
            name=op.f("ck_store_details_payout_method_values"),
        ),
        sa.CheckConstraint(PAYOUT_WHOLE, name=op.f("ck_store_details_payout_whole")),
        sa.CheckConstraint(
            "gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'",
            name=op.f("ck_store_details_gstin_shape"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_store_details_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["vendor_users.id"],
            name=op.f("fk_store_details_updated_by_vendor_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("vendor_id", name=op.f("pk_store_details")),
    )

    op.create_table(
        "commissions",
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("agreed_bps", sa.Integer(), nullable=True),
        sa.Column("proposed_bps", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "state IN ('not_set', 'proposed', 'sent_back', 'agreed')",
            name=op.f("ck_commissions_state_values"),
        ),
        sa.CheckConstraint(
            "agreed_bps IS NULL OR agreed_bps BETWEEN 0 AND 4000",
            name=op.f("ck_commissions_agreed_range"),
        ),
        sa.CheckConstraint(
            "proposed_bps IS NULL OR proposed_bps BETWEEN 0 AND 4000",
            name=op.f("ck_commissions_proposed_range"),
        ),
        sa.CheckConstraint(
            "note IS NULL OR length(note) <= 600", name=op.f("ck_commissions_note_bounded")
        ),
        sa.CheckConstraint(
            "(state = 'not_set' AND agreed_bps IS NULL AND proposed_bps IS NULL AND note IS NULL) "
            "OR (state = 'proposed' AND proposed_bps IS NOT NULL AND note IS NULL) "
            "OR (state = 'sent_back' AND proposed_bps IS NOT NULL AND note IS NOT NULL) "
            "OR (state = 'agreed' AND agreed_bps IS NOT NULL AND proposed_bps IS NULL)",
            name=op.f("ck_commissions_state_whole"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_commissions_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("vendor_id", name=op.f("pk_commissions")),
    )
    # The admin list filters by state ("rates to review").
    op.create_index(op.f("ix_commissions_state"), "commissions", ["state"])

    op.create_table(
        "size_charts",
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("size_group", sa.String(10), nullable=False),
        sa.Column("measurements", postgresql.JSONB(), nullable=False),
        sa.Column("photo_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "size_group IN ('bottoms', 'tops', 'dresses', 'jackets')",
            name=op.f("ck_size_charts_size_group_values"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(measurements) = 'object'",
            name=op.f("ck_size_charts_measurements_object"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_size_charts_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id", "photo_asset_id"],
            ["assets.vendor_id", "assets.id"],
            name=op.f("fk_size_charts_photo_asset_id_assets"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["vendor_users.id"],
            name=op.f("fk_size_charts_updated_by_vendor_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("vendor_id", "size_group", name=op.f("pk_size_charts")),
    )

    op.create_table(
        "vendor_change_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject", sa.String(16), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("detail", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "subject IN ('brand', 'contact', 'delivery', 'returns', 'payment', 'payout', "
            "'business', 'commission', 'size_chart')",
            name=op.f("ck_vendor_change_events_subject_values"),
        ),
        sa.CheckConstraint(
            "actor_type IN ('admin', 'system', 'vendor')",
            name=op.f("ck_vendor_change_events_actor_type_values"),
        ),
        sa.CheckConstraint(
            "actor_type = 'system' OR actor_id IS NOT NULL",
            name=op.f("ck_vendor_change_events_actor_id_required"),
        ),
        sa.CheckConstraint(
            "length(action) BETWEEN 1 AND 32", name=op.f("ck_vendor_change_events_action_bounded")
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_vendor_change_events_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_change_events")),
    )
    op.create_index(
        op.f("ix_vendor_change_events_vendor_id_id"), "vendor_change_events", ["vendor_id", "id"]
    )
    op.execute(
        """
        CREATE TRIGGER vendor_change_events_append_only
        BEFORE UPDATE OR DELETE ON vendor_change_events
        FOR EACH ROW EXECUTE FUNCTION forbid_update_delete_truncate()
        """
    )
    op.execute(
        """
        CREATE TRIGGER vendor_change_events_no_truncate
        BEFORE TRUNCATE ON vendor_change_events
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete_truncate()
        """
    )


def downgrade() -> None:
    op.drop_table("vendor_change_events")
    op.drop_table("size_charts")
    op.drop_table("commissions")
    op.drop_table("store_details")
    op.execute("DELETE FROM assets WHERE kind = 'size_chart'")
    op.drop_constraint(op.f("ck_assets_kind_values"), "assets", type_="check")
    op.create_check_constraint(
        op.f("ck_assets_kind_values"), "assets", f"kind IN {OLD_ASSET_KINDS}"
    )
