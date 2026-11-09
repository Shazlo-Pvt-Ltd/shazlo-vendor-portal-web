"""Vendor A cannot read, change or learn about vendor B's data through any endpoint.

Every vendor-scoped endpoint is covered here. When Phase 3 adds one, add its path to
`ACTIONS` (or write a test beside these with the `tenants` fixture): the answer for another
vendor's object must be the same 404 as for an id that does not exist.
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import without_request_id

from vendor_api.db.models import VendorUser


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# Every endpoint that takes a user id of the caller's own vendor: (name, method, path, body).
ACTIONS: list[tuple[str, str, str, dict[str, Any] | None]] = [
    ("disable", "PATCH", "/v1/vendor/users/{id}", {"disabled": True}),
    ("enable", "PATCH", "/v1/vendor/users/{id}", {"disabled": False}),
    ("resend-invite", "POST", "/v1/vendor/users/{id}/resend-invite", None),
]


async def act(
    tenants: Tenants, token: str, action: tuple[str, str, str, Any], user_id: uuid.UUID
) -> httpx.Response:
    _, method, path, body = action
    return await tenants.api.http.request(
        method, path.format(id=user_id), json=body, headers=bearer(token)
    )


async def snapshot(session: AsyncSession, tenant: Tenant) -> list[tuple[Any, ...]]:
    rows = await session.scalars(
        select(VendorUser)
        .where(VendorUser.vendor_id == tenant.vendor.id)
        .order_by(VendorUser.email)
        .execution_options(populate_existing=True)
    )
    return [(u.id, u.email, u.role, u.status, u.password_hash) for u in rows]


# --- Reading -----------------------------------------------------------------------------


async def test_me_is_always_the_callers_own_vendor(tenants: Tenants) -> None:
    for tenant, other in ((tenants.a, tenants.b), (tenants.b, tenants.a)):
        response = await tenants.api.http.get("/v1/vendor/me", headers=bearer(tenant.owner_token))
        assert response.json()["vendor"]["id"] == str(tenant.vendor.id)
        assert str(other.vendor.id) not in response.text
        assert other.owner.email not in response.text


async def test_me_ignores_any_vendor_id_the_client_sends(tenants: Tenants) -> None:
    response = await tenants.api.http.get(
        f"/v1/vendor/me?vendor_id={tenants.b.vendor.id}",
        headers={**bearer(tenants.a.owner_token), "X-Vendor-Id": str(tenants.b.vendor.id)},
    )
    assert response.status_code == 200
    assert response.json()["vendor"]["id"] == str(tenants.a.vendor.id)


async def test_the_staff_list_holds_only_the_callers_vendor(tenants: Tenants) -> None:
    for tenant, other in ((tenants.a, tenants.b), (tenants.b, tenants.a)):
        response = await tenants.api.http.get(
            "/v1/vendor/users", headers=bearer(tenant.owner_token)
        )
        assert response.status_code == 200
        assert {user["email"] for user in response.json()} == {u.email for u in tenant.users}
        for user in other.users:
            assert user.email not in response.text
            assert str(user.id) not in response.text


async def test_a_list_cannot_be_widened_with_a_query(tenants: Tenants) -> None:
    response = await tenants.api.http.get(
        f"/v1/vendor/users?vendor_id={tenants.b.vendor.id}&all=true",
        headers=bearer(tenants.a.owner_token),
    )
    assert {user["email"] for user in response.json()} == {u.email for u in tenants.a.users}


# --- Changing: by a valid id of the other vendor -----------------------------------------


@pytest.mark.parametrize("action", ACTIONS, ids=[a[0] for a in ACTIONS])
async def test_another_vendors_user_is_a_404_for_every_action_and_stays_untouched(
    tenants: Tenants, session: AsyncSession, action: tuple[str, str, str, Any]
) -> None:
    before = await snapshot(session, tenants.b)
    for user in tenants.b.users:  # the owner, a staff member and an invited one
        response = await act(tenants, tenants.a.owner_token, action, user.id)
        assert response.status_code == 404, (action[0], user.email)
        assert response.json()["error"]["code"] == "user_not_found"
    assert await snapshot(session, tenants.b) == before


@pytest.mark.parametrize("action", ACTIONS, ids=[a[0] for a in ACTIONS])
async def test_it_works_the_same_the_other_way_round(
    tenants: Tenants, session: AsyncSession, action: tuple[str, str, str, Any]
) -> None:
    before = await snapshot(session, tenants.a)
    for user in tenants.a.users:
        assert (await act(tenants, tenants.b.owner_token, action, user.id)).status_code == 404
    assert await snapshot(session, tenants.a) == before


@pytest.mark.parametrize("action", ACTIONS, ids=[a[0] for a in ACTIONS])
async def test_another_vendors_id_and_an_id_that_does_not_exist_look_exactly_alike(
    tenants: Tenants, action: tuple[str, str, str, Any]
) -> None:
    """Nothing in the answer tells a vendor that an id exists in someone else's data."""
    unknown = await act(tenants, tenants.a.owner_token, action, uuid.uuid4())
    for user in tenants.b.users:
        foreign = await act(tenants, tenants.a.owner_token, action, user.id)
        assert foreign.status_code == unknown.status_code == 404
        assert without_request_id(foreign) == without_request_id(unknown)
        assert foreign.headers.get("cache-control") == unknown.headers.get("cache-control")


