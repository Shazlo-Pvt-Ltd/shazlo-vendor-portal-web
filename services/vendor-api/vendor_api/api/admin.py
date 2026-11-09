"""The admin API group: `/v1/admin/*` accepts only identity-api tokens (ADR 0009).

Who is calling comes from the verified token, never from the request: a reviewer on a review is
always `Reviewer.id`, the token's `sub`. Admin request bodies derive from `AdminRequest`, which
forbids unknown fields, so a `reviewer_id` sent in a body is a 422; one in the query or a header
is simply never read.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict
from shazlo_auth.fastapi import AuthenticatedAdmin, require_role

from vendor_api.api.auth import no_store

# `super_admin` always passes (py-auth). One dependency object, so FastAPI runs the check once
# per request even where an endpoint also asks for the admin.
reviewer_dependency = require_role("vendor_reviewer")
Reviewer = Annotated[AuthenticatedAdmin, Depends(reviewer_dependency)]

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(reviewer_dependency)])


class AdminRequest(BaseModel):
    """Base of every admin request body: unknown fields are refused, not ignored."""

    model_config = ConfigDict(extra="forbid")


class AdminMe(BaseModel):
    id: uuid.UUID
    roles: list[str]


@router.get("/me")
async def me(response: Response, admin: Reviewer) -> AdminMe:
    """The admin behind the token: the id and the roles in it. Nothing is looked up, because
    admins live in identity-api; this is the first admin endpoint and a check for Phase 3."""
    no_store(response)
    return AdminMe(id=admin.id, roles=sorted(admin.roles))
