"""Response models the seller app and the admin app both return (ADR 0011).

A brand reads its own commission and store details through `/v1/vendor/*`; a reviewer reads any
brand's through `/v1/admin/*`. The models live here so neither group of routers imports the
other, and the class names stay the OpenAPI component names in both documents.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, cast

from fastapi import Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import Vendor
from vendor_api.services.commission import CommissionService, CommissionView
from vendor_api.services.store_details import StoreDetailsView, read_store_details


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


class StoreDetailsOut(BaseModel):
    brand_name: str
    sells: Literal["women", "men", "both"] | None
    city: str | None
    instagram_or_website: str | None
    contact: dict[str, str] | None
    # {"mode": "shazlo", "pickup_address": {...}} or {"mode": "own", "areas": {...},
    # "delivery_days": "2_3"}
    delivery: dict[str, Any] | None
    # {"window_days": 14, "condition": "unworn_with_tags", "refund_days": 5}; with window 0 the
    # other two are null.
    returns: dict[str, Any] | None
    pay_on_delivery: dict[str, bool] | None
    # Masked: {"method": "bank", "holder_name", "bank_name" (null for an unlisted bank),
    # "account_last4", "ifsc"} or {"method": "upi", "upi_id": "ka•••@okhdfcbank"}.
    payout: dict[str, Any] | None
    business: dict[str, str | None]
    # Required topics not saved yet, in page order: brand, contact, delivery, returns,
    # pay_on_delivery, payout.
    missing: list[str]
    complete: bool
    updated_at: datetime | None


def store_details_out(view: StoreDetailsView) -> StoreDetailsOut:
    return StoreDetailsOut(
        brand_name=view.brand_name,
        sells=cast(Literal["women", "men", "both"] | None, view.sells),
        city=view.city,
        instagram_or_website=view.instagram_or_website,
        contact=view.contact,
        delivery=view.delivery,
        returns=view.returns,
        pay_on_delivery=view.pay_on_delivery,
        payout=view.payout,
        business=view.business,
        missing=view.missing,
        complete=view.complete,
        updated_at=view.updated_at,
    )


async def store_details_of_vendor(db: AsyncSession, vendor_id: uuid.UUID) -> StoreDetailsOut | None:
    """For the admin view: None when there is no such vendor. Reading needs no payout key: the
    payout numbers are stored masked beside the sealed ones."""
    vendor = await db.get(Vendor, vendor_id)
    if vendor is None:
        return None
    return store_details_out(await read_store_details(db, vendor))
