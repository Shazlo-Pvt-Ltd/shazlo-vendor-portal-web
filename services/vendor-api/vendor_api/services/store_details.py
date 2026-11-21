"""Store details: the sign-up topics a brand keeps up to date (#265, spec section 5).

Each section is saved on its own (`PUT /v1/vendor/store-details/{section}`). The request models
here only fix the shape (types, unknown fields refused, generous length caps); the rules a seller
can break are checked by `check_*` and come back as `FieldProblems` with a message per field, so
the portal can show each one next to its input. Saved values are normalised (ten-digit phone,
upper-case IFSC, PIN without spaces...).

Payout numbers are sealed (`PayoutCipher`) before they are stored; the views only ever carry the
masked parts. Every save is audited in `vendor_change_events`; the payout's audit row holds only
the masked parts.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import FieldProblems
from vendor_api.core.validation import VisibleText
from vendor_api.db.models import (
    ActorType,
    ChangeSubject,
    StoreDetails,
    Vendor,
    VendorChangeEvent,
)
from vendor_api.services import indian_formats as fmt
from vendor_api.services.ifsc_directory import lookup_ifsc
from vendor_api.services.payout_cipher import PayoutCipher

Section = Literal["brand", "contact", "delivery", "returns", "payment", "payout", "business"]
# Required topics in page order. `pay_on_delivery` is saved by the `payment` section; business
# details are optional and never missing.
TOPICS = ("brand", "contact", "delivery", "returns", "pay_on_delivery", "payout")
OWNER_ONLY_SECTIONS = frozenset({"payout", "business"})

CITY_MAX = 80
NAME_MAX = 200
ADDRESS_LINE_MAX = 200
PLACE_MAX = 80
MAX_DELIVERY_PLACES = 50
LEGAL_NAME_MAX = 120
DELIVERY_DAYS = ("1_2", "2_3", "3_5", "5_7")
RETURN_WINDOWS = (0, 7, 14, 30)
RETURN_CONDITIONS = ("unworn_with_tags", "any_reason", "damaged_or_wrong")
REFUND_DAYS = (2, 5, 7)

# Caps on what is even read: well above any real value, so a long one gets the friendly message
# below, and a huge one is refused before any work is done.
# Hidden and control characters are refused in every field (`VisibleText`).
Short = Annotated[VisibleText, Field(max_length=400)]
Code = Annotated[VisibleText, Field(max_length=64)]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrandIn(_Body):
    sells: Literal["women", "men", "both"]
    city: Short
    instagram_or_website: Short | None = None


class ContactIn(_Body):
    name: Short
    phone: Code
    email: Short


class PickupAddressIn(_Body):
    line1: Short
    area: Short
    city: Short
    pin: Code


class AreasIn(_Body):
    all_india: StrictBool
    places: list[Annotated[VisibleText, Field(max_length=200)]] = Field(
        default_factory=list, max_length=200
    )


class DeliveryIn(_Body):
    mode: Literal["shazlo", "own"]
    pickup_address: PickupAddressIn | None = None
    areas: AreasIn | None = None
    delivery_days: Code | None = None


class ReturnsIn(_Body):
    window_days: StrictInt
    condition: Code | None = None
    refund_days: StrictInt | None = None


class PaymentIn(_Body):
    cash: StrictBool
    upi: StrictBool


class PayoutIn(_Body):
    method: Literal["bank", "upi"]
    holder_name: Short | None = None
    account_number: Code | None = None
    ifsc: Code | None = None
    upi_id: Short | None = None


class BusinessIn(_Body):
    legal_name: Short | None = None
    gstin: Code | None = None


SectionBody = BrandIn | ContactIn | DeliveryIn | ReturnsIn | PaymentIn | PayoutIn | BusinessIn


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


# --- the rules, one function per section ---------------------------------------------------


def check_brand(body: BrandIn) -> dict[str, str]:
    out: dict[str, str] = {}
    city = body.city.strip()
    if len(city) < 2:
        out["city"] = "Enter the city or area you ship from."
    elif len(city) > CITY_MAX:
        out["city"] = f"Keep the city to {CITY_MAX} characters."
    link = (body.instagram_or_website or "").strip()
    if link and not fmt.is_valid_link(link):
        out["instagram_or_website"] = "Enter an Instagram handle like @yourbrand or a website."
    return out


def check_contact(body: ContactIn) -> dict[str, str]:
    out: dict[str, str] = {}
    if _blank(body.name):
        out["name"] = "Enter your name."
    elif len(body.name.strip()) > NAME_MAX:
        out["name"] = f"Keep the name to {NAME_MAX} characters."
    if _blank(body.phone):
        out["phone"] = "Enter a mobile number."
    elif fmt.normalise_phone(body.phone) is None:
        out["phone"] = "Enter a 10-digit Indian mobile number."
    if _blank(body.email):
        out["email"] = "Enter an email address."
    elif not fmt.is_valid_email(body.email):
        out["email"] = "Enter an email address like name@example.com."
    return out


_PIN_LIKE = re.compile(r"[0-9][0-9\s]*")


def _is_pin_like(place: str) -> bool:
    """A place written only in digits (and spaces) is meant as a PIN code."""
    return _PIN_LIKE.fullmatch(place) is not None


def check_delivery(body: DeliveryIn) -> dict[str, str]:
    out: dict[str, str] = {}
    if body.mode == "shazlo":
        address = body.pickup_address
        if address is None:
            return {"pickup_address": "Enter the pickup address."}
        for key, label in (("line1", "the address"), ("area", "the area"), ("city", "the city")):
            value = getattr(address, key).strip()
            if not value:
                out[f"pickup_address.{key}"] = f"Enter {label}."
            elif len(value) > ADDRESS_LINE_MAX:
                out[f"pickup_address.{key}"] = f"Keep it to {ADDRESS_LINE_MAX} characters."
        if _blank(address.pin):
            out["pickup_address.pin"] = "Enter the PIN code."
        elif not fmt.is_valid_pin(address.pin):
            out["pickup_address.pin"] = "Enter a 6-digit PIN code."
        return out
    areas = body.areas
    if areas is None:
        out["areas"] = "Choose where you deliver."
    elif not areas.all_india:
        places = [p.strip() for p in areas.places if p.strip()]
        if not places:
            out["areas"] = "Add the cities or PIN codes you deliver to, or choose All of India."
        elif len(places) > MAX_DELIVERY_PLACES:
            out["areas.places"] = f"Add at most {MAX_DELIVERY_PLACES} places."
        elif any(len(p) > PLACE_MAX for p in places):
            out["areas.places"] = f"Keep each place to {PLACE_MAX} characters."
        elif any(_is_pin_like(p) and not fmt.is_valid_pin(p) for p in places):
            out["areas.places"] = "A PIN code has 6 digits and does not start with 0."
    if body.delivery_days not in DELIVERY_DAYS:
        out["delivery_days"] = "Choose how long delivery takes."
    return out


def check_returns(body: ReturnsIn) -> dict[str, str]:
    if body.window_days not in RETURN_WINDOWS:
        return {"window_days": "Choose a return window."}
    out: dict[str, str] = {}
    if body.window_days != 0:
        if body.condition not in RETURN_CONDITIONS:
            out["condition"] = "Choose which returns you accept."
        if body.refund_days not in REFUND_DAYS:
            out["refund_days"] = "Choose how soon you refund."
    return out


def check_payment(body: PaymentIn) -> dict[str, str]:
    if body.cash or body.upi:
        return {}
    return {"pay_on_delivery": "Choose at least one way to pay on delivery."}


def check_payout(body: PayoutIn) -> dict[str, str]:
    out: dict[str, str] = {}
    if body.method == "bank":
        if _blank(body.holder_name):
            out["holder_name"] = "Enter the account holder's name."
        elif len((body.holder_name or "").strip()) > NAME_MAX:
            out["holder_name"] = f"Keep the name to {NAME_MAX} characters."
        if _blank(body.account_number):
            out["account_number"] = "Enter the account number."
        elif not fmt.is_valid_account_number(body.account_number or ""):
            out["account_number"] = "An account number has 9 to 18 digits."
        if _blank(body.ifsc):
            out["ifsc"] = "Enter the IFSC."
        elif not fmt.is_valid_ifsc(body.ifsc or ""):
            out["ifsc"] = "Enter an IFSC like HDFC0001234."
        if body.upi_id is not None:
            out["upi_id"] = "Send a UPI ID only with the UPI method."
    else:
        if _blank(body.upi_id):
            out["upi_id"] = "Enter the UPI ID."
        elif not fmt.is_valid_upi_id(body.upi_id or ""):
            out["upi_id"] = "Enter a UPI ID like name@okhdfcbank."
        for key in ("holder_name", "account_number", "ifsc"):
            if getattr(body, key) is not None:
                out[key] = "Send bank details only with the bank method."
    return out


def check_business(body: BusinessIn) -> dict[str, str]:
    out: dict[str, str] = {}
    if len((body.legal_name or "").strip()) > LEGAL_NAME_MAX:
        out["legal_name"] = f"Keep the legal name to {LEGAL_NAME_MAX} characters."
    gstin = (body.gstin or "").strip()
    if gstin and not fmt.is_valid_gstin(gstin):
        out["gstin"] = "Check the GST number: 15 characters, like 27AAPFU0939F1ZV."
    return out


# --- what the API returns ------------------------------------------------------------------


@dataclass(frozen=True)
class StoreDetailsView:
    brand_name: str
    sells: str | None
    city: str | None
    instagram_or_website: str | None
    contact: dict[str, str] | None
    delivery: dict[str, Any] | None
    returns: dict[str, Any] | None
    pay_on_delivery: dict[str, bool] | None
    payout: dict[str, Any] | None
    business: dict[str, str | None]
    missing: list[str]
    complete: bool
    updated_at: datetime | None


def missing_topics(row: StoreDetails | None) -> list[str]:
    if row is None:
        return list(TOPICS)
    present = {
        "brand": row.sells is not None and row.city is not None,
        "contact": row.contact_name is not None,
        "delivery": row.delivery is not None,
        "returns": row.return_window_days is not None,
        "pay_on_delivery": row.pod_cash is not None,
        "payout": row.payout_method is not None,
    }
    return [topic for topic in TOPICS if not present[topic]]


def masked_payout(row: StoreDetails) -> dict[str, Any] | None:
    if row.payout_method == "bank":
        return {
            "method": "bank",
            "holder_name": row.payout_holder_name,
            "bank_name": row.payout_bank_name,
            "account_last4": row.payout_account_last4,
            "ifsc": row.payout_ifsc,
        }
    if row.payout_method == "upi":
        return {"method": "upi", "upi_id": row.payout_upi_masked}
    return None


def view_of(vendor: Vendor, row: StoreDetails | None) -> StoreDetailsView:
    missing = missing_topics(row)
    if row is None:
        return StoreDetailsView(
            brand_name=vendor.name,
            sells=None,
            city=None,
            instagram_or_website=None,
            contact=None,
            delivery=None,
            returns=None,
            pay_on_delivery=None,
            payout=None,
            business={"legal_name": None, "gstin": None},
            missing=missing,
            complete=False,
            updated_at=None,
        )
    returns = None
    if row.return_window_days is not None:
        returns = {
            "window_days": row.return_window_days,
            "condition": row.return_condition,
            "refund_days": row.refund_days,
        }
    return StoreDetailsView(
        brand_name=vendor.name,
        sells=row.sells,
        city=row.city,
        instagram_or_website=row.instagram_or_website,
        contact=(
            None
            if row.contact_name is None
            else {
                "name": row.contact_name,
                "phone": row.contact_phone or "",
                "email": row.contact_email or "",
            }
        ),
        delivery=row.delivery,
        returns=returns,
        pay_on_delivery=(
            None if row.pod_cash is None else {"cash": bool(row.pod_cash), "upi": bool(row.pod_upi)}
        ),
        payout=masked_payout(row),
        business={"legal_name": row.legal_name, "gstin": row.gstin},
        missing=missing,
        complete=not missing,
        updated_at=row.updated_at,
    )


# --- saving --------------------------------------------------------------------------------


class StoreDetailsService:
    def __init__(self, cipher: PayoutCipher) -> None:
        self._cipher = cipher

    async def _row(self, db: AsyncSession, vendor_id: uuid.UUID) -> StoreDetails | None:
        return await db.scalar(
            select(StoreDetails)
            .where(StoreDetails.vendor_id == vendor_id)
            .execution_options(populate_existing=True)
        )

    async def get(self, db: AsyncSession, vendor: Vendor) -> StoreDetailsView:
        return view_of(vendor, await self._row(db, vendor.id))

    async def _locked_row(self, db: AsyncSession, vendor_id: uuid.UUID) -> StoreDetails:
        """The vendor's row, created if missing, locked until the commit: two saves of the same
        vendor run one after the other, and two first saves cannot both insert."""
        await db.execute(insert(StoreDetails).values(vendor_id=vendor_id).on_conflict_do_nothing())
        row = await db.scalar(
            select(StoreDetails)
            .where(StoreDetails.vendor_id == vendor_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:  # inserted above if it was missing
            raise RuntimeError("store details row vanished")
        return row

    async def save(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        section: Section,
        body: SectionBody,
    ) -> StoreDetailsView:
        problems = check_section(body)
        if problems:
            raise FieldProblems(problems)
        row = await self._locked_row(db, vendor.id)
        detail = self._apply(row, vendor.id, section, body)
        row.updated_by = user_id
        db.add(
            VendorChangeEvent(
                vendor_id=vendor.id,
                subject=ChangeSubject(section),
                action="saved",
                actor_type=ActorType.VENDOR,
                actor_id=user_id,
                detail=detail,
            )
        )
        await db.commit()
        return view_of(vendor, await self._row(db, vendor.id))

    def _apply(
        self, row: StoreDetails, vendor_id: uuid.UUID, section: Section, body: SectionBody
    ) -> dict[str, Any] | None:
        """Writes the section's normalised values; returns what the audit row may keep."""
        if isinstance(body, BrandIn):
            row.sells = body.sells
            row.city = body.city.strip()
            row.instagram_or_website = (body.instagram_or_website or "").strip() or None
        elif isinstance(body, ContactIn):
            row.contact_name = body.name.strip()
            row.contact_phone = fmt.normalise_phone(body.phone)
            row.contact_email = body.email.strip().lower()
        elif isinstance(body, DeliveryIn):
            row.delivery = _normalised_delivery(body)
        elif isinstance(body, ReturnsIn):
            row.return_window_days = body.window_days
            row.return_condition = body.condition if body.window_days else None
            row.refund_days = body.refund_days if body.window_days else None
        elif isinstance(body, PaymentIn):
            row.pod_cash, row.pod_upi = body.cash, body.upi
        elif isinstance(body, PayoutIn):
            return self._apply_payout(row, vendor_id, body)
        elif isinstance(body, BusinessIn):
            row.legal_name = (body.legal_name or "").strip() or None
            gstin = (body.gstin or "").strip()
            row.gstin = fmt.normalise_gstin(gstin) if gstin else None
        return None

    def _apply_payout(
        self, row: StoreDetails, vendor_id: uuid.UUID, body: PayoutIn
    ) -> dict[str, Any]:
        # Clear the other method's columns first: a payout is one method, never a mix.
        row.payout_holder_name = row.payout_account_last4 = row.payout_ifsc = None
        row.payout_bank_name = row.payout_upi_masked = None
        if body.method == "bank":
            account = fmt.normalise_account_number(body.account_number or "")
            ifsc = fmt.normalise_ifsc(body.ifsc or "")
            bank = lookup_ifsc(ifsc)
            row.payout_method = "bank"
            row.payout_secret = self._cipher.seal(account, vendor_id, "account_number")
            row.payout_holder_name = (body.holder_name or "").strip()
            row.payout_account_last4 = fmt.account_last4(account)
            row.payout_ifsc = ifsc
            row.payout_bank_name = bank.bank if bank else None
            detail = {"method": "bank", "account_last4": row.payout_account_last4, "ifsc": ifsc}
        else:
            upi_id = fmt.normalise_upi_id(body.upi_id or "")
            row.payout_method = "upi"
            row.payout_secret = self._cipher.seal(upi_id, vendor_id, "upi_id")
            row.payout_upi_masked = fmt.mask_upi_id(upi_id)
            detail = {"method": "upi", "upi_id": row.payout_upi_masked}
        row.payout_key_id = self._cipher.key_id_of(row.payout_secret)
        return detail


