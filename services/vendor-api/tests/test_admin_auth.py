import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from shazlo_security.tokens import TokenIssuer
from support import (
    ADMIN_ID,
    IDENTITY_ISSUER,
    JWKS_URL,
    Identity,
    identity_ring,
)

from vendor_api.api.admin import AdminRequest, Reviewer
from vendor_api.app import create_app
from vendor_api.core.security import token_issuer
from vendor_api.core.settings import Settings
from vendor_api.db.models import VendorUserRole

VENDOR_ID = uuid.UUID("9b2f1c3e-0d4a-4c1e-8f6a-2b7d5e9a1c30")
USER_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")


@pytest.fixture
def identity() -> Identity:
    return Identity()


@pytest.fixture
def admin_settings(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        identity_jwks_url=JWKS_URL,
        identity_issuer=IDENTITY_ISSUER,
        jwt_issuer="https://vendor-api.test",
    )
    return result


@pytest.fixture
async def client(admin_settings: Settings, identity: Identity) -> AsyncIterator[httpx.AsyncClient]:
    redis = FakeAsyncRedis()
    app = create_app(
        admin_settings, readiness_checks={}, redis=redis, identity_keys=identity.client
    )
    add_probe(app)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendor-api.test") as http:
        http.app = app  # type: ignore[attr-defined]
        yield http
    await redis.aclose()


class Decision(AdminRequest):
    note: str


def add_probe(app: FastAPI) -> None:
    """What a Phase 3 endpoint looks like: the reviewer comes from the token, the body forbids
    unknown fields."""

    @app.post("/v1/admin/probe")
    async def probe(body: Decision, admin: Reviewer) -> dict[str, str]:
        return {"reviewer_id": str(admin.id), "note": body.note}


