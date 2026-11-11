"""Approving, rejecting and suspending vendor accounts (the admins' side).

A change of status is one transaction: the vendor's status and the reason, who changed it and
when; one audit event (`vendor_status_events`); and the end of every session the vendor's users
have. Then, after it committed, the vendor is told by email.

**The transitions** (anything else is `409 invalid_status_transition`):

| action | from | to | reason |
| --- | --- | --- | --- |
| approve | pending, rejected, suspended | approved | optional |
| reject | pending | rejected | required |
| suspend | approved | suspended | required |

A pending vendor is an application: it is approved or rejected. An approved vendor that must stop
is suspended (it can be reinstated, which is approving again), not rejected. A rejected vendor can
be approved on appeal. A vendor already in the target status is a `409` too, so a double click is
refused rather than writing a second audit event.

**Sessions.** A `rejected` or `suspended` vendor cannot sign in or refresh (the auth rules read
the status on every request), but its refresh tokens would live on and come back if it were
approved again. So rejecting and suspending end every session at once: before the commit (if Redis
is down, the change is rolled back instead of saved with every session alive) and again after it
(a login that read the old status a moment before the commit and finished after the first
revocation). Access tokens already issued stop working at once, because `current_vendor_user`
reads the vendor from the database on every request. Approving ends nothing.

**The reviewer** is an identity-api admin whose id comes from the verified token; the caller passes
it in. It is stored in `vendors.status_changed_by` and on the audit event.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import ActorType, Vendor, VendorStatus, VendorStatusEvent
from vendor_api.services.auth import AuthService
from vendor_api.services.email import EmailTemplate, OutgoingEmail

logger = logging.getLogger("vendor_api.vendor_accounts")

VENDOR_NOT_FOUND = ApiError(404, "vendor_not_found", "Vendor not found")
MAX_PAGE_SIZE = 100


class VendorAction(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"
    SUSPEND = "suspend"


@dataclass(frozen=True)
class Transition:
    sources: frozenset[VendorStatus]
    target: VendorStatus
    reason_required: bool
    ends_sessions: bool
    email: EmailTemplate
    # For the refusal: who this action is for.
    only_for: str


TRANSITIONS: dict[VendorAction, Transition] = {
    VendorAction.APPROVE: Transition(
        frozenset({VendorStatus.PENDING, VendorStatus.REJECTED, VendorStatus.SUSPENDED}),
        VendorStatus.APPROVED,
        reason_required=False,
        ends_sessions=False,
        email=EmailTemplate.VENDOR_APPROVED,
        only_for="a pending, rejected or suspended vendor",
    ),
    VendorAction.REJECT: Transition(
        frozenset({VendorStatus.PENDING}),
        VendorStatus.REJECTED,
        reason_required=True,
        ends_sessions=True,
        email=EmailTemplate.VENDOR_REJECTED,
        only_for="a pending vendor (suspend an approved one)",
    ),
    VendorAction.SUSPEND: Transition(
        frozenset({VendorStatus.APPROVED}),
        VendorStatus.SUSPENDED,
        reason_required=True,
        ends_sessions=True,
        email=EmailTemplate.VENDOR_SUSPENDED,
        only_for="an approved vendor (reject a pending one)",
    ),
}


@dataclass(frozen=True)
class VendorChange:
    vendor: Vendor
    previous: str
    # To send after the commit: nothing is mailed for a change that was rolled back.
    email: OutgoingEmail


@dataclass(frozen=True)
class VendorPage:
    items: list[Vendor]
    total: int
    limit: int
    offset: int


@dataclass(frozen=True)
class VendorDetail:
    vendor: Vendor
    # The status history, oldest first.
    events: list[VendorStatusEvent]


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class VendorAccountService:
    """Lists vendors and changes their status. Commits its own changes."""

    def __init__(
        self, sessions: AuthService, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._sessions = sessions
        self._clock = clock

    # --- Reading ---------------------------------------------------------------------------

    async def list_vendors(
        self,
        db: AsyncSession,
        *,
        status: VendorStatus | None,
        search: str | None,
        limit: int,
        offset: int,
    ) -> VendorPage:
        """Pending vendors come oldest first (the application that has waited longest is on top);
        any other status, or all, newest first."""
        conditions: list[Any] = []
        if status is not None:
            conditions.append(Vendor.status == status)
        if search:
            pattern = _like(search.lower())
            conditions.append(
                or_(
                    func.lower(Vendor.name).like(pattern, escape="\\"),
                    func.lower(Vendor.slug).like(pattern, escape="\\"),
                    func.lower(Vendor.email).like(pattern, escape="\\"),
                )
            )
        order = (
            (Vendor.created_at.asc(), Vendor.id)
            if status == VendorStatus.PENDING
            else (
                Vendor.created_at.desc(),
                Vendor.id,
            )
        )
        total = await db.scalar(select(func.count()).select_from(Vendor).where(*conditions))
        rows = await db.scalars(
            select(Vendor)
            .where(*conditions)
            .order_by(*order)
            .limit(limit)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
        return VendorPage(list(rows), total or 0, limit, offset)

    async def get_vendor(self, db: AsyncSession, vendor_id: uuid.UUID) -> VendorDetail:
        vendor = await db.scalar(
            select(Vendor).where(Vendor.id == vendor_id).execution_options(populate_existing=True)
        )
        if vendor is None:
            raise VENDOR_NOT_FOUND
        events = await db.scalars(
            select(VendorStatusEvent)
            .where(VendorStatusEvent.vendor_id == vendor_id)
            .order_by(VendorStatusEvent.id)
            .execution_options(populate_existing=True)
        )
        return VendorDetail(vendor, list(events))

    # --- Changing the status ---------------------------------------------------------------

    async def change_status(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        admin_id: uuid.UUID,
        action: VendorAction,
        reason: str | None,
    ) -> VendorChange:
        rule = TRANSITIONS[action]
        reason = (reason or "").strip() or None
        if rule.reason_required and reason is None:
            raise ApiError(422, "reason_required", f"A reason is required to {action.value}")
        try:
            vendor = await db.scalar(
                select(Vendor)
                .where(Vendor.id == vendor_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if vendor is None:
                raise VENDOR_NOT_FOUND
            if vendor.status not in rule.sources:
                raise ApiError(
                    409,
                    "invalid_status_transition",
                    f"This vendor is {vendor.status}. You can {action.value} only {rule.only_for}",
                )
            previous = vendor.status
            now = self._clock()
            vendor.status = rule.target
            vendor.status_reason = reason
            vendor.status_changed_at = now
            vendor.status_changed_by = admin_id
            await db.flush()
            db.add(
                VendorStatusEvent(
                    vendor_id=vendor.id,
                    from_status=previous,
                    to_status=rule.target,
                    actor_type=ActorType.ADMIN,
                    actor_id=admin_id,
                    reason=reason,
                )
            )
            await db.flush()
            if rule.ends_sessions:
                # Before the commit: if Redis is down this raises and the change is rolled back.
                await self._sessions.end_sessions_of_vendor(db, vendor.id)
            context: dict[str, object] = {"vendor_name": vendor.name}
            if rule.reason_required:
                context["reason"] = reason
            email = OutgoingEmail(to=vendor.email, template=rule.email, context=context)
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        if rule.ends_sessions:
            try:
                # And after it, for a login that read the old status and finished in between.
                await self._sessions.end_sessions_of_vendor(db, vendor.id)
            except Exception:
                # The change is committed and refreshing is refused for the new status anyway.
                logger.warning("could not end the sessions of vendor %s again", vendor.id)
        return VendorChange(vendor, previous, email)
