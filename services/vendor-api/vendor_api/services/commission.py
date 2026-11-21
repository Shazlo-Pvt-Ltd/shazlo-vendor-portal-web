"""Per-brand commission (#265, spec section 6). There is no default rate anywhere.

    not_set --propose--> proposed --approve--> agreed
                         proposed --send back (note)--> sent_back --propose--> proposed
    any state --set (admin)--> agreed
    agreed --propose--> proposed   (the agreed rate stays in force until the new one is approved)

The rules are pure functions on `Terms`, so they are tested without a database;
`CommissionService` locks the vendor's row, applies one, stores it and audits the change in
`vendor_change_events` in the same transaction. Approving names the proposal the reviewer saw,
so a brand that changes its proposal meanwhile gets it reviewed again (`409 commission_changed`)
instead of approved unseen. The admin is always the token's subject.

Commission is not published to the central app: ADR 0003 has no event for it yet.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError, FieldProblems
from vendor_api.db.models import (
    COMMISSION_MAX_BPS,
    COMMISSION_NOTE_MAX,
    ActorType,
    ChangeSubject,
    Commission,
    CommissionState,
    Vendor,
    VendorChangeEvent,
    VendorStatus,
)

NOTE_MIN = 10


@dataclass(frozen=True)
class Terms:
    state: str
    agreed_bps: int | None
    proposed_bps: int | None
    note: str | None


NOT_SET = Terms(CommissionState.NOT_SET, None, None, None)
# One step of the state machine, with its arguments bound.
Step = Callable[[Terms], Terms]


class CommissionRuleError(Exception):
    """A rule the request broke: `status` 422 for a bad value (on `field`), 409 for a state that
    does not allow the step."""

    def __init__(self, status: int, code: str, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.field = status, code, message, field


def _check_rate(rate: int, field: str) -> None:
    # bool is an int in Python; the request models refuse it, this keeps the rule honest too.
    if isinstance(rate, bool) or not 0 <= rate <= COMMISSION_MAX_BPS:
        raise CommissionRuleError(
            422, "rate_range", "Enter a commission between 0% and 40%.", field
        )


def _clean_note(note: str | None, *, required: bool) -> str | None:
    text = (note or "").strip()
    if required and len(text) < NOTE_MIN:
        raise CommissionRuleError(
            422,
            "note_length",
            f"Write at least {NOTE_MIN} characters so the brand knows what to propose.",
            "note",
        )
    if len(text) > COMMISSION_NOTE_MAX:
        raise CommissionRuleError(
            422, "note_length", f"Keep the note to {COMMISSION_NOTE_MAX} characters.", "note"
        )
    return text or None


def propose(terms: Terms, rate_bps: int) -> Terms:
    _check_rate(rate_bps, "rate_bps")
    if terms.agreed_bps is not None and rate_bps == terms.agreed_bps:
        raise CommissionRuleError(
            422, "same_as_agreed", "That is already your agreed rate.", "rate_bps"
        )
    return Terms(CommissionState.PROPOSED, terms.agreed_bps, rate_bps, None)


def _waiting(terms: Terms) -> int:
    if terms.state != CommissionState.PROPOSED or terms.proposed_bps is None:
        raise CommissionRuleError(409, "no_proposal", "There is no proposed rate waiting.")
    return terms.proposed_bps


def approve(terms: Terms, seen_proposed_bps: int) -> Terms:
    proposed = _waiting(terms)
    if proposed != seen_proposed_bps:
        raise CommissionRuleError(
            409,
            "commission_changed",
            "The brand changed its proposal since you looked. Review it again.",
        )
    return Terms(CommissionState.AGREED, proposed, None, None)


def send_back(terms: Terms, note: str) -> Terms:
    _waiting(terms)
    return replace(terms, state=CommissionState.SENT_BACK, note=_clean_note(note, required=True))


def set_rate(terms: Terms, rate_bps: int, note: str | None) -> Terms:
    _check_rate(rate_bps, "commission_bps")
    return Terms(CommissionState.AGREED, rate_bps, None, _clean_note(note, required=False))


# --- storing ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class CommissionView:
    state: str
    agreed_bps: int | None
    proposed_bps: int | None
    note: str | None
    updated_at: datetime | None


def view_of(row: Commission | None) -> CommissionView:
    if row is None:
        return CommissionView(CommissionState.NOT_SET, None, None, None, None)
    return CommissionView(row.state, row.agreed_bps, row.proposed_bps, row.note, row.updated_at)


def _terms(row: Commission) -> Terms:
    return Terms(row.state, row.agreed_bps, row.proposed_bps, row.note)


def _summary(terms: Terms) -> dict[str, object]:
    return {
        "state": terms.state,
        "agreed_bps": terms.agreed_bps,
        "proposed_bps": terms.proposed_bps,
    }


VENDOR_NOT_FOUND = ApiError(404, "vendor_not_found", "Vendor not found")
VENDOR_NOT_ELIGIBLE = ApiError(
    409, "vendor_not_eligible", "This application was rejected: there is no rate to agree."
)


def as_http(error: CommissionRuleError) -> Exception:
    if error.status == 422 and error.field:
        return FieldProblems({error.field: error.message}, kind=error.code)
    return ApiError(error.status, error.code, error.message)


class CommissionService:
    async def get(self, db: AsyncSession, vendor_id: uuid.UUID) -> CommissionView:
        row = await db.scalar(
            select(Commission)
            .where(Commission.vendor_id == vendor_id)
            .execution_options(populate_existing=True)
        )
        return view_of(row)

    async def views(
        self, db: AsyncSession, vendor_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, CommissionView]:
        rows = await db.scalars(select(Commission).where(Commission.vendor_id.in_(vendor_ids)))
        found = {row.vendor_id: view_of(row) for row in rows}
        return {vendor_id: found.get(vendor_id, view_of(None)) for vendor_id in vendor_ids}

    async def _locked(self, db: AsyncSession, vendor_id: uuid.UUID) -> Commission:
        await db.execute(
            insert(Commission)
            .values(vendor_id=vendor_id, state=CommissionState.NOT_SET)
            .on_conflict_do_nothing()
        )
        row = await db.scalar(
            select(Commission)
            .where(Commission.vendor_id == vendor_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:  # inserted above if it was missing
            raise RuntimeError("commission row vanished")
        return row

    async def _change(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        action: str,
        actor_type: ActorType,
        actor_id: uuid.UUID,
        step: Step,
    ) -> CommissionView:
        row = await self._locked(db, vendor_id)
        before = _terms(row)
        try:
            after = step(before)
        except CommissionRuleError as error:
            raise as_http(error) from None
        row.state, row.agreed_bps = after.state, after.agreed_bps
        row.proposed_bps, row.note = after.proposed_bps, after.note
        db.add(
            VendorChangeEvent(
                vendor_id=vendor_id,
                subject=ChangeSubject.COMMISSION,
                action=action,
                actor_type=actor_type,
                actor_id=actor_id,
                detail={"from": _summary(before), "to": _summary(after), "note": after.note},
            )
        )
        await db.commit()
        return await self.get(db, vendor_id)

    async def propose(
        self, db: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID, rate_bps: int
    ) -> CommissionView:
        return await self._change(
            db,
            vendor_id,
            "proposed",
            ActorType.VENDOR,
            user_id,
            lambda terms: propose(terms, rate_bps),
        )

    async def _eligible_vendor(self, db: AsyncSession, vendor_id: uuid.UUID) -> None:
        status = await db.scalar(select(Vendor.status).where(Vendor.id == vendor_id))
        if status is None:
            raise VENDOR_NOT_FOUND
        if status == VendorStatus.REJECTED:
            raise VENDOR_NOT_ELIGIBLE

    async def decide(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        admin_id: uuid.UUID,
        action: str,
        step: Step,
    ) -> CommissionView:
        await self._eligible_vendor(db, vendor_id)
        return await self._change(db, vendor_id, action, ActorType.ADMIN, admin_id, step)

    async def admin_view(self, db: AsyncSession, vendor_id: uuid.UUID) -> CommissionView:
        if not await db.scalar(select(exists().where(Vendor.id == vendor_id))):
            raise VENDOR_NOT_FOUND
        return await self.get(db, vendor_id)


def state_condition(state: CommissionState) -> object:
    """A WHERE clause on `vendors` for "its commission is in `state`" (no row is `not_set`)."""
    if state == CommissionState.NOT_SET:
        return ~exists().where(
            Commission.vendor_id == Vendor.id, Commission.state != CommissionState.NOT_SET
        )
    return exists().where(Commission.vendor_id == Vendor.id, Commission.state == state)
