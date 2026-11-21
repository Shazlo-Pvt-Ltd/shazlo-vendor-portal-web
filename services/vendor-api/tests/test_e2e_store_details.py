"""#265 end to end, with the real pieces of `test_e2e_catalog.py`: Postgres, a real Redis, the
JWKS client fetching identity-api's keys over HTTP, the real emails' tokens, and a fake image host.

A brand signs up and, while its application is pending, fills in its store details (payout
included), proposes a commission and saves a size chart with a photo. A reviewer finds the
proposal, sends it back, approves the second one, reads the store details (masked), and suspends
and reinstates the brand. The account number never leaves the API, and nothing about commission
or payouts reaches the central app's outbox.

It needs `DATABASE_URL` and `REDIS_URL` (CI sets both) and skips without them.
"""

from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_e2e_auth import real_redis, stack_settings  # noqa: F401  (fixtures, used by name)
from test_e2e_catalog import (  # noqa: F401  (world is a fixture, used by name)
    OWNER,
    World,
    onboard,
    upload_image,
    world,
)

from vendor_api.db.models import OutboxEvent, VendorChangeEvent

ACCOUNT = "50100123454821"
SECTIONS: list[tuple[str, dict[str, Any]]] = [
    ("brand", {"sells": "both", "city": "Jaipur", "instagram_or_website": "rangrez.in"}),
    ("contact", {"name": "Meera", "phone": "098290 12345", "email": "meera@rangrez.in"}),
    (
        "delivery",
        {"mode": "own", "areas": {"all_india": True, "places": []}, "delivery_days": "3_5"},
    ),
    ("returns", {"window_days": 7, "condition": "damaged_or_wrong", "refund_days": 2}),
    ("payment", {"cash": True, "upi": True}),
    (
        "payout",
        {
            "method": "bank",
            "holder_name": "Rangrez Prints",
            "account_number": "5010 0123 4548 21",
            "ifsc": "SBIN0000691",
        },
    ),
    ("business", {"legal_name": "Rangrez Prints Pvt Ltd", "gstin": None}),
]


class Seen:
    """Every response body the test receives, to prove the account number is in none of them."""

    def __init__(self) -> None:
        self.bodies: list[str] = []

    def __call__(self, response: httpx.Response, status: int = 200) -> dict[str, Any]:
        assert response.status_code == status, response.text
        self.bodies.append(response.text)
        body: dict[str, Any] = response.json()
        return body


async def test_store_details_commission_and_size_charts_end_to_end(
    world: World,  # noqa: F811
    session: AsyncSession,
) -> None:
    w, seen = world, Seen()
    vendor = await onboard(w)
    me = seen(await w.http.get("/v1/vendor/me", headers=vendor))
    vendor_id = me["vendor"]["id"]
    assert me["vendor"]["status"] == "pending"

    # --- the brand, while its application is pending ---------------------------------------
    details = seen(await w.http.get("/v1/vendor/store-details", headers=vendor))
    assert details["complete"] is False and len(details["missing"]) == 6
    for section, body in SECTIONS:
        details = seen(
            await w.http.put(f"/v1/vendor/store-details/{section}", json=body, headers=vendor)
        )
    assert details["complete"] is True
    assert details["contact"]["phone"] == "9829012345"
    assert details["payout"] == {
        "method": "bank",
        "holder_name": "Rangrez Prints",
        "bank_name": "State Bank of India",
        "account_last4": "4821",
        "ifsc": "SBIN0000691",
    }
    assert seen(await w.http.get("/v1/public/ifsc/sbin0000691"))["bank"] == "State Bank of India"

    proposed = seen(
        await w.http.post("/v1/vendor/commission/proposal", json={"rate_bps": 1000}, headers=vendor)
    )
    assert proposed["state"] == "proposed"

    photo_id = await upload_image(w, vendor, "size_chart")
    chart = seen(
        await w.http.put(
            "/v1/vendor/size-charts/tops",
            json={"measurements": {"M": {"chest": 96}}, "photo_asset_id": photo_id},
            headers=vendor,
        )
    )
    assert chart["photo_url"].startswith("https://")
    assert chart["measurements"]["M"]["chest"] == 96

    # --- the reviewer --------------------------------------------------------------------------
    to_review = seen(
        await w.http.get("/v1/admin/vendors?status=all&commission=proposed", headers=w.admin)
    )
    assert [v["id"] for v in to_review["items"]] == [vendor_id]
    assert to_review["items"][0]["commission"]["proposed_bps"] == 1000

    admin_view = seen(
        await w.http.get(f"/v1/admin/vendors/{vendor_id}/store-details", headers=w.admin)
    )
    assert admin_view["payout"]["account_last4"] == "4821"

    note = "Our rate for block prints is 12%. Propose again?"
    seen(
        await w.http.post(
            f"/v1/admin/vendors/{vendor_id}/commission/send-back",
            json={"note": note},
            headers=w.admin,
        )
    )
    mine = seen(await w.http.get("/v1/vendor/commission", headers=vendor))
    assert (mine["state"], mine["note"]) == ("sent_back", note)

    seen(
        await w.http.post("/v1/vendor/commission/proposal", json={"rate_bps": 1200}, headers=vendor)
    )
    # A reviewer who still has the old proposal on screen cannot approve it.
    seen(
        await w.http.post(
            f"/v1/admin/vendors/{vendor_id}/commission/approve",
            json={"proposed_bps": 1000},
            headers=w.admin,
        ),
        409,
    )
    agreed = seen(
        await w.http.post(
            f"/v1/admin/vendors/{vendor_id}/commission/approve",
            json={"proposed_bps": 1200},
            headers=w.admin,
        )
    )
    assert (agreed["state"], agreed["agreed_bps"]) == ("agreed", 1200)
    detail = seen(await w.http.get(f"/v1/admin/vendors/{vendor_id}", headers=w.admin))
    assert detail["commission"]["agreed_bps"] == 1200

    # --- approval, suspension, reinstatement ---------------------------------------------------
    seen(await w.http.post(f"/v1/admin/vendors/{vendor_id}/approve", json={}, headers=w.admin))
    login = await w.api.login(OWNER)
    assert login.status_code == 200
    vendor = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert seen(await w.http.get("/v1/vendor/store-details", headers=vendor))["complete"]

    seen(
        await w.http.post(
            f"/v1/admin/vendors/{vendor_id}/suspend",
            json={"reason": "Checking the bank details."},
            headers=w.admin,
        )
    )
    seen(await w.http.get("/v1/vendor/store-details", headers=vendor), 403)
    seen(await w.http.post(f"/v1/admin/vendors/{vendor_id}/approve", json={}, headers=w.admin))
    login = await w.api.login(OWNER)
    vendor = {"Authorization": f"Bearer {login.json()['access_token']}"}
    final = seen(await w.http.get("/v1/vendor/commission", headers=vendor))
    assert final["agreed_bps"] == 1200

    # --- what must not leak ---------------------------------------------------------------------
    for received in seen.bodies:
        assert ACCOUNT not in received and "50100123" not in received
    audited = await session.scalar(
        select(func.count())
        .select_from(VendorChangeEvent)
        .where(VendorChangeEvent.vendor_id == vendor_id)
    )
    assert audited == len(SECTIONS) + 4 + 1  # sections, four commission steps, the chart
    events = (await session.scalars(select(OutboxEvent.event_type))).all()
    assert all("commission" not in t and "payout" not in t for t in events)
