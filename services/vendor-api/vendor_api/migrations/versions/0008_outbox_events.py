"""the transactional outbox: events for the central app

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-10

An approval and the event that tells the central app about it are saved in one transaction, so
neither can exist without the other (ADR 0003, section 5). This is the table the events are
written to; writing them and sending them come later.

A row's content (what the event is and says) never changes. Only where it stands does: its
status, the attempt count, when to try next, the claim, the last error and when it was sent. The
status moves along the worker's path only, and `sent` is final:

    pending -> sending                  a worker claimed it
    sending -> pending | sent | dead    to retry, delivered, or failed for good
    dead    -> pending                  an admin retried it

Rows are deleted by the retention job (30 days after they were sent), so DELETE is allowed.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The central app refuses a body over 256 KB (413); the database is a backstop for the builders.
MAX_PAYLOAD_BYTES = 262_144


def upgrade() -> None:
    op.create_table(
        "outbox_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("aggregate_type", sa.String(16), nullable=False),
        sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "aggregate_type IN ('brand_profile', 'product', 'vendor')",
            name=op.f("ck_outbox_events_aggregate_type_values"),
        ),
        sa.CheckConstraint(
            "event_type IN ('brand_profile.published', 'brand_profile.unpublished', "
            "'product.published', 'product.unpublished', 'vendor.status_changed')",
            name=op.f("ck_outbox_events_event_type_values"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sending', 'sent', 'dead')",
            name=op.f("ck_outbox_events_status_values"),
        ),
        # An event is about its own kind of aggregate.
        sa.CheckConstraint(
            "(aggregate_type = 'brand_profile' AND event_type IN "
            "('brand_profile.published', 'brand_profile.unpublished')) "
            "OR (aggregate_type = 'product' AND event_type IN "
            "('product.published', 'product.unpublished')) "
            "OR (aggregate_type = 'vendor' AND event_type = 'vendor.status_changed')",
            name=op.f("ck_outbox_events_event_type_matches_aggregate"),
        ),
        # The aggregate of a vendor event is the vendor itself.
        sa.CheckConstraint(
            "aggregate_type <> 'vendor' OR aggregate_id = vendor_id",
            name=op.f("ck_outbox_events_vendor_event_is_about_the_vendor"),
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_outbox_events_version_positive")),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_outbox_events_attempts_not_negative")),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'", name=op.f("ck_outbox_events_payload_is_object")
        ),
        sa.CheckConstraint(
            f"octet_length(payload::text) <= {MAX_PAYLOAD_BYTES}",
            name=op.f("ck_outbox_events_payload_size"),
        ),
        # What a failure says is kept short: it is a reason, not a copy of the response.
        sa.CheckConstraint(
            "last_error IS NULL OR length(last_error) <= 1000",
            name=op.f("ck_outbox_events_last_error_bounded"),
        ),
        sa.CheckConstraint(
            "status <> 'dead' OR last_error IS NOT NULL",
            name=op.f("ck_outbox_events_dead_has_reason"),
        ),
        sa.CheckConstraint(
            "(status = 'sent') = (sent_at IS NOT NULL)",
            name=op.f("ck_outbox_events_sent_at_matches_status"),
        ),
        sa.CheckConstraint(
            "(status = 'sending') = (locked_at IS NOT NULL)",
            name=op.f("ck_outbox_events_locked_at_matches_status"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_id"],
            ["vendors.id"],
            name=op.f("fk_outbox_events_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outbox_events")),
        sa.UniqueConstraint(
            "aggregate_type",
            "aggregate_id",
            "version",
            name=op.f("uq_outbox_events_aggregate_type_aggregate_id_version"),
        ),
    )
    # The worker's claim: the rows that are due, oldest first.
    op.create_index(
        op.f("ix_outbox_events_due"),
        "outbox_events",
        ["next_attempt_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    # One vendor's events (the admins' filter, and the fan-out when a vendor is suspended).
    op.create_index(
        op.f("ix_outbox_events_vendor_id_status"), "outbox_events", ["vendor_id", "status"]
    )
    # The admins' view of what is stuck (`dead` first) and the retention job's scan.
    op.create_index(
        op.f("ix_outbox_events_status_created_at"), "outbox_events", ["status", "created_at"]
    )

    op.execute(
        """
        CREATE FUNCTION protect_outbox_event() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            mutable CONSTANT text[] := ARRAY[
                'status', 'attempts', 'next_attempt_at', 'locked_at', 'last_error', 'sent_at'
            ];
        BEGIN
            IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
                RAISE EXCEPTION 'the content of an outbox event cannot change'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF OLD.status = 'sent' THEN
                RAISE EXCEPTION 'a sent outbox event cannot change'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                (OLD.status = 'pending' AND NEW.status = 'sending')
                OR (OLD.status = 'sending' AND NEW.status IN ('pending', 'sent', 'dead'))
                OR (OLD.status = 'dead' AND NEW.status = 'pending')
            ) THEN
                RAISE EXCEPTION 'an outbox event cannot go from % to %', OLD.status, NEW.status
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER outbox_events_protect
        BEFORE UPDATE ON outbox_events
        FOR EACH ROW EXECUTE FUNCTION protect_outbox_event()
        """
    )


def downgrade() -> None:
    op.drop_table("outbox_events")  # the trigger and the indexes go with the table
    op.execute("DROP FUNCTION protect_outbox_event()")
