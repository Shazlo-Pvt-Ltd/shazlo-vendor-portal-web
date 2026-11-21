"""Store details (#265): the sign-up topics a brand keeps up to date, saved one section at a time.

`GET /v1/vendor/store-details` and `PUT /v1/vendor/store-details/{section}` for the vendor;
`GET /v1/admin/vendors/{id}/store-details` for reviewers; `GET /v1/public/ifsc/{code}` for anyone.
Payout numbers are sealed in the database and only ever leave the API masked.

A refused request rolls the shared test session back, so tests commit what they set up first.
"""

from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from support import set_vendor_status

from vendor_api.db.models import StoreDetails, VendorChangeEvent

PATH = "/v1/vendor/store-details"
ACCOUNT = "50100123454821"

BRAND = {"sells": "women", "city": "Ahmedabad", "instagram_or_website": "@kalki.studio"}
CONTACT = {"name": "Asha Mehta", "phone": "+91 98765 43210", "email": "Asha@Kalki.in"}
SHAZLO_DELIVERY: dict[str, Any] = {
    "mode": "shazlo",
    "pickup_address": {
        "line1": "12 Ashram Road",
        "area": "Navrangpura",
        "city": "Ahmedabad",
        "pin": "380 009",
    },
}
OWN_DELIVERY = {
    "mode": "own",
    "areas": {"all_india": False, "places": ["Ahmedabad", "380009", "Ahmedabad"]},
    "delivery_days": "2_3",
}
RETURNS = {"window_days": 14, "condition": "unworn_with_tags", "refund_days": 5}
PAYMENT = {"cash": True, "upi": False}
BANK = {
    "method": "bank",
    "holder_name": "Kalki Studio",
    "account_number": ACCOUNT,
    "ifsc": "hdfc0001234",
}
UPI = {"method": "upi", "upi_id": "Kalki.Studio@OKHDFCBANK"}
BUSINESS = {"legal_name": "Kalki Studio LLP", "gstin": "27aapfu0939f1zv"}

ALL_SECTIONS: list[tuple[str, dict[str, Any]]] = [
    ("brand", BRAND),
    ("contact", CONTACT),
    ("delivery", SHAZLO_DELIVERY),
    ("returns", RETURNS),
    ("payment", PAYMENT),
    ("payout", BANK),
    ("business", BUSINESS),
]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, tenant: Tenant, token: str | None = None) -> httpx.Response:
    return await tenants.api.http.get(PATH, headers=bearer(token or tenant.owner_token))


async def put(
    tenants: Tenants, tenant: Tenant, section: str, body: Any, token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.put(
        f"{PATH}/{section}", json=body, headers=bearer(token or tenant.owner_token)
    )


async def fill(tenants: Tenants, tenant: Tenant) -> httpx.Response:
    response: httpx.Response | None = None
    for section, body in ALL_SECTIONS:
        response = await put(tenants, tenant, section, body)
        assert response.status_code == 200, (section, response.json())
    assert response is not None
    return response


def fields(response: httpx.Response) -> dict[str, str]:
    """`{"payout.ifsc": "<message>"}` from a 422's details, the way the portal reads them."""
    assert response.status_code == 422, response.json()
    out: dict[str, str] = {}
    for detail in response.json()["error"]["details"]:
        loc = [str(part) for part in detail["loc"] if part != "body"]
        out[".".join(loc)] = detail["msg"]
    return out


# --- reading -----------------------------------------------------------------------------


async def test_nothing_saved_yet(tenants: Tenants) -> None:
    response = await get(tenants, tenants.a)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "brand_name": "Brand A",
        "sells": None,
        "city": None,
        "instagram_or_website": None,
        "contact": None,
        "delivery": None,
        "returns": None,
        "pay_on_delivery": None,
        "payout": None,
        "business": {"legal_name": None, "gstin": None},
        "missing": ["brand", "contact", "delivery", "returns", "pay_on_delivery", "payout"],
        "complete": False,
        "updated_at": None,
    }


async def test_needs_a_vendor_token(tenants: Tenants) -> None:
    assert (await tenants.api.http.get(PATH)).status_code == 401
    admin = await tenants.api.http.get(PATH, headers=bearer(tenants.admin_token))
    assert admin.status_code == 401


