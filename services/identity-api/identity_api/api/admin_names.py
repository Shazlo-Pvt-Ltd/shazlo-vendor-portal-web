"""Who is behind an admin id: a name for any signed-in admin (#299).

Other services keep only an admin's id (a reviewer on a review, an admin who retried an event).
Showing "By Priya Mehta" needs the name, and `/v1/admins` is for super admins only. This is the
small lookup that any signed-in admin may call, so it returns **nothing but the id and the display
name**: no email, roles or status. Ids that match nobody are left out, and the caller shows its own
"a former admin" for them; a deactivated admin still has a name, since their past decisions do.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.api.auth import no_store
from identity_api.api.deps import current_admin
from identity_api.core.errors import error_responses
from identity_api.db.models import Admin
from identity_api.db.session import get_session

# One page of recent decisions, or a page of a history, at most.
MAX_IDS = 100

router = APIRouter(tags=["admins"], dependencies=[Depends(current_admin)])

Db = Annotated[AsyncSession, Depends(get_session)]


class AdminName(BaseModel):
    id: uuid.UUID
    display_name: str


class AdminNames(BaseModel):
    items: list[AdminName]


@router.get(
    "/admins/names",
    responses=error_responses(
        (401, ("unauthorized",)),
        (403, ("password_change_required",)),
        (422, ("validation_error",)),
    ),
)
async def admin_names(
    response: Response,
    db: Db,
    ids: Annotated[
        list[uuid.UUID],
        Query(max_length=MAX_IDS, description="Admin ids; repeat the parameter, at most 100"),
    ],
) -> AdminNames:
    """The display names of the admins with these ids, for any signed-in admin."""
    no_store(response)
    unique = list(dict.fromkeys(ids))
    rows = await db.execute(
        select(Admin.id, Admin.display_name).where(Admin.id.in_(unique)).order_by(Admin.id)
    )
    return AdminNames(items=[AdminName(id=i, display_name=n) for i, n in rows])
