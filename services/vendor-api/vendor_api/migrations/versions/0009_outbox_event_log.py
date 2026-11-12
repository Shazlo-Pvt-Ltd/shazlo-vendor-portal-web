"""the log of an outbox event: its attempts and an admin's retries

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-12

`outbox_events` keeps where an event stands (the attempt count, the last error). This keeps what
happened to it, one row per step, so an admin can see how an event died and who retried it (ADR
0003, section 4): every delivery attempt the worker made, and every retry an admin asked for (with
the admin's id). The rows go with their event (it is deleted by the retention job).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "outbox_event_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "kind IN ('attempt', 'retry')", name=op.f("ck_outbox_event_log_kind_values")
        ),
        # A retry is somebody's: the admin who asked for it.
        sa.CheckConstraint(
            "kind <> 'retry' OR actor_id IS NOT NULL",
            name=op.f("ck_outbox_event_log_retry_has_actor"),
        ),
        # A reason, not a copy of the response.
        sa.CheckConstraint(
            "length(outcome) <= 1000", name=op.f("ck_outbox_event_log_outcome_bounded")
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["outbox_events.id"],
            name=op.f("fk_outbox_event_log_event_id_outbox_events"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outbox_event_log")),
    )
    op.create_index(op.f("ix_outbox_event_log_event_id_id"), "outbox_event_log", ["event_id", "id"])


def downgrade() -> None:
    op.drop_table("outbox_event_log")
