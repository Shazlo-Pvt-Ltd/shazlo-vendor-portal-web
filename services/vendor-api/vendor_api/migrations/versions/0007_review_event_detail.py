"""review events record what a decision changed

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-10

An audit entry for a decision says who, what, when and why. This adds the rest: `detail`, a JSON
object with what the decision changed: the state of the thing reviewed before and after (a brand
profile version going from `pending_review` to `published` and the version it superseded, a
product going live and its new `version`), so the trail can be read without reconstructing it from
the rows that changed. It is nullable: events written before this, and the ones that need
nothing more (a submission), have none.

Adding a column does not touch the append-only triggers (they fire on UPDATE, DELETE and
TRUNCATE of rows), so existing events stay exactly as they were.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("review_events", sa.Column("detail", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("review_events", "detail")
