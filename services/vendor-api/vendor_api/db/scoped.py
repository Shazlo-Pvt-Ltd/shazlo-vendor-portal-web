"""Queries that cannot forget the vendor.

Every vendor-facing read or write goes through these helpers with the caller's `vendor_id` (from
`current_scope`), so a handler cannot build an unscoped query by accident. Another vendor's
object looks like it does not exist: `get_owned_or_404` raises the endpoint's own 404 for a
missing id and for another vendor's id alike, so nothing tells them apart.
"""

import uuid
from typing import Any, cast

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError


def _vendor_column(model: type[Any]) -> Any:
    column = getattr(model, "vendor_id", None)
    if column is None:
        raise TypeError(
            f"{model.__name__} has no vendor_id, so it cannot be scoped. A table of vendor data "
            "needs a vendor_id (see the isolation test), or a parent that has one."
        )
    return column


def scoped_select(model: type[Any], vendor_id: uuid.UUID) -> Select[Any]:
    """`select(model)` limited to the vendor's rows. Add `.where(...)` and `.order_by(...)`."""
    return select(model).where(_vendor_column(model) == vendor_id)


async def get_owned_or_404[T](
    db: AsyncSession,
    model: type[T],
    object_id: uuid.UUID,
    vendor_id: uuid.UUID,
    not_found: ApiError,
) -> T:
    """The vendor's object with this id, read fresh, or `not_found`.

    The id and the vendor are one condition, so another vendor's id is the same 404 as an id
    that does not exist.
    """
    id_column = getattr(model, "id")  # noqa: B009  (a model's primary key; mypy cannot see it)
    row = await db.scalar(
        scoped_select(model, vendor_id)
        .where(id_column == object_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise not_found
    return cast(T, row)