async def test_every_section_saved_makes_it_complete(tenants: Tenants) -> None:
    body = (await fill(tenants, tenants.a)).json()
    assert body["complete"] is True
    assert body["missing"] == []
    assert body["sells"] == "women"
    assert body["city"] == "Ahmedabad"
    assert body["contact"] == {
        "name": "Asha Mehta",
        "phone": "9876543210",
        "email": "asha@kalki.in",
    }
    assert body["delivery"]["pickup_address"]["pin"] == "380009"
    assert body["returns"] == RETURNS
    assert body["pay_on_delivery"] == PAYMENT
    assert body["payout"] == {
        "method": "bank",
        "holder_name": "Kalki Studio",
        "bank_name": "HDFC Bank",
        "account_last4": "4821",
        "ifsc": "HDFC0001234",
    }
    assert body["business"] == {"legal_name": "Kalki Studio LLP", "gstin": "27AAPFU0939F1ZV"}
    assert body["updated_at"] is not None
    assert (await get(tenants, tenants.a)).json() == body


async def test_staff_can_read_and_edit_the_everyday_sections(tenants: Tenants) -> None:
    staff = tenants.a.staff_token
    assert (await put(tenants, tenants.a, "brand", BRAND, staff)).status_code == 200
    assert (await put(tenants, tenants.a, "returns", RETURNS, staff)).status_code == 200
    assert (await get(tenants, tenants.a, staff)).json()["sells"] == "women"


@pytest.mark.parametrize(("section", "body"), [("payout", BANK), ("business", BUSINESS)])
async def test_only_the_owner_changes_payouts_and_business_details(
    tenants: Tenants, section: str, body: dict[str, Any]
) -> None:
    response = await put(tenants, tenants.a, section, body, tenants.a.staff_token)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


# --- each section's rules ------------------------------------------------------------------


async def test_own_delivery_keeps_each_place_once_and_normalises_pins(tenants: Tenants) -> None:
    body = (await put(tenants, tenants.a, "delivery", OWN_DELIVERY)).json()
    assert body["delivery"] == {
        "mode": "own",
        "areas": {"all_india": False, "places": ["Ahmedabad", "380009"]},
        "delivery_days": "2_3",
    }


async def test_all_india_drops_the_places(tenants: Tenants) -> None:
    sent = {**OWN_DELIVERY, "areas": {"all_india": True, "places": ["Pune"]}}
    body = (await put(tenants, tenants.a, "delivery", sent)).json()
    assert body["delivery"]["areas"] == {"all_india": True, "places": []}


async def test_no_returns_stores_no_condition_or_refund_time(tenants: Tenants) -> None:
    sent = {"window_days": 0, "condition": "any_reason", "refund_days": 7}
    body = (await put(tenants, tenants.a, "returns", sent)).json()
    assert body["returns"] == {"window_days": 0, "condition": None, "refund_days": None}
    assert "returns" not in body["missing"]


async def test_upi_payout_is_masked(tenants: Tenants) -> None:
    body = (await put(tenants, tenants.a, "payout", UPI)).json()
    assert body["payout"] == {"method": "upi", "upi_id": "ka•••@okhdfcbank"}


async def test_a_well_formed_ifsc_of_an_unlisted_bank_is_accepted_without_a_bank_name(
    tenants: Tenants,
) -> None:
    body = (await put(tenants, tenants.a, "payout", {**BANK, "ifsc": "ZZZZ0001234"})).json()
    assert body["payout"]["bank_name"] is None
    assert body["payout"]["ifsc"] == "ZZZZ0001234"


async def test_empty_business_details_are_stored_as_null(tenants: Tenants) -> None:
    await put(tenants, tenants.a, "business", BUSINESS)
    body = (await put(tenants, tenants.a, "business", {"legal_name": " ", "gstin": ""})).json()
    assert body["business"] == {"legal_name": None, "gstin": None}


async def test_clearing_the_link(tenants: Tenants) -> None:
    await put(tenants, tenants.a, "brand", BRAND)
    body = (await put(tenants, tenants.a, "brand", {**BRAND, "instagram_or_website": ""})).json()
    assert body["instagram_or_website"] is None


