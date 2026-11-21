"""A brand's commission for reviewers (#265): read it, approve or send back a proposal, or set
a rate. Part of the admin group: identity-api tokens with `vendor_reviewer` or `super_admin`; the
admin who acts is the token's `sub`, and bodies refuse unknown fields.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import ConfigDict, Field, StrictInt

from vendor_api.api.admin import AdminRequest, Reviewer, reviewer_dependency
from vendor_api.api.auth import no_store
from vendor_api.api.commission import CommissionOut, Commissions, Db, commission_out
from vendor_api.core.validation import MultilineText
from vendor_api.db.models import COMMISSION_MAX_BPS, COMMISSION_NOTE_MAX
from vendor_api.services.commission import approve, send_back, set_rate

router = APIRouter(
    prefix="/admin/vendors",
    tags=["admin-commission"],
    dependencies=[Depends(reviewer_dependency)],
)


class ApproveIn(AdminRequest):
    """The proposal the reviewer saw: approving a different one is a 409."""

    model_config = ConfigDict(json_schema_extra={"examples": [{"proposed_bps": 1000}]})

    proposed_bps: StrictInt = Field(ge=0, le=COMMISSION_MAX_BPS)


class SendBackIn(AdminRequest):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"note": "Our rate for kurtas is 12%. Propose again?"}]}
    )

    # 10 to 600 characters once trimmed (checked with a message for the reviewer).
    note: Annotated[MultilineText, Field(max_length=2000)]


class SetRateIn(AdminRequest):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"commission_bps": 1200, "note": "Agreed on the call."}]}
    )

    commission_bps: StrictInt = Field(ge=0, le=COMMISSION_MAX_BPS)
    note: Annotated[MultilineText | None, Field(max_length=COMMISSION_NOTE_MAX * 2)] = None


@router.get("/{vendor_id}/commission")
async def get_vendor_commission(
    vendor_id: uuid.UUID, response: Response, db: Db, commissions: Commissions
) -> CommissionOut:
    """A brand's commission. `404` for an unknown vendor."""
    no_store(response)
    return commission_out(await commissions.admin_view(db, vendor_id))


@router.post("/{vendor_id}/commission/approve")
async def approve_commission(
    vendor_id: uuid.UUID,
    body: ApproveIn,
    response: Response,
    db: Db,
    commissions: Commissions,
    admin: Reviewer,
) -> CommissionOut:
    """Agrees the brand's waiting proposal. `409 no_proposal` when none waits;
    `409 commission_changed` when it is not the `proposed_bps` sent."""
    no_store(response)
    seen = body.proposed_bps
    view = await commissions.decide(
        db, vendor_id, admin.id, "approved", lambda terms: approve(terms, seen)
    )
    return commission_out(view)


@router.post("/{vendor_id}/commission/send-back")
async def send_back_commission(
    vendor_id: uuid.UUID,
    body: SendBackIn,
    response: Response,
    db: Db,
    commissions: Commissions,
    admin: Reviewer,
) -> CommissionOut:
    """Sends the waiting proposal back with a note (10 to 600 characters) the brand sees. The
    agreed rate, if any, stays. `409 no_proposal` when none waits."""
    no_store(response)
    note = body.note
    view = await commissions.decide(
        db, vendor_id, admin.id, "sent_back", lambda terms: send_back(terms, note)
    )
    return commission_out(view)


@router.post("/{vendor_id}/commission/set")
async def set_commission(
    vendor_id: uuid.UUID,
    body: SetRateIn,
    response: Response,
    db: Db,
    commissions: Commissions,
    admin: Reviewer,
) -> CommissionOut:
    """Sets the agreed rate directly (for example agreed on a call), whatever was proposed; an
    optional note up to 600 characters. `409 vendor_not_eligible` for a rejected application."""
    no_store(response)
    rate, note = body.commission_bps, body.note
    view = await commissions.decide(
        db, vendor_id, admin.id, "set", lambda terms: set_rate(terms, rate, note)
    )
    return commission_out(view)
