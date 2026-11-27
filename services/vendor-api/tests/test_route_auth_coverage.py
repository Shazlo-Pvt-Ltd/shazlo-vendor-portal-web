"""Every route of both apps, probed over HTTP: none is reachable without the right token.

`test_isolation_structure.py` inspects the module routers, which misses a router nested with
`include_router`, a prefix given only when a router is mounted, and the admin group. These tests
ask the app itself (its OpenAPI document lists every operation, however the routers were put
together), so a Phase 3 route that forgets its auth dependency fails here.

vendor-api runs as two apps (ADR 0011): the seller app takes only vendor tokens and holds no
identity-api verifier; the admin app takes only identity-api tokens. Each is probed on its own.
"""

import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import jwt
import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from shazlo_security.keys import ALGORITHM, generate_private_key
from support import IDENTITY_ISSUER, JWKS_URL, Identity

from vendor_api.admin_app import create_admin_app
from vendor_api.app import create_seller_app
from vendor_api.core.settings import Settings
from vendor_api.db.models import VendorUserRole

# The only operations that work without a token, per app. Adding one is a decision to review.
PUBLIC = {
    "seller": {
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
        # The bank behind an IFSC, from a bundled list (#265): sign-up asks before any account
        # exists. Limited per IP; reveals nothing about any vendor.
        ("GET", "/v1/public/ifsc/{code}"),
    },
    "admin": {("GET", "/health"), ("GET", "/ready")},
}
PARAM = re.compile(r"\{[^}]+\}")
SOME_ID = "00000000-0000-4000-8000-000000000000"


@pytest.fixture
def identity() -> Identity:
    return Identity()


@pytest.fixture
async def apps(
    settings: Settings, override: Any, identity: Identity
) -> AsyncIterator[dict[str, FastAPI]]:
    redis = FakeAsyncRedis()
    app_settings = override(
        settings,
        identity_jwks_url=JWKS_URL,
        identity_issuer=IDENTITY_ISSUER,
        jwt_issuer="https://vendor-api.test",
    )
    yield {
        "seller": create_seller_app(app_settings, readiness_checks={}, redis=redis),
        "admin": create_admin_app(
            app_settings, readiness_checks={}, redis=redis, identity_keys=identity.client
        ),
    }
    await redis.aclose()


@pytest.fixture
def seller(apps: dict[str, FastAPI]) -> FastAPI:
    return apps["seller"]


@pytest.fixture
def admin(apps: dict[str, FastAPI]) -> FastAPI:
    return apps["admin"]


def operations(app: FastAPI) -> list[tuple[str, str]]:
    found = []
    for path, item in app.openapi()["paths"].items():
        for method in item:
            if method in {"get", "post", "put", "patch", "delete"}:
                found.append((method.upper(), path))
    return found


def routed_paths(app: FastAPI) -> set[str]:
    """Every path the app routes, from its route table rather than its OpenAPI document, so a
    route left out of the document cannot hide."""
    return {str(getattr(route, "path", "")) for route in app.routes}


