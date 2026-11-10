"""Vendor accounts for admins: find them, and approve, reject or suspend them.

Part of the admin group (`/v1/admin/*`, identity-api tokens only, role `vendor_reviewer` or
`super_admin`, enforced once by the router-level dependency). The admin who acts is always the
token's `sub`, never anything in the request. See `services/vendor_accounts.py` for the
transitions.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.admin import AdminRequest, Reviewer, reviewer_dependency
from vendor_api.api.auth import no_store
from vendor_api.api.deps import Emails
from vendor_api.db.models import Vendor, VendorStatus, VendorStatusEvent
from vendor_api.db.session import get_session
from vendor_api.services.vendor_accounts import (
    MAX_PAGE_SIZE,
    VendorAccountService,
    VendorAction,
    VendorDetail,
)

router = APIRouter(
    prefix="/admin/vendors", tags=["admin-vendors"], dependencies=[Depends(reviewer_dependency)]
)

Db = Annotated[AsyncSession, Depends(get_session)]


def get_vendor_accounts(request: Request) -> VendorAccountService:
    return cast(VendorAccountService, request.app.state.vendor_accounts)


Accounts = Annotated[VendorAccountService, Depends(get_vendor_accounts)]


def _trim(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class ReasonRequest(AdminRequest):
    """Rejecting and suspending need a reason, which the vendor is told: a missing, empty or
    whitespace-only one is a 422."""

    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason", mode="before")
    @classmethod
    def _trim_reason(cls, value: object) -> object:
        return _trim(value)


class ApproveRequest(AdminRequest):
    """A reason is optional when approving (for example why a rejection was overturned)."""

    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("reason", mode="before")
    @classmethod
    def _trim_reason(cls, value: object) -> object:
        value = _trim(value)
        return value or None


class VendorOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    email: str
    phone: str
    contact_name: str
    product_type: str
    website_or_instagram: str | None
    price_min_paise: int
    price_max_paise: int
    status: str
    # Why the vendor is in this status (rejection and suspension; optional on approval).
    status_reason: str | None
    status_changed_at: datetime | None
    # The admin who last changed the status (an identity-api id).
    status_changed_by: uuid.UUID | None
    created_at: datetime


class VendorPageOut(BaseModel):
    items: list[VendorOut]
    total: int
    limit: int
    offset: int


class StatusEventOut(BaseModel):
    from_status: str | None
    to_status: str
    actor_type: str
    actor_id: uuid.UUID | None
    reason: str | None
    created_at: datetime


class VendorDetailOut(VendorOut):
    # The status history, oldest first. The first event is the vendor signing up.
    events: list[StatusEventOut]


def vendor_out(vendor: Vendor) -> VendorOut:
    return VendorOut(
        id=vendor.id,
        name=vendor.name,
        slug=vendor.slug,
        email=vendor.email,
        phone=vendor.phone,
        contact_name=vendor.contact_name,
        product_type=vendor.product_type,
        website_or_instagram=vendor.website_or_instagram,
        price_min_paise=vendor.price_min_paise,
        price_max_paise=vendor.price_max_paise,
        status=vendor.status,
        status_reason=vendor.status_reason,
        status_changed_at=vendor.status_changed_at,
        status_changed_by=vendor.status_changed_by,
        created_at=vendor.created_at,
    )


def _event(event: VendorStatusEvent) -> StatusEventOut:
    return StatusEventOut(
        from_status=event.from_status,
        to_status=event.to_status,
        actor_type=event.actor_type,
        actor_id=event.actor_id,
        reason=event.reason,
        created_at=event.created_at,
    )


def detail_out(detail: VendorDetail) -> VendorDetailOut:
    return VendorDetailOut(
        **vendor_out(detail.vendor).model_dump(), events=[_event(e) for e in detail.events]
    )


@router.get("")
async def list_vendors(
    response: Response,
    db: Db,
    accounts: Accounts,
    status: Annotated[
        Literal["pending", "approved", "rejected", "suspended", "all"],
        Query(description="`pending` (default), `approved`, `rejected`, `suspended` or `all`"),
    ] = "pending",
    q: Annotated[
        str | None, Query(max_length=100, description="Part of the name, slug or email")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> VendorPageOut:
    """Vendors, paged. Pending applications come oldest first, so the one that has waited
    longest is on top; other statuses come newest first."""
    no_store(response)
    page = await accounts.list_vendors(
        db,
        status=None if status == "all" else VendorStatus(status),
        search=q.strip() if q else None,
        limit=limit,
        offset=offset,
    )
    return VendorPageOut(
        items=[vendor_out(v) for v in page.items],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{vendor_id}")
async def get_vendor(
    vendor_id: uuid.UUID, response: Response, db: Db, accounts: Accounts
) -> VendorDetailOut:
    """One vendor with its status history."""
    no_store(response)
    return detail_out(await accounts.get_vendor(db, vendor_id))


async def _change(
    action: VendorAction,
    vendor_id: uuid.UUID,
    reason: str | None,
    response: Response,
    background: BackgroundTasks,
    db: AsyncSession,
    accounts: VendorAccountService,
    emails: Emails,
    admin: Reviewer,
) -> VendorDetailOut:
    no_store(response)
    change = await accounts.change_status(db, vendor_id, admin.id, action, reason)
    emails.queue(background, change.email)  # after the commit: nothing is sent for a rollback
    return detail_out(await accounts.get_vendor(db, vendor_id))


@router.post("/{vendor_id}/approve")
async def approve_vendor(
    vendor_id: uuid.UUID,
    body: ApproveRequest,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    accounts: Accounts,
    emails: Emails,
    admin: Reviewer,
) -> VendorDetailOut:
    """Approves a pending, rejected or suspended vendor, and tells it by email. `409
    invalid_status_transition` for one that is already approved."""
    return await _change(
        VendorAction.APPROVE,
        vendor_id,
        body.reason,
        response,
        background,
        db,
        accounts,
        emails,
        admin,
    )


@router.post("/{vendor_id}/reject")
async def reject_vendor(
    vendor_id: uuid.UUID,
    body: ReasonRequest,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    accounts: Accounts,
    emails: Emails,
    admin: Reviewer,
) -> VendorDetailOut:
    """Rejects a **pending** vendor (a reason is required, and the vendor is told it). Ends every
    session of the vendor at once. `409 invalid_status_transition` otherwise: an approved vendor
    is suspended, not rejected."""
    return await _change(
        VendorAction.REJECT,
        vendor_id,
        body.reason,
        response,
        background,
        db,
        accounts,
        emails,
        admin,
    )


@router.post("/{vendor_id}/suspend")
async def suspend_vendor(
    vendor_id: uuid.UUID,
    body: ReasonRequest,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    accounts: Accounts,
    emails: Emails,
    admin: Reviewer,
) -> VendorDetailOut:
    """Suspends an **approved** vendor (a reason is required, and the vendor is told it). Ends
    every session of the vendor at once: it cannot sign in or refresh, and its access tokens stop
    working immediately. Approving it again reinstates it. `409 invalid_status_transition`
    otherwise."""
    return await _change(
        VendorAction.SUSPEND,
        vendor_id,
        body.reason,
        response,
        background,
        db,
        accounts,
        emails,
        admin,
    )