def _normalised_delivery(body: DeliveryIn) -> dict[str, Any]:
    if body.mode == "shazlo":
        address = body.pickup_address
        if address is None:  # check_delivery refuses it first
            raise ValueError("pickup address missing")
        return {
            "mode": "shazlo",
            "pickup_address": {
                "line1": address.line1.strip(),
                "area": address.area.strip(),
                "city": address.city.strip(),
                "pin": fmt.normalise_pin(address.pin),
            },
        }
    areas = body.areas
    if areas is None:  # check_delivery refuses it first
        raise ValueError("delivery areas missing")
    places: list[str] = []
    if not areas.all_india:
        for raw in areas.places:
            place = raw.strip()
            place = fmt.normalise_pin(place) if _is_pin_like(place) else place
            if place and place not in places:
                places.append(place)
    return {
        "mode": "own",
        "areas": {"all_india": areas.all_india, "places": places},
        "delivery_days": body.delivery_days,
    }


def check_section(body: SectionBody) -> dict[str, str]:
    """The problems with one section's body, by field (empty when it can be saved)."""
    if isinstance(body, BrandIn):
        return check_brand(body)
    if isinstance(body, ContactIn):
        return check_contact(body)
    if isinstance(body, DeliveryIn):
        return check_delivery(body)
    if isinstance(body, ReturnsIn):
        return check_returns(body)
    if isinstance(body, PaymentIn):
        return check_payment(body)
    if isinstance(body, PayoutIn):
        return check_payout(body)
    return check_business(body)