def bearer(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


async def admin_me(client: httpx.AsyncClient, token: str | None) -> httpx.Response:
    return await client.get("/v1/admin/me", headers=bearer(token))


# --- Who may call ------------------------------------------------------------------------


async def test_a_vendor_reviewer_gets_their_id_and_roles_from_the_token(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    response = await admin_me(client, identity.token(["vendor_reviewer"]))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"id": str(ADMIN_ID), "roles": ["vendor_reviewer"]}


async def test_super_admin_always_passes(client: httpx.AsyncClient, identity: Identity) -> None:
    response = await admin_me(client, identity.token(["super_admin"]))
    assert response.status_code == 200
    assert response.json()["roles"] == ["super_admin"]


async def test_a_role_that_is_not_allowed_is_403(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    response = await admin_me(client, identity.token(["catalog_editor"]))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert (await admin_me(client, identity.token([]))).status_code == 403


async def test_a_token_that_only_allows_a_password_change_grants_nothing(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    token = identity.token(["super_admin"], must_change_password=True)  # carries no roles
    assert (await admin_me(client, token)).status_code == 403


@pytest.mark.parametrize("token", [None, "", "garbage", "a.b.c"])
async def test_no_token_or_a_garbled_one_is_401(
    client: httpx.AsyncClient, token: str | None
) -> None:
    response = await admin_me(client, token)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"


async def test_an_expired_token_is_401(client: httpx.AsyncClient, identity: Identity) -> None:
    old = datetime.now(UTC) - timedelta(hours=1)
    stale = TokenIssuer(IDENTITY_ISSUER, identity.ring, access_ttl_seconds=900, clock=lambda: old)
    assert (
        await admin_me(client, identity.token(["vendor_reviewer"], issuer=stale))
    ).status_code == 401


async def test_a_token_for_another_audience_is_401(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    for audience in ("identity-api", "vendor-portal"):
        token = identity.token(["super_admin"], audience=audience)
        assert (await admin_me(client, token)).status_code == 401


async def test_a_token_from_another_issuer_is_401(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    other = TokenIssuer("https://evil.test", identity.ring, access_ttl_seconds=900)
    assert (
        await admin_me(client, identity.token(["super_admin"], issuer=other))
    ).status_code == 401


async def test_a_token_signed_with_an_unknown_kid_is_401(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    stranger = TokenIssuer(IDENTITY_ISSUER, identity_ring("not-published"), access_ttl_seconds=900)
    assert (
        await admin_me(client, identity.token(["super_admin"], issuer=stranger))
    ).status_code == 401


# --- The two groups never accept each other's tokens -------------------------------------


async def test_a_vendor_token_is_401_on_the_admin_group(
    client: httpx.AsyncClient, admin_settings: Settings
) -> None:
    app: FastAPI = client.app  # type: ignore[attr-defined]
    vendor = app.state.vendor_tokens.issue(
        user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.OWNER
    )
    assert (await admin_me(client, vendor.token)).status_code == 401


async def test_an_identity_api_token_is_401_on_the_vendor_group(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    admin = identity.token(["super_admin", "vendor_reviewer"])
    response = await client.get("/v1/vendor/me", headers=bearer(admin))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


async def test_a_vendor_token_with_an_admin_role_name_is_still_not_an_admin(
    client: httpx.AsyncClient, admin_settings: Settings
) -> None:
    """Even if a vendor-api key signed a token that claims `super_admin`: the keys differ."""
    app: FastAPI = client.app  # type: ignore[attr-defined]
    forged = token_issuer(admin_settings, app.state.keyring).issue(
        subject=ADMIN_ID, roles=["super_admin"], audience="vendor-api"
    )
    assert (await admin_me(client, forged.token)).status_code == 401


# --- The reviewer is the token's, never the client's -------------------------------------


async def test_a_reviewer_id_in_the_body_is_rejected(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    headers = bearer(identity.token(["vendor_reviewer"]))
    spoofed = await client.post(
        "/v1/admin/probe", json={"note": "ok", "reviewer_id": str(uuid.uuid4())}, headers=headers
    )
    assert spoofed.status_code == 422
    assert spoofed.json()["error"]["code"] == "validation_error"


async def test_a_reviewer_id_in_the_query_or_a_header_is_never_used(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    other = str(uuid.uuid4())
    response = await client.post(
        f"/v1/admin/probe?reviewer_id={other}",
        json={"note": "ok"},
        headers={
            **bearer(identity.token(["vendor_reviewer"])),
            "X-Reviewer-Id": other,
            "X-Admin-Id": other,
        },
    )
    assert response.status_code == 200
    assert response.json()["reviewer_id"] == str(ADMIN_ID)  # the token's `sub`


async def test_an_admin_request_without_a_valid_token_never_reaches_the_handler(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post("/v1/admin/probe", json={"note": "ok"})
    assert response.status_code == 401


def test_admin_bodies_are_built_on_a_model_that_forbids_unknown_fields() -> None:
    assert AdminRequest.model_config["extra"] == "forbid"
    assert Decision.model_config["extra"] == "forbid"


# --- identity-api being down -------------------------------------------------------------


async def test_the_app_starts_and_stays_ready_while_identity_api_is_down(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    identity.jwks.down = True
    assert (await client.get("/health")).status_code == 200
    ready = await client.get("/ready")
    assert ready.status_code == 200  # /ready does not depend on identity-api
    assert identity.jwks.fetches == 0  # nothing was fetched at startup, nor by /ready


async def test_admin_requests_get_401_not_500_before_the_first_successful_fetch(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    identity.jwks.down = True
    response = await admin_me(client, identity.token(["vendor_reviewer"]))
    assert response.status_code == 401
    assert identity.jwks.fetches == 1
    # The vendor group does not care.
    assert (await client.get("/v1/vendor/me")).status_code == 401  # no token, but no 500 either


async def test_cached_keys_keep_working_while_identity_api_is_down(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    token = identity.token(["vendor_reviewer"])
    assert (await admin_me(client, token)).status_code == 200  # fetched once
    assert identity.jwks.fetches == 1

    identity.jwks.down = True
    identity.clock.now += 3600  # long past the 10-minute cache
    for _ in range(3):
        assert (await admin_me(client, token)).status_code == 200  # stale keys are kept
    # Fetches are bounded: the outage cannot turn into a request per token.
    assert identity.jwks.fetches <= 2


async def test_an_unknown_kid_during_an_outage_does_not_hammer_identity_api(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    assert (await admin_me(client, identity.token(["vendor_reviewer"]))).status_code == 200
    identity.jwks.down = True
    identity.clock.now += 120
    stranger = TokenIssuer(IDENTITY_ISSUER, identity_ring("new-key"), access_ttl_seconds=900)
    token = identity.token(["super_admin"], issuer=stranger)
    for _ in range(10):
        assert (await admin_me(client, token)).status_code == 401
    assert identity.jwks.fetches <= 3  # at most one refetch per minute, not one per request


async def test_a_rotated_key_is_picked_up_after_the_next_fetch(
    client: httpx.AsyncClient, identity: Identity, admin_settings: Settings
) -> None:
    assert (await admin_me(client, identity.token(["vendor_reviewer"]))).status_code == 200
    new = identity_ring("identity-key-2")
    rotated = TokenIssuer(IDENTITY_ISSUER, new, access_ttl_seconds=900)
    token = identity.token(["vendor_reviewer"], issuer=rotated)
    assert (await admin_me(client, token)).status_code == 401  # not published yet

    identity.jwks.ring = new  # identity-api publishes the new key
    identity.clock.now += 61  # past the refetch interval
    assert (await admin_me(client, token)).status_code == 200


# --- Without identity settings -----------------------------------------------------------


async def test_without_identity_settings_there_is_no_admin_group(settings: Settings) -> None:
    app = create_app(settings, readiness_checks={}, redis=FakeAsyncRedis())
    assert not hasattr(app.state, "token_verifier")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendor-api.test") as http:
        assert (await http.get("/v1/admin/me")).status_code == 404
        assert (await http.get("/health")).status_code == 200


async def test_the_verifier_is_built_once_per_process(
    client: httpx.AsyncClient, identity: Identity
) -> None:
    app: FastAPI = client.app  # type: ignore[attr-defined]
    verifier = app.state.token_verifier
    for _ in range(3):
        await admin_me(client, identity.token(["vendor_reviewer"]))
    assert app.state.token_verifier is verifier
