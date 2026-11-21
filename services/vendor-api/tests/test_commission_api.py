"""Per-brand commission over HTTP (#265): the brand proposes, a reviewer approves, sends back or
sets a rate. No default rate anywhere.

Vendor: `GET /v1/vendor/commission`, `POST /v1/vendor/commission/proposal` (owner only).
Admin: `GET /v1/admin/vendors/{id}/commission`, `POST .../commission/approve|send-back|set`, and
`?commission=` on `GET /v1/admin/vendors`.

A refused request rolls the shared test session back, so tests commit what they set up first.
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import ADMIN_ID, set_vendor_status

from vendor_api.db.models import Commission, VendorChangeEvent

MINE = "/v1/vendor/commission"
NOTE = "Our standard rate for kurtas is 12%."
NOT_SET = {"state": "not_set", "agreed_bps": None, "proposed_bps": None, "note": None}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def admin_path(tenant: Tenant, step: str = "") -> str:
    return f"/v1/admin/vendors/{tenant.vendor.id}/commission" + (f"/{step}" if step else "")


async def propose(
    tenants: Tenants, tenant: Tenant, rate: Any, token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.post(
        f"{MINE}/proposal", json={"rate_bps": rate}, headers=bearer(token or tenant.owner_token)
    )


async def admin(
    tenants: Tenants, tenant: Tenant, step: str, body: dict[str, Any], token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.post(
        admin_path(tenant, step), json=body, headers=bearer(token or tenants.admin_token)
    )


def terms(response: httpx.Response) -> dict[str, Any]:
    assert response.status_code == 200, response.json()
    body: dict[str, Any] = response.json()
    assert body.pop("updated_at", "missing") != "missing"
    return body


async def test_no_rate_until_one_is_agreed(tenants: Tenants) -> None:
    response = await tenants.api.http.get(MINE, headers=bearer(tenants.a.staff_token))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {**NOT_SET, "updated_at": None}


async def test_the_whole_negotiation(tenants: Tenants, session: AsyncSession) -> None:
    a = tenants.a
    assert terms(await propose(tenants, a, 1000)) == {
        "state": "proposed",
        "agreed_bps": None,
        "proposed_bps": 1000,
        "note": None,
    }
    sent_back = terms(await admin(tenants, a, "send-back", {"note": NOTE}))
    assert sent_back == {
        "state": "sent_back",
        "agreed_bps": None,
        "proposed_bps": 1000,
        "note": NOTE,
    }
    assert terms(await tenants.api.http.get(MINE, headers=bearer(a.owner_token))) == sent_back

    await propose(tenants, a, 1200)
    approved = terms(await admin(tenants, a, "approve", {"proposed_bps": 1200}))
    assert approved == {"state": "agreed", "agreed_bps": 1200, "proposed_bps": None, "note": None}

    # A new proposal waits; the agreed rate stays in force meanwhile.
    assert terms(await propose(tenants, a, 1100))["agreed_bps"] == 1200

    events = (
        await session.scalars(
            select(VendorChangeEvent)
            .where(VendorChangeEvent.vendor_id == a.vendor.id)
            .order_by(VendorChangeEvent.id)
        )
    ).all()
    assert [(e.action, e.actor_type) for e in events] == [
        ("proposed", "vendor"),
        ("sent_back", "admin"),
        ("proposed", "vendor"),
        ("approved", "admin"),
        ("proposed", "vendor"),
    ]
    assert events[1].actor_id == ADMIN_ID
    assert events[1].detail == {
        "from": {"state": "proposed", "agreed_bps": None, "proposed_bps": 1000},
        "to": {"state": "sent_back", "agreed_bps": None, "proposed_bps": 1000},
        "note": NOTE,
    }


async def test_an_admin_sets_a_rate_without_a_proposal(tenants: Tenants) -> None:
    body = terms(await admin(tenants, tenants.a, "set", {"commission_bps": 1250, "note": NOTE}))
    assert body == {"state": "agreed", "agreed_bps": 1250, "proposed_bps": None, "note": NOTE}
    seen = await tenants.api.http.get(admin_path(tenants.a), headers=bearer(tenants.admin_token))
    assert terms(seen) == body


async def test_approving_a_rate_that_changed_since_it_was_seen_is_a_409(
    tenants: Tenants, session: AsyncSession
) -> None:
    await propose(tenants, tenants.a, 1000)
    await session.commit()
    response = await admin(tenants, tenants.a, "approve", {"proposed_bps": 900})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "commission_changed"


@pytest.mark.parametrize(
    ("step", "body"), [("approve", {"proposed_bps": 1000}), ("send-back", {"note": NOTE})]
)
async def test_nothing_to_decide_without_a_proposal(
    tenants: Tenants, step: str, body: dict[str, Any]
) -> None:
    response = await admin(tenants, tenants.a, step, body)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_proposal"


@pytest.mark.parametrize("rate", [-1, 4001, 12.5, "12", None, True])
async def test_a_proposal_must_be_whole_basis_points_from_0_to_4000(
    tenants: Tenants, rate: Any
) -> None:
    response = await propose(tenants, tenants.a, rate)
    assert response.status_code == 422


async def test_proposing_the_agreed_rate_is_a_422(tenants: Tenants, session: AsyncSession) -> None:
    await admin(tenants, tenants.a, "set", {"commission_bps": 1200})
    await session.commit()
    response = await propose(tenants, tenants.a, 1200)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "rate_bps"]


async def test_only_the_owner_proposes(tenants: Tenants) -> None:
    response = await propose(tenants, tenants.a, 1000, tenants.a.staff_token)
    assert response.status_code == 403


@pytest.mark.parametrize(
    ("step", "body"),
    [
        ("send-back", {"note": "short"}),
        ("send-back", {}),
        ("set", {"commission_bps": 4001}),
        ("set", {"commission_bps": 1000, "note": "x" * 601}),
        ("set", {"commission_bps": 1000, "reviewer_id": str(ADMIN_ID)}),
        ("approve", {}),
        ("approve", {"proposed_bps": 1000, "extra": 1}),
    ],
)
async def test_bad_admin_bodies_are_422(
    tenants: Tenants, session: AsyncSession, step: str, body: dict[str, Any]
) -> None:
    await propose(tenants, tenants.a, 1000)
    await session.commit()
    assert (await admin(tenants, tenants.a, step, body)).status_code == 422


async def test_the_reviewer_is_the_token_never_the_body(
    tenants: Tenants, session: AsyncSession
) -> None:
    other = tenants.identity.token(
        ["vendor_reviewer"], subject=uuid.UUID("12345678-1234-1234-1234-123456789012")
    )
    await admin(tenants, tenants.a, "set", {"commission_bps": 1000}, token=other)
    event = await session.scalar(
        select(VendorChangeEvent).where(VendorChangeEvent.vendor_id == tenants.a.vendor.id)
    )
    assert event is not None
    assert str(event.actor_id) == "12345678-1234-1234-1234-123456789012"


async def test_vendor_tokens_cannot_use_the_admin_routes(tenants: Tenants) -> None:
    response = await admin(tenants, tenants.a, "set", {"commission_bps": 0}, tenants.a.owner_token)
    assert response.status_code == 401


async def test_a_brand_cannot_reach_another_brands_commission(tenants: Tenants) -> None:
    await propose(tenants, tenants.a, 1000)
    b = await tenants.api.http.get(MINE, headers=bearer(tenants.b.owner_token))
    assert terms(b) == NOT_SET


async def test_an_unknown_vendor_is_404(tenants: Tenants) -> None:
    response = await tenants.api.http.post(
        "/v1/admin/vendors/00000000-0000-0000-0000-000000000000/commission/set",
        json={"commission_bps": 1000},
        headers=bearer(tenants.admin_token),
    )
    assert response.status_code == 404


async def test_no_rate_for_a_rejected_application(tenants: Tenants, session: AsyncSession) -> None:
    await set_vendor_status(session, tenants.a.vendor, "rejected")
    await session.commit()
    response = await admin(tenants, tenants.a, "set", {"commission_bps": 1000})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "vendor_not_eligible"


async def test_reviewers_find_the_rates_to_review(tenants: Tenants) -> None:
    await propose(tenants, tenants.b, 1000)
    await admin(tenants, tenants.a, "set", {"commission_bps": 1200})
    response = await tenants.api.http.get(
        "/v1/admin/vendors?status=all&commission=proposed", headers=bearer(tenants.admin_token)
    )
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == str(tenants.b.vendor.id)
    assert page["items"][0]["commission"]["state"] == "proposed"

    not_set = await tenants.api.http.get(
        "/v1/admin/vendors?status=all&commission=not_set", headers=bearer(tenants.admin_token)
    )
    assert str(tenants.a.vendor.id) not in not_set.text
    assert str(tenants.b.vendor.id) not in not_set.text


async def test_proposals_are_rate_limited_per_vendor(tenants: Tenants) -> None:
    rule = tenants.api.app.state.settings.rate_limit_commission_proposal_vendor
    statuses = [
        (await propose(tenants, tenants.a, 1000 + n)).status_code for n in range(rule.limit + 1)
    ]
    assert statuses == [200] * rule.limit + [429]


async def test_the_database_refuses_an_impossible_state(
    session: AsyncSession, tenants: Tenants
) -> None:
    session.add(Commission(vendor_id=tenants.a.vendor.id, state="agreed", agreed_bps=None))
    with pytest.raises(Exception, match="state_whole"):
        await session.flush()
