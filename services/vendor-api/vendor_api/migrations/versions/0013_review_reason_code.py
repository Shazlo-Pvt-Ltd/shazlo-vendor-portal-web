"""the category of a rejection's reason (#295)

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-27

A reviewer sending something back picks a category (photos, price, category, ...) beside the
free-text reason, and the seller sees both. The column is optional (older rejections and API
callers have none), limited to the list, and only a rejection has one. Decided reviews stay
immutable: the code is written in the same update that decides.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of ReviewReasonCode at this revision.
CODES = (
    "photos",
    "try_on_photos",
    "price",
    "category",
    "prohibited",
    "description",
    "brand_images",
    "contact_details",
    "other",
)


def upgrade() -> None:
    op.add_column("reviews", sa.Column("reason_code", sa.String(24), nullable=True))
    op.create_check_constraint(
        op.f("ck_reviews_reason_code_values"),
        "reviews",
        "reason_code IN (" + ", ".join(repr(c) for c in CODES) + ")",
    )
    op.create_check_constraint(
        op.f("ck_reviews_reason_code_only_rejected"),
        "reviews",
        "reason_code IS NULL OR status = 'rejected'",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_reviews_reason_code_only_rejected"), "reviews", type_="check")
    op.drop_constraint(op.f("ck_reviews_reason_code_values"), "reviews", type_="check")
    op.drop_column("reviews", "reason_code")
