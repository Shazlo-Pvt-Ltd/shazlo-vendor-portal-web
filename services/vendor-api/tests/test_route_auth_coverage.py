"""Every route of the assembled app, probed over HTTP: none is reachable without the right token.

`test_isolation_structure.py` inspects the module routers, which misses a router nested with
`include_router`, a prefix given only when a router is mounted, and the admin group. These tests
ask the app itself (its OpenAPI document lists every operation, however the routers were put
together), so a Phase 3 route that forgets its auth dependency fails here.
"""

import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from support import IDENTITY_ISSUER, JWKS_URL, Identity

from vendor_api.app import create_app
from vendor_api.core.settings import Settings
from vendor_api.db.models import VendorUserRole

# The only operations that work without a token. Adding one here is a decision to review.
PUBLIC = {
    ("GET", "/health"),
    ("GET", "/ready"),
    ("GET", "/.well-known/jwks.json"),
    ("POST", "/v1/auth/signup"),
    ("POST", "/v1/auth/verify-email"),
    ("POST", "/v1/auth/resend-verification"),
    ("POST", "/v1/auth/login"),
    ("POST", "/v1/auth/forgot-password"),
    ("POST", "/v1/auth/set-password"),
    # Authenticated by the refresh cookie (plus an Origin check), not a bearer token.
    ("POST", "/v1/auth/refresh"),
    ("POST", "/v1/auth/logout"),
}
PARAM = re.compile(r"\{[^}]+\}")
SOME_ID = "00000000-0000-4000-8000-000000000000"


@pytest.fixture
def identity() -> Identity:
    return Identity()


@pytest.fixture
async def app(settings: Settings, override: Any, identity: Identity) -> AsyncIterator[FastAPI]:
    redis = FakeAsyncRedis()
    app_settings = override(
        settings,
        identity_jwks_url=JWKS_URL,
        identity_issuer=IDENTITY_ISSUER,
        jwt_issuer="https://vendor-api.test",
    )
    yield create_app(app_settings, readiness_checks={}, redis=redis, identity_keys=identity.client)
    await redis.aclose()


def operations(app: FastAPI) -> list[tuple[str, str]]:
    found = []
    for path, item in app.openapi()["paths"].items():
        for method in item:
            if method in {"get", "post", "put", "patch", "delete"}:
                found.append((method.upper(), path))
    return found


async def call(app: FastAPI, method: str, path: str, token: str | None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendor-api.test") as http:
        return await http.request(method, PARAM.sub(SOME_ID, path), json={}, headers=headers)


def protected(app: FastAPI) -> list[tuple[str, str]]:
    return [op for op in operations(app) if op not in PUBLIC]


async def test_the_probe_sees_every_group(app: FastAPI) -> None:
    paths = {path for _, path in protected(app)}
    assert any(path.startswith("/v1/vendor") for path in paths)
    assert any(path.startswith("/v1/admin") for path in paths)
    assert any(path.startswith("/v1/auth") for path in paths)  # change-password, me
    # Every public entry still exists: a renamed route must not leave a stale exemption.
    assert set(PUBLIC) <= set(operations(app))


async def test_no_protected_route_answers_without_a_token(app: FastAPI) -> None:
    answers = {op: (await call(app, *op, None)).status_code for op in protected(app)}
    assert {op: status for op, status in answers.items() if status != 401} == {}


async def test_a_vendor_token_opens_no_admin_route(app: FastAPI) -> None:
    vendor = app.state.vendor_tokens.issue(
        user_id=uuid.uuid4(), vendor_id=uuid.uuid4(), role=VendorUserRole.OWNER
    )
    admin_ops = [op for op in protected(app) if op[1].startswith("/v1/admin")]
    answers = {op: (await call(app, *op, vendor.token)).status_code for op in admin_ops}
    assert {op: status for op, status in answers.items() if status != 401} == {}


async def test_an_admin_token_opens_no_vendor_or_auth_route(
    app: FastAPI, identity: Identity
) -> None:
    admin = identity.token(["super_admin", "vendor_reviewer"])
    vendor_ops = [op for op in protected(app) if not op[1].startswith("/v1/admin")]
    answers = {op: (await call(app, *op, admin)).status_code for op in vendor_ops}
    assert {op: status for op, status in answers.items() if status != 401} == {}


async def test_the_probe_catches_a_nested_router_without_auth(app: FastAPI) -> None:
    """The case the module-router check misses: a router nested inside another, given its
    prefix only when it is mounted."""
    from fastapi import APIRouter

    inner = APIRouter()

    @inner.get("/leak")
    async def leak() -> dict[str, str]:
        return {"secret": "yes"}

    outer = APIRouter()
    outer.include_router(inner, prefix="/probe-widgets")
    app.include_router(outer, prefix="/v1/vendor")
    app.openapi_schema = None  # rebuild the cached document
    answers = {op: (await call(app, *op, None)).status_code for op in protected(app)}
    assert answers[("GET", "/v1/vendor/probe-widgets/leak")] == 200