BAD: list[tuple[str, dict[str, Any], str]] = [
    ("brand", {**BRAND, "sells": "kids"}, "sells"),
    ("brand", {**BRAND, "city": " a "}, "city"),
    ("brand", {**BRAND, "instagram_or_website": "javascript:alert(1)"}, "instagram_or_website"),
    ("contact", {**CONTACT, "phone": "12345"}, "phone"),
    ("contact", {**CONTACT, "email": "asha"}, "email"),
    # 209 characters as sent; lower-casing turns each "İ" into two, past the 320 the column holds.
    ("contact", {**CONTACT, "email": "İ" * 200 + "@kalki.in"}, "email"),
    ("contact", {**CONTACT, "name": "  "}, "name"),
    ("delivery", {"mode": "drone"}, "mode"),
    (
        "delivery",
        {
            **SHAZLO_DELIVERY,
            "pickup_address": {**SHAZLO_DELIVERY["pickup_address"], "pin": "012345"},
        },
        "pickup_address.pin",
    ),
    ("delivery", {**OWN_DELIVERY, "areas": {"all_india": False, "places": []}}, "areas"),
    (
        "delivery",
        {**OWN_DELIVERY, "areas": {"all_india": False, "places": ["12345"]}},
        "areas.places",
    ),
    (
        "delivery",
        {**OWN_DELIVERY, "areas": {"all_india": False, "places": [f"C{i}" for i in range(51)]}},
        "areas.places",
    ),
    ("delivery", {**OWN_DELIVERY, "delivery_days": "1_10"}, "delivery_days"),
    ("returns", {"window_days": 10, "condition": None, "refund_days": None}, "window_days"),
    ("returns", {**RETURNS, "condition": None}, "condition"),
    ("returns", {**RETURNS, "refund_days": None}, "refund_days"),
    ("payment", {"cash": False, "upi": False}, "pay_on_delivery"),
    ("payout", {**BANK, "account_number": "12345"}, "account_number"),
    ("payout", {**BANK, "ifsc": "HDFC1001234"}, "ifsc"),
    ("payout", {**BANK, "holder_name": ""}, "holder_name"),
    ("payout", {"method": "upi", "upi_id": "not-a-upi"}, "upi_id"),
    ("payout", {"method": "cheque"}, "method"),
    ("business", {**BUSINESS, "gstin": "27AAPFU0939F1ZA"}, "gstin"),
    ("business", {**BUSINESS, "legal_name": "x" * 121}, "legal_name"),
]


@pytest.mark.parametrize(("section", "body", "field"), BAD)
async def test_a_bad_value_is_a_422_naming_the_field(
    tenants: Tenants, section: str, body: dict[str, Any], field: str
) -> None:
    response = await put(tenants, tenants.a, section, body)
    problems = fields(response)
    assert any(key == field or key.endswith("." + field) for key in problems), problems


@pytest.mark.parametrize(("section", "body"), ALL_SECTIONS)
async def test_unknown_fields_are_refused(
    tenants: Tenants, section: str, body: dict[str, Any]
) -> None:
    response = await put(
        tenants, tenants.a, section, {**body, "vendor_id": str(tenants.b.vendor.id)}
    )
    assert response.status_code == 422


async def test_an_unknown_section_is_404(tenants: Tenants) -> None:
    assert (await put(tenants, tenants.a, "bank", BANK)).status_code in (404, 405)


async def test_a_refused_account_number_is_never_echoed(tenants: Tenants) -> None:
    secret = "1234567890123456789012"  # too long, so refused
    response = await put(tenants, tenants.a, "payout", {**BANK, "account_number": secret})
    assert response.status_code == 422
    assert secret not in response.text


# --- payouts are sealed ----------------------------------------------------------------------


async def test_the_account_number_is_sealed_in_the_database(
    tenants: Tenants, session: AsyncSession
) -> None:
    response = await put(tenants, tenants.a, "payout", BANK)
    assert ACCOUNT not in response.text
    row = await session.scalar(
        select(StoreDetails).where(StoreDetails.vendor_id == tenants.a.vendor.id)
    )
    assert row is not None
    assert row.payout_secret is not None
    assert ACCOUNT.encode() not in row.payout_secret
    cipher = tenants.api.app.state.payout_cipher
    assert cipher.open(row.payout_secret, tenants.a.vendor.id, "account_number") == ACCOUNT
    dumped = await session.scalar(
        text("SELECT row_to_json(s)::text FROM store_details s WHERE vendor_id = :v"),
        {"v": tenants.a.vendor.id},
    )
    assert ACCOUNT not in dumped


async def test_switching_to_upi_forgets_the_bank_account(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, "payout", BANK)
    await put(tenants, tenants.a, "payout", UPI)
    row = await session.scalar(
        select(StoreDetails).where(StoreDetails.vendor_id == tenants.a.vendor.id)
    )
    assert row is not None
    assert (row.payout_holder_name, row.payout_account_last4, row.payout_ifsc) == (None, None, None)
    cipher = tenants.api.app.state.payout_cipher
    assert (
        cipher.open(row.payout_secret, tenants.a.vendor.id, "upi_id") == "kalki.studio@okhdfcbank"
    )