async def call(app: FastAPI, method: str, path: str, token: str | None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendor-api.test") as http:
        return await http.request(method, PARAM.sub(SOME_ID, path), json={}, headers=headers)


def protected(app: FastAPI, surface: str) -> list[tuple[str, str]]:
    return [op for op in operations(app) if op not in PUBLIC[surface]]


def vendor_token(seller: FastAPI) -> str:
    issued = seller.state.vendor_tokens.issue(
        user_id=uuid.uuid4(), vendor_id=uuid.uuid4(), role=VendorUserRole.OWNER
    )
    return str(issued.token)


async def test_each_app_serves_only_its_own_group(seller: FastAPI, admin: FastAPI) -> None:
    seller_paths = {path for _, path in protected(seller, "seller")}
    assert any(path.startswith("/v1/vendor") for path in seller_paths)
    assert any(path.startswith("/v1/auth") for path in seller_paths)  # change-password, me
    assert not any(path.startswith("/v1/admin") for path in routed_paths(seller))
    admin_paths = {path for _, path in protected(admin, "admin")}
    assert admin_paths
    assert all(path.startswith("/v1/admin/") for path in admin_paths)
    assert not any(path.startswith(("/v1/vendor", "/v1/auth")) for path in routed_paths(admin))
    # Every public entry still exists: a renamed route must not leave a stale exemption.
    assert set(PUBLIC["seller"]) <= set(operations(seller))
    assert set(PUBLIC["admin"]) <= set(operations(admin))


async def test_neither_app_answers_the_other_apps_routes(seller: FastAPI, admin: FastAPI) -> None:
    assert (await call(seller, "GET", "/v1/admin/me", None)).status_code == 404
    assert (await call(admin, "GET", "/v1/vendor/me", None)).status_code == 404
    assert (await call(admin, "POST", "/v1/auth/login", None)).status_code == 404
    assert (await call(admin, "GET", "/.well-known/jwks.json", None)).status_code == 404


async def test_only_the_admin_app_holds_an_identity_verifier(
    seller: FastAPI, admin: FastAPI
) -> None:
    assert not hasattr(seller.state, "token_verifier")
    assert hasattr(admin.state, "token_verifier")


@pytest.mark.parametrize("surface", ["seller", "admin"])
async def test_no_protected_route_answers_without_a_token(
    apps: dict[str, FastAPI], surface: str
) -> None:
    app = apps[surface]
    answers = {op: (await call(app, *op, None)).status_code for op in protected(app, surface)}
    assert {op: status for op, status in answers.items() if status != 401} == {}


async def test_a_vendor_token_opens_no_admin_route(seller: FastAPI, admin: FastAPI) -> None:
    token = vendor_token(seller)
    ops = protected(admin, "admin")
    answers = {op: (await call(admin, *op, token)).status_code for op in ops}
    assert {op: status for op, status in answers.items() if status != 401} == {}


async def test_an_admin_token_opens_no_seller_route(seller: FastAPI, identity: Identity) -> None:
    token = identity.token(["super_admin", "vendor_reviewer"])
    ops = protected(seller, "seller")
    answers = {op: (await call(seller, *op, token)).status_code for op in ops}
    assert {op: status for op, status in answers.items() if status != 401} == {}


@pytest.mark.parametrize(
    ("roles", "pending_password"),
    [(["support"], False), ([], False), (["super_admin"], True)],
    ids=["another-role", "no-role", "password-change-pending"],
)
async def test_an_admin_token_without_a_reviewer_role_opens_no_admin_route(
    admin: FastAPI, identity: Identity, roles: list[str], pending_password: bool
) -> None:
    """A valid identity-api token is not enough: every admin route needs a role that allows it,
    and a token that only allows a password change opens none. A route mounted under /v1/admin
    without the group's role check fails here."""
    token = identity.token(roles, must_change_password=pending_password)
    admin_ops = protected(admin, "admin")
    assert admin_ops
    answers = {op: (await call(admin, *op, token)).status_code for op in admin_ops}
    assert {op: status for op, status in answers.items() if status != 403} == {}


async def test_a_tampered_or_foreign_token_opens_nothing(
    apps: dict[str, FastAPI], identity: Identity
) -> None:
    """A vendor token with a garbled signature, the same token re-signed by a key vendor-api does
    not hold, and an admin token for another audience are all refused everywhere, as if there
    were no token."""
    vendor = vendor_token(apps["seller"])
    header, payload, signature = vendor.split(".")
    # Not valid base64 for a signature: refused before the signature is even checked.
    garbled = f"{header}.{payload}.{signature[::-1]}"
    # The same header (kid included) and claims, correctly signed, but by another key: only the
    # signature check can refuse this one.
    resigned = jwt.encode(
        jwt.decode(vendor, options={"verify_signature": False}),
        generate_private_key(),
        algorithm=ALGORITHM,
        headers={"kid": jwt.get_unverified_header(vendor)["kid"]},
    )
    foreign = identity.token(["super_admin"], audience="identity-api")
    for surface, app in apps.items():
        for token in (garbled, resigned, foreign):
            ops = protected(app, surface)
            answers = {op: (await call(app, *op, token)).status_code for op in ops}
            assert {op: status for op, status in answers.items() if status != 401} == {}


async def test_the_probe_catches_a_nested_router_without_auth(seller: FastAPI) -> None:
    """The case the module-router check misses: a router nested inside another, given its
    prefix only when it is mounted."""
    from fastapi import APIRouter

    inner = APIRouter()

    @inner.get("/leak")
    async def leak() -> dict[str, str]:
        return {"secret": "yes"}

    outer = APIRouter()
    outer.include_router(inner, prefix="/probe-widgets")
    seller.include_router(outer, prefix="/v1/vendor")
    seller.openapi_schema = None  # rebuild the cached document
    ops = protected(seller, "seller")
    answers = {op: (await call(seller, *op, None)).status_code for op in ops}
    assert answers[("GET", "/v1/vendor/probe-widgets/leak")] == 200
