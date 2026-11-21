"""Trying to break the #265 endpoints: input Postgres cannot store, text that hides what it says,
oversized and malformed bodies, echoed secrets, races and crossed tenants. Each test is an
attack that must end in a clean 4xx (never a 500) and leave nothing behind.

A refused request rolls the shared test session back, so tests commit what they set up first.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from conftest import Tenants
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from vendor_api.db.models import (
    StoreDetails,
    Vendor,
    VendorChangeEvent,
    VendorUser,
)
from vendor_api.db.session import async_url
from vendor_api.services.commission import CommissionService
from vendor_api.services.payout_cipher import PayoutCipher
from vendor_api.services.store_details import BrandIn, StoreDetailsService

STORE = "/v1/vendor/store-details"
BANK = {
    "method": "bank",
    "holder_name": "Kalki",
    "account_number": "50100123454821",
    "ifsc": "HDFC0001234",
}
ADDRESS = {"line1": "12 Ashram Road", "area": "Navrangpura", "city": "Ahmedabad", "pin": "380009"}
NOTE = "Our standard rate for kurtas is 12%."


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def put_raw(tenants: Tenants, path: str, raw: str, token: str) -> httpx.Response:
    return await tenants.api.http.put(
        path,
        content=raw.encode("utf-8", "surrogatepass"),
        headers={**bearer(token), "Content-Type": "application/json"},
    )


# --- text Postgres cannot store, or that hides what it says ----------------------------------

HIDDEN = [
    "\x00",  # NUL: Postgres text and JSONB refuse it (a 500 if it got that far)
    "‮",  # right-to-left override: "Kalki‮LLP" displays reversed to a reviewer
    "⁦",  # left-to-right isolate
    "​",  # zero-width space
    "﻿",  # byte order mark
    "\x07",  # bell, a control character
]


def _with(value: str, hidden: str) -> str:
    return value[:3] + hidden + value[3:]


CASES: list[tuple[str, dict[str, Any], str]] = [
    ("brand", {"sells": "women", "city": "Ahmedabad", "instagram_or_website": None}, "city"),
    ("contact", {"name": "Asha Mehta", "phone": "9876543210", "email": "a@kalki.in"}, "name"),
    ("delivery", {"mode": "shazlo", "pickup_address": ADDRESS}, "pickup_address.line1"),
    ("payout", BANK, "holder_name"),
    ("business", {"legal_name": "Kalki Studio LLP", "gstin": None}, "legal_name"),
]


@pytest.mark.parametrize("hidden", HIDDEN, ids=[repr(h) for h in HIDDEN])
@pytest.mark.parametrize(("section", "body", "field"), CASES)
async def test_hidden_and_control_characters_are_refused(
    tenants: Tenants, section: str, body: dict[str, Any], field: str, hidden: str
) -> None:
    sent = json.loads(json.dumps(body))
    target = sent
    *parents, leaf = field.split(".")
    for parent in parents:
        target = target[parent]
    target[leaf] = _with(target[leaf], hidden)
    response = await tenants.api.http.put(
        f"{STORE}/{section}", json=sent, headers=bearer(tenants.a.owner_token)
    )
    assert response.status_code == 422, response.text


async def test_a_hidden_character_in_a_delivery_place_is_refused(tenants: Tenants) -> None:
    body = {
        "mode": "own",
        "areas": {"all_india": False, "places": ["Pune", "Sur\x00at"]},
        "delivery_days": "2_3",
    }
    response = await tenants.api.http.put(
        f"{STORE}/delivery", json=body, headers=bearer(tenants.a.owner_token)
    )
    assert response.status_code == 422


async def test_a_lone_surrogate_is_refused_not_a_500(tenants: Tenants) -> None:
    # Valid JSON, decodes to a str Postgres (UTF-8) cannot hold.
    raw = '{"sells": "women", "city": "Ahm\\ud800edabad", "instagram_or_website": null}'
    response = await put_raw(tenants, f"{STORE}/brand", raw, tenants.a.owner_token)
    assert response.status_code == 422


async def test_a_city_of_only_zero_width_spaces_is_refused(tenants: Tenants) -> None:
    body = {"sells": "women", "city": "​​​", "instagram_or_website": None}
    response = await tenants.api.http.put(
        f"{STORE}/brand", json=body, headers=bearer(tenants.a.owner_token)
    )
    assert response.status_code == 422


@pytest.mark.parametrize("hidden", ["\x00", "‮", "\ud800"])
async def test_a_commission_note_with_hidden_characters_is_refused(
    tenants: Tenants, session: AsyncSession, hidden: str
) -> None:
    await tenants.api.http.post(
        "/v1/vendor/commission/proposal",
        json={"rate_bps": 1000},
        headers=bearer(tenants.a.owner_token),
    )
    await session.commit()
    raw = json.dumps({"note": NOTE[:5] + hidden + NOTE[5:]})
    if hidden == "\ud800":
        raw = '{"note": "Our s\\ud800tandard rate for kurtas is 12%."}'
    response = await tenants.api.http.post(
        f"/v1/admin/vendors/{tenants.a.vendor.id}/commission/send-back",
        content=raw.encode("utf-8", "surrogatepass"),
        headers={**bearer(tenants.admin_token), "Content-Type": "application/json"},
    )
    assert response.status_code == 422, response.text


async def test_a_commission_note_keeps_its_line_breaks(tenants: Tenants) -> None:
    note = "Our rate for kurtas is 12%.\nFor sarees it is 10%."
    response = await tenants.api.http.post(
        f"/v1/admin/vendors/{tenants.a.vendor.id}/commission/set",
        json={"commission_bps": 1200, "note": note},
        headers=bearer(tenants.admin_token),
    )
    assert response.status_code == 200
    assert response.json()["note"] == note


# --- oversized, malformed and echoing bodies -----------------------------------------------


@pytest.mark.parametrize("raw", ["null", "[]", '"brand"', "1", "{", ""])
async def test_bodies_that_are_not_objects(tenants: Tenants, raw: str) -> None:
    response = await put_raw(tenants, f"{STORE}/brand", raw, tenants.a.owner_token)
    assert response.status_code == 422


async def test_a_huge_account_number_is_refused_and_never_echoed(tenants: Tenants) -> None:
    secret = "9" * 5000
    response = await tenants.api.http.put(
        f"{STORE}/payout",
        json={**BANK, "account_number": secret},
        headers=bearer(tenants.a.owner_token),
    )
    assert response.status_code == 422
    assert "99999999" not in response.text


async def test_mixing_bank_and_upi_details_is_refused(tenants: Tenants) -> None:
    response = await tenants.api.http.put(
        f"{STORE}/payout",
        json={"method": "upi", "upi_id": "kalki@ybl", "account_number": "50100123454821"},
        headers=bearer(tenants.a.owner_token),
    )
    assert response.status_code == 422
    assert "50100123454821" not in response.text


async def test_a_thousand_places_is_refused(tenants: Tenants) -> None:
    body = {
        "mode": "own",
        "areas": {"all_india": False, "places": [f"Town {i}" for i in range(1000)]},
        "delivery_days": "2_3",
    }
    response = await tenants.api.http.put(
        f"{STORE}/delivery", json=body, headers=bearer(tenants.a.owner_token)
    )
    assert response.status_code == 422


@pytest.mark.parametrize("ifsc", ["ＨＤＦＣ0001234", "HDFC0001234\n", "hdfc०००१२३४"])
async def test_lookalike_ifsc_codes_are_refused(tenants: Tenants, ifsc: str) -> None:
    response = await tenants.api.http.put(
        f"{STORE}/payout", json={**BANK, "ifsc": ifsc}, headers=bearer(tenants.a.owner_token)
    )
    assert response.status_code == 422  # full-width letters, a control character, Devanagari digits


async def test_a_long_size_name_is_refused_without_echoing_it(tenants: Tenants) -> None:
    key = "Z" * 10_000
    response = await tenants.api.http.put(
        "/v1/vendor/size-charts/tops",
        json={"measurements": {key: {"chest": 90}}},
        headers=bearer(tenants.a.owner_token),
    )
    assert response.status_code == 422
    assert key[:100] not in response.text
    assert len(response.text) < 2000


async def test_a_size_with_a_thousand_measurements_gets_one_problem(tenants: Tenants) -> None:
    row = {f"m{i}": 1 for i in range(1000)}
    response = await tenants.api.http.put(
        "/v1/vendor/size-charts/tops",
        json={"measurements": {"M": row}},
        headers=bearer(tenants.a.owner_token),
    )
    assert response.status_code == 422
    assert len(response.json()["error"]["details"]) <= 5


async def test_a_rate_written_as_a_float_or_exponent_is_refused(tenants: Tenants) -> None:
    for raw in ['{"rate_bps": 1000.0}', '{"rate_bps": 1e3}', '{"rate_bps": "1000"}']:
        response = await tenants.api.http.post(
            "/v1/vendor/commission/proposal",
            content=raw,
            headers={**bearer(tenants.a.owner_token), "Content-Type": "application/json"},
        )
        assert response.status_code == 422, raw


# --- tokens and tenants --------------------------------------------------------------------


async def test_an_identity_api_token_for_another_audience_is_refused(tenants: Tenants) -> None:
    wrong = tenants.identity.token(["super_admin"], audience="identity-api")
    response = await tenants.api.http.post(
        f"/v1/admin/vendors/{tenants.a.vendor.id}/commission/set",
        json={"commission_bps": 0},
        headers=bearer(wrong),
    )
    assert response.status_code == 401


async def test_super_admin_passes_the_reviewer_check(tenants: Tenants) -> None:
    response = await tenants.api.http.post(
        f"/v1/admin/vendors/{tenants.a.vendor.id}/commission/set",
        json={"commission_bps": 0},
        headers=bearer(tenants.identity.token(["super_admin"])),
    )
    assert response.status_code == 200
    assert response.json()["agreed_bps"] == 0


async def test_a_vendor_token_signed_for_vendor_a_cannot_write_vendor_b(tenants: Tenants) -> None:
    body = {"sells": "men", "city": "Surat", "instagram_or_website": None}
    await tenants.api.http.put(f"{STORE}/brand", json=body, headers=bearer(tenants.a.owner_token))
    b = await tenants.api.http.get(STORE, headers=bearer(tenants.b.owner_token))
    assert b.json()["city"] is None


@pytest.mark.parametrize(
    "path", [f"{STORE}/Payout", f"{STORE}/payout/", f"{STORE}/../store-details/payout"]
)
async def test_owner_only_sections_cannot_be_reached_by_another_spelling(
    tenants: Tenants, path: str
) -> None:
    response = await tenants.api.http.put(path, json=BANK, headers=bearer(tenants.a.staff_token))
    assert response.status_code in (403, 404, 405, 307), response.status_code
    assert response.status_code != 200


# --- races ---------------------------------------------------------------------------------


@pytest.fixture
async def own_engine(migrated_db: str) -> AsyncIterator[Any]:
    """An engine whose sessions really commit (the races need separate connections), and two
    vendors made through it, removed again afterwards."""
    engine = create_async_engine(async_url(migrated_db), poolclass=NullPool)
    vendor_ids: list[uuid.UUID] = []
    user_ids: list[uuid.UUID] = []
    async with AsyncSession(engine, expire_on_commit=False) as db:
        for n in range(2):
            vendor = Vendor(
                name=f"Race {n}",
                slug=f"race-{uuid.uuid4().hex[:8]}",
                email=f"race-{uuid.uuid4().hex[:8]}@race.test",
                phone="+911234567890",
                contact_name="Owner",
                product_type="apparel",
                price_min_paise=1,
                price_max_paise=2,
            )
            db.add(vendor)
            await db.flush()
            user = VendorUser(
                vendor_id=vendor.id,
                email=f"o-{uuid.uuid4().hex[:8]}@race.test",
                role="owner",
                status="invited",
            )
            db.add(user)
            await db.flush()
            vendor_ids.append(vendor.id)
            user_ids.append(user.id)
        await db.commit()
    try:
        yield engine, vendor_ids, user_ids
    finally:
        async with engine.begin() as connection:
            # The audit is append-only and vendors are never deleted, by trigger: the test's own
            # rows go with the triggers off for this transaction only (the test user is the
            # database's superuser, as in CI).
            await connection.execute(text("SET LOCAL session_replication_role = replica"))
            for table in ("vendor_change_events", "store_details", "commissions"):
                await connection.execute(
                    text(f"DELETE FROM {table} WHERE vendor_id = ANY(:ids)"),  # noqa: S608
                    {"ids": vendor_ids},
                )
            await connection.execute(delete(VendorUser).where(VendorUser.id.in_(user_ids)))
            await connection.execute(
                text("DELETE FROM vendor_status_events WHERE vendor_id = ANY(:ids)"),
                {"ids": vendor_ids},
            )
            await connection.execute(delete(Vendor).where(Vendor.id.in_(vendor_ids)))
        await engine.dispose()


async def test_ten_first_saves_at_once_make_one_row(own_engine: Any) -> None:
    engine, vendor_ids, user_ids = own_engine
    service = StoreDetailsService(PayoutCipher({"k": b"k" * 32}, "k"))

    async def save(n: int) -> None:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            vendor = await db.get(Vendor, vendor_ids[0])
            assert vendor is not None
            body = BrandIn(sells="women", city=f"City {n}", instagram_or_website=None)
            await service.save(db, vendor, user_ids[0], "brand", body)

    await asyncio.gather(*(save(n) for n in range(10)))
    async with AsyncSession(engine) as db:
        rows = await db.scalar(
            select(func.count())
            .select_from(StoreDetails)
            .where(StoreDetails.vendor_id == vendor_ids[0])
        )
        audits = await db.scalar(
            select(func.count())
            .select_from(VendorChangeEvent)
            .where(VendorChangeEvent.vendor_id == vendor_ids[0])
        )
    assert (rows, audits) == (1, 10)


async def test_a_proposal_racing_an_approval_is_never_approved_unseen(own_engine: Any) -> None:
    """The reviewer saw 1000. The brand changes it to 1500 at the same moment the reviewer
    approves. Whatever order the database picks, 1500 is never agreed without being seen."""
    from vendor_api.services.commission import approve

    engine, vendor_ids, user_ids = own_engine
    service = CommissionService()
    vendor_id, user_id = vendor_ids[1], user_ids[1]
    async with AsyncSession(engine, expire_on_commit=False) as db:
        await service.propose(db, vendor_id, user_id, 1000)

    async def brand() -> object:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            return await service.propose(db, vendor_id, user_id, 1500)

    async def reviewer() -> object:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            try:
                return await service.decide(
                    db, vendor_id, uuid.uuid4(), "approved", lambda t: approve(t, 1000)
                )
            except Exception as error:  # the 409 when the brand got there first
                return error

    await asyncio.gather(brand(), reviewer())
    async with AsyncSession(engine) as db:
        final = await service.get(db, vendor_id)
    assert final.agreed_bps in (None, 1000)
    assert final.agreed_bps != 1500