# --- Guessing ----------------------------------------------------------------------------


async def test_guessed_ids_never_reach_another_vendor(
    tenants: Tenants, session: AsyncSession
) -> None:
    before = await snapshot(session, tenants.b)
    for _ in range(5):
        for action in ACTIONS:
            response = await act(tenants, tenants.a.owner_token, action, uuid.uuid4())
            assert response.status_code == 404
    assert await snapshot(session, tenants.b) == before


# --- A staff member cannot even find out ------------------------------------------------


async def test_staff_get_the_same_403_for_their_own_other_vendors_and_unknown_ids(
    tenants: Tenants,
) -> None:
    ids = [tenants.a.owner.id, tenants.b.owner.id, uuid.uuid4()]
    for action in ACTIONS:
        answers = [await act(tenants, tenants.a.staff_token, action, user_id) for user_id in ids]
        assert {answer.status_code for answer in answers} == {403}
        assert all(without_request_id(a) == without_request_id(answers[0]) for a in answers)


# --- Creating ----------------------------------------------------------------------------


async def test_an_invite_always_lands_in_the_callers_vendor(
    tenants: Tenants, session: AsyncSession
) -> None:
    response = await tenants.api.http.post(
        "/v1/vendor/users",
        json={"email": "newcomer@a.test"},
        headers=bearer(tenants.a.owner_token),
    )
    assert response.status_code == 202
    user = await session.scalar(
        select(VendorUser)
        .where(VendorUser.email == "newcomer@a.test")
        .execution_options(populate_existing=True)
    )
    assert user is not None
    assert user.vendor_id == tenants.a.vendor.id
    # There is no way to ask for another vendor: the body forbids unknown fields.
    spoofed = await tenants.api.http.post(
        "/v1/vendor/users",
        json={"email": "second@a.test", "vendor_id": str(tenants.b.vendor.id)},
        headers=bearer(tenants.a.owner_token),
    )
    assert spoofed.status_code == 422


async def test_a_vendor_cannot_learn_that_an_address_is_registered_with_another_vendor(
    tenants: Tenants,
) -> None:
    taken = await tenants.api.http.post(
        "/v1/vendor/users",
        json={"email": tenants.b.owner.email},
        headers=bearer(tenants.a.owner_token),
    )
    free = await tenants.api.http.post(
        "/v1/vendor/users",
        json={"email": "nobody.has.this@a.test"},
        headers=bearer(tenants.a.owner_token),
    )
    assert taken.status_code == free.status_code == 202
    assert taken.json() == free.json()


# --- Tokens of the wrong kind ------------------------------------------------------------


async def test_an_admin_token_is_not_a_vendor_and_a_vendor_token_is_not_an_admin(
    tenants: Tenants,
) -> None:
    http = tenants.api.http
    for path in ("/v1/vendor/me", "/v1/vendor/users"):
        assert (await http.get(path, headers=bearer(tenants.admin_token))).status_code == 401
    assert (await http.get("/v1/admin/me", headers=bearer(tenants.admin_token))).status_code == 200
    assert (
        await http.get("/v1/admin/me", headers=bearer(tenants.a.owner_token))
    ).status_code == 401


async def test_a_users_token_does_not_follow_them_to_another_vendor(
    tenants: Tenants, session: AsyncSession
) -> None:
    """A token whose vendor is not the user's vendor is refused, whichever vendor it names."""
    tokens = tenants.api.app.state.vendor_tokens
    from vendor_api.db.models import VendorUserRole

    mixed = tokens.issue(
        user_id=tenants.a.owner.id, vendor_id=tenants.b.vendor.id, role=VendorUserRole.OWNER
    )
    response = await tenants.api.http.get("/v1/vendor/users", headers=bearer(mixed.token))
    assert response.status_code == 401
    assert tenants.b.owner.email not in response.text
