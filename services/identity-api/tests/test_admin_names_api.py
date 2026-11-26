# ruff: noqa: F811  (fixtures imported from test_admins_api are redefined as test parameters)
"""`GET /v1/admins/names`: a display name for an admin id, for any signed-in admin (#299)."""

import uuid
from collections.abc import Callable
from typing import Any

import httpx
from test_admins_api import (  # noqa: F401  (fixtures)
    REVIEWER,
    api_settings,
    bearer,
    boss,
    client,
    login,
    make_admin,
    redis,
)

from identity_api.db.models import Admin

NAMES = "/v1/admins/names"


async def reviewer_headers(
    make_admin: Callable[..., Any], client: httpx.AsyncClient
) -> tuple[Admin, dict[str, str]]:
    admin = await make_admin(REVIEWER, display_name="Priya Mehta")
    return admin, bearer(await login(client, REVIEWER))


async def test_a_reviewer_can_look_up_names(
    make_admin: Callable[..., Any], client: httpx.AsyncClient
) -> None:
    admin, headers = await reviewer_headers(make_admin, client)
    other = await make_admin("other@shazlo.test", display_name="Arjun Rao")
    response = await client.get(
        NAMES, params=[("ids", str(admin.id)), ("ids", str(other.id))], headers=headers
    )
    assert response.status_code == 200
    assert {i["id"]: i["display_name"] for i in response.json()["items"]} == {
        str(admin.id): "Priya Mehta",
        str(other.id): "Arjun Rao",
    }
    assert response.headers["cache-control"] == "no-store"


async def test_only_the_id_and_the_name_are_returned(
    make_admin: Callable[..., Any], client: httpx.AsyncClient
) -> None:
    admin, headers = await reviewer_headers(make_admin, client)
    response = await client.get(NAMES, params={"ids": str(admin.id)}, headers=headers)
    assert set(response.json()["items"][0]) == {"id", "display_name"}


async def test_unknown_ids_are_left_out(
    make_admin: Callable[..., Any], client: httpx.AsyncClient
) -> None:
    admin, headers = await reviewer_headers(make_admin, client)
    response = await client.get(
        NAMES, params=[("ids", str(admin.id)), ("ids", str(uuid.uuid4()))], headers=headers
    )
    assert [i["id"] for i in response.json()["items"]] == [str(admin.id)]


async def test_a_deactivated_admin_still_has_a_name(
    make_admin: Callable[..., Any], client: httpx.AsyncClient
) -> None:
    _, headers = await reviewer_headers(make_admin, client)
    gone = await make_admin("gone@shazlo.test", display_name="Gone Admin", is_active=False)
    response = await client.get(NAMES, params={"ids": str(gone.id)}, headers=headers)
    assert response.json()["items"][0]["display_name"] == "Gone Admin"


async def test_a_repeated_id_is_answered_once(
    make_admin: Callable[..., Any], client: httpx.AsyncClient
) -> None:
    admin, headers = await reviewer_headers(make_admin, client)
    response = await client.get(
        NAMES, params=[("ids", str(admin.id)), ("ids", str(admin.id))], headers=headers
    )
    assert len(response.json()["items"]) == 1


async def test_a_super_admin_can_look_up_names_too(
    boss: dict[str, str], client: httpx.AsyncClient
) -> None:
    response = await client.get(NAMES, params={"ids": str(uuid.uuid4())}, headers=boss)
    assert response.status_code == 200
    assert response.json() == {"items": []}


async def test_no_token_is_401(client: httpx.AsyncClient) -> None:
    response = await client.get(NAMES, params={"ids": str(uuid.uuid4())})
    assert response.status_code == 401


async def test_bad_ids_are_422(make_admin: Callable[..., Any], client: httpx.AsyncClient) -> None:
    _, headers = await reviewer_headers(make_admin, client)
    assert (await client.get(NAMES, params={"ids": "nope"}, headers=headers)).status_code == 422
    assert (await client.get(NAMES, headers=headers)).status_code == 422
    too_many: list[tuple[str, str | int | float | bool | None]] = [
        ("ids", str(uuid.uuid4())) for _ in range(101)
    ]
    assert (await client.get(NAMES, params=too_many, headers=headers)).status_code == 422


async def test_the_names_route_is_not_taken_for_an_admin_id(
    boss: dict[str, str], client: httpx.AsyncClient
) -> None:
    # `/admins/names` is the lookup, not `/admins/{admin_id}` with a bad id (which is a 422).
    response = await client.get(NAMES, params={"ids": str(uuid.uuid4())}, headers=boss)
    assert response.status_code == 200
