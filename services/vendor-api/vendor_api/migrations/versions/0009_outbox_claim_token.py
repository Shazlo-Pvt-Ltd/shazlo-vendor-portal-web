"""a claim token on outbox events

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-12

A worker that claims a row gets a fresh `claim_token` with it, and records its result only while
the row still carries that token (ADR 0003, section 5). `locked_at` cannot say who holds a row: if
the sweeper gives a slow worker's row away and another worker claims it, a result from the first
worker would otherwise overwrite the second one's claim. The token is delivery state like
`locked_at`, so the protecting trigger lets it change; it is empty unless the row is `sending`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# `protect_outbox_event` (0008) with and without `claim_token` among the columns that may change.
FUNCTION = """
    CREATE OR REPLACE FUNCTION protect_outbox_event() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
        mutable CONSTANT text[] := ARRAY[
            'status', 'attempts', 'next_attempt_at', 'locked_at', {extra}'last_error', 'sent_at'
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


def upgrade() -> None:
    op.add_column(
        "outbox_events", sa.Column("claim_token", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.execute(FUNCTION.format(extra="'claim_token', "))


def downgrade() -> None:
    op.execute(FUNCTION.format(extra=""))
    op.drop_column("outbox_events", "claim_token")
