"""The signed-in brand's commission (#265): read it (whole team), propose a rate (owner only).

Rates are whole basis points (1200 = 12%) from 0 to 4000. There is no default rate.
"""

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from shazlo_security.rate_limit import Check
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.common import no_store
from vendor_api.api.deps import (
    CurrentVendorUser,
    Limits,
    current_vendor_user,
    require_vendor_role,
)
from vendor_api.api.views import CommissionOut, Commissions, commission_out
from vendor_api.core.settings import Settings
from vendor_api.db.models import COMMISSION_MAX_BPS, VendorUserRole
from vendor_api.db.session import get_session

router = APIRouter(prefix="/vendor/commission", tags=["commission"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]
Owner = Annotated[CurrentVendorUser, Depends(require_vendor_role(VendorUserRole.OWNER))]


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