async def test_payout_changes_are_audited_masked(tenants: Tenants, session: AsyncSession) -> None:
    await put(tenants, tenants.a, "payout", BANK)
    await put(tenants, tenants.a, "payout", UPI)
    events = (
        await session.scalars(
            select(VendorChangeEvent)
            .where(VendorChangeEvent.vendor_id == tenants.a.vendor.id)
            .order_by(VendorChangeEvent.id)
        )
    ).all()
    payouts = [e for e in events if e.subject == "payout"]
    assert [e.detail for e in payouts] == [
        {"method": "bank", "account_last4": "4821", "ifsc": "HDFC0001234"},
        {"method": "upi", "upi_id": "ka•••@okhdfcbank"},
    ]
    assert all(e.actor_type == "vendor" and e.actor_id == tenants.a.owner.id for e in payouts)
    assert ACCOUNT not in str([e.detail for e in events])


async def test_the_audit_is_append_only(tenants: Tenants, session: AsyncSession) -> None:
    await put(tenants, tenants.a, "payout", BANK)
    with pytest.raises(Exception, match="append-only"):
        await session.execute(text("UPDATE vendor_change_events SET detail = '{}'::jsonb"))


# --- isolation and vendor status -------------------------------------------------------------


async def test_each_vendor_sees_only_its_own(tenants: Tenants) -> None:
    await fill(tenants, tenants.a)
    b = (await get(tenants, tenants.b)).json()
    assert b["brand_name"] == "Brand B"
    assert b["payout"] is None and b["complete"] is False


async def test_a_pending_vendor_fills_them_in(tenants: Tenants, session: AsyncSession) -> None:
    await set_vendor_status(session, tenants.a.vendor, "pending")
    await session.commit()
    assert (await put(tenants, tenants.a, "brand", BRAND)).status_code == 200


async def test_a_suspended_vendor_cannot(tenants: Tenants, session: AsyncSession) -> None:
    await set_vendor_status(session, tenants.a.vendor, "suspended")
    await session.commit()
    response = await put(tenants, tenants.a, "brand", BRAND)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "vendor_not_allowed"


# --- reviewers ---------------------------------------------------------------------------------


async def test_reviewers_see_a_vendors_details_masked(tenants: Tenants) -> None:
    await fill(tenants, tenants.a)
    response = await tenants.api.http.get(
        f"/v1/admin/vendors/{tenants.a.vendor.id}/store-details",
        headers=bearer(tenants.admin_token),
    )
    assert response.status_code == 200
    assert response.json()["payout"]["account_last4"] == "4821"
    assert ACCOUNT not in response.text


async def test_the_admin_view_needs_an_admin_token(tenants: Tenants) -> None:
    path = f"/v1/admin/vendors/{tenants.a.vendor.id}/store-details"
    assert (
        await tenants.api.http.get(path, headers=bearer(tenants.a.owner_token))
    ).status_code == 401
    other_role = tenants.identity.token(["marketing_editor"])
    assert (await tenants.api.http.get(path, headers=bearer(other_role))).status_code == 403


async def test_the_admin_view_of_an_unknown_vendor_is_404(tenants: Tenants) -> None:
    response = await tenants.api.http.get(
        "/v1/admin/vendors/00000000-0000-0000-0000-000000000000/store-details",
        headers=bearer(tenants.admin_token),
    )
    assert response.status_code == 404


# --- IFSC lookup -----------------------------------------------------------------------------


async def test_ifsc_lookup(tenants: Tenants) -> None:
    response = await tenants.api.http.get("/v1/public/ifsc/hdfc0001234")
    assert response.status_code == 200
    assert response.json() == {"ifsc": "HDFC0001234", "bank": "HDFC Bank", "branch": None}


async def test_ifsc_lookup_of_an_unlisted_bank_is_404(tenants: Tenants) -> None:
    response = await tenants.api.http.get("/v1/public/ifsc/ZZZZ0001234")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ifsc_unknown"


@pytest.mark.parametrize("code", ["HDFC1001234", "x", "HDFC0001234%00", "A" * 200])
async def test_ifsc_lookup_of_a_bad_code_is_422(tenants: Tenants, code: str) -> None:
    response = await tenants.api.http.get(f"/v1/public/ifsc/{code}")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ifsc_format"


async def test_ifsc_lookup_is_rate_limited_per_ip(tenants: Tenants) -> None:
    rule = tenants.api.app.state.settings.rate_limit_ifsc_lookup_ip
    statuses = [
        (await tenants.api.http.get("/v1/public/ifsc/HDFC0001234")).status_code
        for _ in range(rule.limit + 1)
    ]
    assert statuses[:-1] == [200] * rule.limit
    assert statuses[-1] == 429
