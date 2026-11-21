"""Store details for the signed-in vendor (#265): read them all, save one section at a time.

Vendor tokens only. Everyone on the team reads them and saves the everyday sections; only the
owner changes where the money goes (`payout`) and the business details (`business`). Payout
numbers never come back: only the bank's name, the last four digits and a masked UPI ID.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import FORBIDDEN, CurrentVendorUser, current_vendor_user
from vendor_api.db.models import Vendor, VendorUserRole
from vendor_api.db.session import get_session
from vendor_api.services.store_details import (
    OWNER_ONLY_SECTIONS,
    BrandIn,
    BusinessIn,
    ContactIn,
    DeliveryIn,
    PaymentIn,
    PayoutIn,
    ReturnsIn,
    Section,
    SectionBody,
    StoreDetailsService,
    StoreDetailsView,
)

router = APIRouter(prefix="/vendor/store-details", tags=["store-details"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]


def get_store_details(request: Request) -> StoreDetailsService:
    return cast(StoreDetailsService, request.app.state.store_details)


Service = Annotated[StoreDetailsService, Depends(get_store_details)]


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


@router.get("")
async def get_store_details_route(
    response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """Every topic, what is still missing, and whether they are complete. A vendor that has
    saved nothing gets nulls and every required topic in `missing`."""
    no_store(response)
    return store_details_out(await service.get(db, current.vendor))


async def _save(
    section: Section,
    body: SectionBody,
    response: Response,
    db: AsyncSession,
    service: StoreDetailsService,
    current: CurrentVendorUser,
) -> StoreDetailsOut:
    no_store(response)
    if section in OWNER_ONLY_SECTIONS and current.role != VendorUserRole.OWNER:
        raise FORBIDDEN
    view = await service.save(db, current.vendor, current.user.id, section, body)
    return store_details_out(view)


@router.put("/brand")
async def save_brand(
    body: BrandIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """What the brand sells (women, men or both), where it ships from, and an optional
    Instagram handle or website (empty or null clears it)."""
    return await _save("brand", body, response, db, service, current)


@router.put("/contact")
async def save_contact(
    body: ContactIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """Who Shazlo talks to. The phone is stored as ten digits; the email in lower case."""
    return await _save("contact", body, response, db, service, current)


@router.put("/delivery")
async def save_delivery(
    body: DeliveryIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """`shazlo` (Shazlo picks up from `pickup_address`) or `own` (the brand delivers to all of
    India or to up to 50 cities or PIN codes, in `delivery_days`: 1_2, 2_3, 3_5 or 5_7)."""
    return await _save("delivery", body, response, db, service, current)


@router.put("/returns")
async def save_returns(
    body: ReturnsIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """`window_days` 0 (no returns), 7, 14 or 30. With a window, `condition`
    (unworn_with_tags, any_reason, damaged_or_wrong) and `refund_days` (2, 5 or 7) are required;
    with 0 they are stored as null whatever is sent."""
    return await _save("returns", body, response, db, service, current)


@router.put("/payment")
async def save_payment(
    body: PaymentIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """How shoppers can pay on delivery: cash and/or UPI, at least one."""
    return await _save("payment", body, response, db, service, current)


@router.put("/payout")
async def save_payout(
    body: PayoutIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """Owner only. Where Shazlo pays the brand: a bank account (`holder_name`,
    `account_number` of 9 to 18 digits, `ifsc`) or a UPI ID. The number is sealed and never
    returned; the answer shows the bank (from the IFSC, null for an unlisted bank) and the last
    four digits, or the masked UPI ID. Every change is audited."""
    return await _save("payout", body, response, db, service, current)


@router.put("/business")
async def save_business(
    body: BusinessIn, response: Response, db: Db, service: Service, current: Current
) -> StoreDetailsOut:
    """Owner only. Optional legal name and GST number (checked, check character included);
    empty values are stored as null."""
    return await _save("business", body, response, db, service, current)


async def store_details_of_vendor(
    db: AsyncSession, service: StoreDetailsService, vendor_id: uuid.UUID
) -> StoreDetailsOut | None:
    """For the admin view: None when there is no such vendor."""
    vendor = await db.get(Vendor, vendor_id)
    if vendor is None:
        return None
    return store_details_out(await service.get(db, vendor))
