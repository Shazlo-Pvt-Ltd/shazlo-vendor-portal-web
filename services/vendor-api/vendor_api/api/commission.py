"""The signed-in brand's commission (#265): read it (whole team), propose a rate (owner only).

Rates are whole basis points (1200 = 12%) from 0 to 4000. There is no default rate.
"""

from datetime import datetime
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from shazlo_security.rate_limit import Check
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import (
    CurrentVendorUser,
    Limits,
    current_vendor_user,
    require_vendor_role,
)
from vendor_api.core.settings import Settings
from vendor_api.db.models import COMMISSION_MAX_BPS, VendorUserRole
from vendor_api.db.session import get_session
from vendor_api.services.commission import CommissionService, CommissionView

router = APIRouter(prefix="/vendor/commission", tags=["commission"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]
Owner = Annotated[CurrentVendorUser, Depends(require_vendor_role(VendorUserRole.OWNER))]


def get_commissions(request: Request) -> CommissionService:
    return cast(CommissionService, request.app.state.commissions)


Commissions = Annotated[CommissionService, Depends(get_commissions)]


class CommissionOut(BaseModel):
    # not_set (no rate yet), proposed (the brand's rate waits for Shazlo), sent_back (Shazlo sent
    # it back with `note`), agreed (`agreed_bps` is in force).
    state: str
    # The rate in force, in basis points; it stays while a new proposal waits.
    agreed_bps: int | None
    # The brand's latest proposal while proposed or sent back; null otherwise.
    proposed_bps: int | None
    # Shazlo's note: why a proposal was sent back, or what an agreed rate covers.
    note: str | None
    updated_at: datetime | None


def commission_out(view: CommissionView) -> CommissionOut:
    return CommissionOut(
        state=view.state,
        agreed_bps=view.agreed_bps,
        proposed_bps=view.proposed_bps,
        note=view.note,
        updated_at=view.updated_at,
    )


class ProposalIn(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{"rate_bps": 1000}]})

    rate_bps: StrictInt = Field(ge=0, le=COMMISSION_MAX_BPS)


@router.get("")
async def get_commission(
    response: Response, db: Db, commissions: Commissions, current: Current
) -> CommissionOut:
    """The brand's commission: what is agreed, what it proposed, and Shazlo's note."""
    no_store(response)
    return commission_out(await commissions.get(db, current.vendor.id))


@router.post("/proposal")
async def propose_commission(
    body: ProposalIn,
    request: Request,
    response: Response,
    db: Db,
    commissions: Commissions,
    limits: Limits,
    current: Owner,
) -> CommissionOut:
    """Owner only. Proposes a rate for Shazlo to approve; an agreed rate stays in force until
    then. `422` for the rate already agreed. Limited per vendor."""
    no_store(response)
    settings = cast(Settings, request.app.state.settings)
    await limits.check(
        "commission_proposal",
        [Check("vendor", str(current.vendor.id), settings.rate_limit_commission_proposal_vendor)],
    )
    view = await commissions.propose(db, current.vendor.id, current.user.id, body.rate_bps)
    return commission_out(view)
