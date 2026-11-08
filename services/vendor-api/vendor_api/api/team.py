import uuid
from datetime import datetime
from typing import Annotated, cast

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from shazlo_security.rate_limit import Check
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import EMAIL_PATTERN, Message, no_store
from vendor_api.api.deps import (
    CurrentVendorUser,
    Emails,
    Limits,
    Sessions,
    require_vendor_role,
)
from vendor_api.core.settings import Settings
from vendor_api.db.models import VendorUser, VendorUserRole
from vendor_api.db.session import get_session
from vendor_api.services.team import TeamService

router = APIRouter(prefix="/vendor/users", tags=["team"])

Db = Annotated[AsyncSession, Depends(get_session)]
# Everything here is for the owner: a staff member gets 403.
Owner = Annotated[CurrentVendorUser, Depends(require_vendor_role(VendorUserRole.OWNER))]

INVITE_ACCEPTED = "If this address can be invited, we have sent an invitation."


def get_team_service(request: Request) -> TeamService:
    return cast(TeamService, request.app.state.team)


Team = Annotated[TeamService, Depends(get_team_service)]


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    status: str
    last_login_at: datetime | None
    created_at: datetime


class InviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320, pattern=EMAIL_PATTERN)

    @field_validator("email", mode="before")
    @classmethod
    def _trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def _ascii(cls, value: str) -> str:
        if not value.isascii():
            raise ValueError("use an email address with plain letters and digits")
        return value


class UpdateUserRequest(BaseModel):
    """Only the fields that are sent change."""

    model_config = ConfigDict(extra="forbid")

    disabled: bool


def user_out(user: VendorUser) -> UserOut:
    """Profile fields only: never a password hash or a token."""
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        status=user.status,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


async def _limit_invites(request: Request, limits: Limits, owner: CurrentVendorUser) -> None:
    # Invites send email, so they are limited per vendor (and fail closed when Redis is down).
    await limits.check(
        "staff_invite",
        [Check("vendor", str(owner.vendor.id), _settings(request).rate_limit_staff_invite_vendor)],
    )


@router.post("", status_code=202)
async def invite_staff(
    body: InviteRequest,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    team: Team,
    emails: Emails,
    limits: Limits,
    owner: Owner,
) -> Message:
    """Invites a staff member by email: an `invited` user with no password and an emailed link.

    An address that is already used anywhere (any vendor) gets the same answer and no email, so
    the endpoint cannot be used to find out who is registered.
    """
    no_store(response)
    await _limit_invites(request, limits, owner)
    emails.queue(background, await team.invite_staff(db, owner.vendor, body.email))
    return Message(message=INVITE_ACCEPTED)


@router.get("")
async def list_users(response: Response, db: Db, team: Team, owner: Owner) -> list[UserOut]:
    no_store(response)
    return [user_out(user) for user in await team.list_users(db, owner.vendor.id)]


@router.patch("/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    response: Response,
    db: Db,
    team: Team,
    sessions: Sessions,
    owner: Owner,
) -> UserOut:
    """Disables or enables a staff user. Disabling ends their sessions at once. The owner cannot
    be disabled (so nobody can disable themselves), and another vendor's user is a 404."""
    no_store(response)
    user = await team.set_disabled(
        db, owner.vendor.id, owner.user.id, user_id, disabled=body.disabled
    )
    if body.disabled:
        await sessions.end_sessions_of_user(user.id)
    return user_out(user)


@router.post("/{user_id}/resend-invite", status_code=204)
async def resend_invite(
    user_id: uuid.UUID,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    team: Team,
    emails: Emails,
    limits: Limits,
    owner: Owner,
) -> Response:
    """A new invite for a user who has not set a password yet; it ends the older ones."""
    await _limit_invites(request, limits, owner)
    emails.queue(background, await team.resend_invite(db, owner.vendor, user_id))
    response = Response(status_code=204)
    no_store(response)
    return response
