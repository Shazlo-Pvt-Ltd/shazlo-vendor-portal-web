"""reviews and the append-only review audit trail

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-08
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column[Any]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def _updated_at() -> sa.Column[Any]:
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    # Reviews point at a brand profile together with its vendor, so the pair must be a key.
    op.create_unique_constraint(
        op.f("uq_brand_profiles_id_vendor_id"), "brand_profiles", ["id", "vendor_id"]
    )

    # For tables nobody may rewrite: raises for every UPDATE, DELETE and TRUNCATE.
    op.execute(
        """
        CREATE FUNCTION forbid_update_delete_truncate() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
                USING ERRCODE = 'integrity_constraint_violation';
        END;
        $$
        """
    )

    op.create_table(
        "reviews",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject", sa.String(16), nullable=False),
        sa.Column("brand_profile_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("product_revision_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "subject IN ('brand_profile', 'product')", name=op.f("ck_reviews_subject_values")
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'withdrawn')",
            name=op.f("ck_reviews_status_values"),
        ),
        sa.CheckConstraint(
            "(subject = 'brand_profile' AND brand_profile_id IS NOT NULL "
            "AND product_revision_id IS NULL) "
            "OR (subject = 'product' AND product_revision_id IS NOT NULL "
            "AND brand_profile_id IS NULL)",
            name=op.f("ck_reviews_one_subject"),
        ),
        sa.CheckConstraint(
            "status <> 'rejected' OR coalesce(reason, '') ~ '\\S'",
            name=op.f("ck_reviews_rejected_needs_reason"),
        ),
        sa.CheckConstraint(
            "status NOT IN ('approved', 'rejected') "
            "OR (reviewer_id IS NOT NULL AND decided_at IS NOT NULL)",
            name=op.f("ck_reviews_decision_needs_reviewer"),
        ),
        sa.CheckConstraint(
            "status <> 'withdrawn' OR (reviewer_id IS NULL AND decided_at IS NOT NULL)",
            name=op.f("ck_reviews_withdrawn_shape"),
        ),
        sa.CheckConstraint(
            "status <> 'pending' OR (reviewer_id IS NULL AND decided_at IS NULL)",
            name=op.f("ck_reviews_pending_shape"),
        ),
        sa.CheckConstraint(
            "decided_at IS NULL OR decided_at >= submitted_at",
            name=op.f("ck_reviews_decided_after"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_reviews_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by"],
            ["vendor_users.id"],
            name=op.f("fk_reviews_submitted_by_vendor_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["brand_profile_id", "vendor_id"],
            ["brand_profiles.id", "brand_profiles.vendor_id"],
            name=op.f("fk_reviews_brand_profile_id_brand_profiles"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["product_revision_id", "vendor_id"],
            ["product_revisions.id", "product_revisions.vendor_id"],
            name=op.f("fk_reviews_product_revision_id_product_revisions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reviews")),
    )
    op.create_index(
        op.f("uq_reviews_one_pending_per_brand_profile"),
        "reviews",
        ["brand_profile_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        op.f("uq_reviews_one_pending_per_product_revision"),
        "reviews",
        ["product_revision_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        op.f("ix_reviews_pending_submitted_at"),
        "reviews",
        ["submitted_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(op.f("ix_reviews_vendor_id_status"), "reviews", ["vendor_id", "status"])
    op.create_index(op.f("ix_reviews_status_submitted_at"), "reviews", ["status", "submitted_at"])

    op.create_table(
        "review_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("review_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "action IN ('submitted', 'approved', 'rejected', 'withdrawn', 'reopened')",
            name=op.f("ck_review_events_action_values"),
        ),
        sa.CheckConstraint(
            "actor_type IN ('admin', 'system', 'vendor')",
            name=op.f("ck_review_events_actor_type_values"),
        ),
        sa.CheckConstraint(
            "actor_type = 'system' OR actor_id IS NOT NULL",
            name=op.f("ck_review_events_actor_id_required"),
        ),
        sa.CheckConstraint(
            "action <> 'rejected' OR coalesce(reason, '') ~ '\\S'",
            name=op.f("ck_review_events_rejected_needs_reason"),
        ),
        sa.ForeignKeyConstraint(
            ["review_id"],
            ["reviews.id"],
            name=op.f("fk_review_events_review_id_reviews"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_events")),
    )
    op.create_index(op.f("ix_review_events_review_id_id"), "review_events", ["review_id", "id"])
    # Append-only, even against a bug in the application: no UPDATE, DELETE or TRUNCATE.
    op.execute(
        """
        CREATE TRIGGER review_events_append_only
        BEFORE UPDATE OR DELETE ON review_events
        FOR EACH ROW EXECUTE FUNCTION forbid_update_delete_truncate()
        """
    )
    op.execute(
        """
        CREATE TRIGGER review_events_no_truncate
        BEFORE TRUNCATE ON review_events
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete_truncate()
        """
    )


def downgrade() -> None:
    op.drop_table("review_events")
    op.drop_table("reviews")
    op.execute("DROP FUNCTION forbid_update_delete_truncate()")
    op.drop_constraint("uq_brand_profiles_id_vendor_id", "brand_profiles", type_="unique")
