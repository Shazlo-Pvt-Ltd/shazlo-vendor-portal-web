"""The two apps vendor-api runs as (ADR 0011): what each holds, and which browsers may call it.

The seller app serves the Vendor Portal; the admin app serves Shazlo One's Vendors module. Each
holds only what its routes need, so a leak or a crash in one does not hand over the other's keys,
and each accepts only its own front ends' origins.
"""

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from support import IDENTITY_ISSUER, JWKS_URL, Identity

from vendor_api.admin_app import create_admin_app
from vendor_api.app import create_seller_app
from vendor_api.core.settings import Settings

PORTAL = "https://vendors.shazlo.test"
MODULE = "https://vendor-admin.shazlo.test"
SHELL = "https://one.shazlo.test"


@pytest.fixture
async def apps(settings: Settings, override: Any) -> AsyncIterator[dict[str, FastAPI]]:
    redis = FakeAsyncRedis()
    both = override(
        settings,
        identity_jwks_url=JWKS_URL,
        identity_issuer=IDENTITY_ISSUER,
        jwt_issuer="https://vendor-api.test",
        cors_allowed_origins=[PORTAL],
        admin_cors_allowed_origins=[MODULE, SHELL],
    )
    yield {
        "seller": create_seller_app(both, readiness_checks={}, redis=redis),
        "admin": create_admin_app(
            both, readiness_checks={}, redis=redis, identity_keys=Identity().client
        ),
    }
    await redis.aclose()


async def preflight(app: FastAPI, origin: str, method: str = "GET") -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendor-api.test") as http:
        return await http.options(
            "/v1/admin/me" if app.title.endswith("(admin)") else "/v1/vendor/me",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "authorization",
            },
        )


def test_each_app_holds_only_what_its_routes_need(apps: dict[str, FastAPI]) -> None:
    seller, admin = apps["seller"].state, apps["admin"].state
    # The admin app issues no token, seals no payout number and rate-limits nothing.
    for name in ("keyring", "vendor_tokens", "payout_cipher", "passwords", "rate_limits"):
        assert not hasattr(admin, name), name
    assert not hasattr(admin, "sessions")  # it ends vendor sessions through `vendor_sessions`
    # The seller app verifies no admin token and makes no review decision.
    for name in ("token_verifier", "review_decisions", "review_queue", "vendor_accounts"):
        assert not hasattr(seller, name), name


def test_the_admin_app_writes_the_central_app_event_with_each_approval(
    apps: dict[str, FastAPI],
) -> None:
    state = apps["admin"].state
    assert state.outbox_writer.on_decision in state.review_decisions._hooks  # noqa: SLF001


async def test_the_seller_app_answers_only_the_portal_with_credentials(
    apps: dict[str, FastAPI],
) -> None:
    allowed = await preflight(apps["seller"], PORTAL)
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == PORTAL
    assert allowed.headers["access-control-allow-credentials"] == "true"
    for other in (MODULE, SHELL):
        refused = await preflight(apps["seller"], other)
        assert refused.status_code == 400
        assert "access-control-allow-origin" not in refused.headers


async def test_the_admin_app_answers_the_module_and_the_shell_without_credentials(
    apps: dict[str, FastAPI],
) -> None:
    for origin in (MODULE, SHELL):
        allowed = await preflight(apps["admin"], origin)
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == origin
        assert "access-control-allow-credentials" not in allowed.headers
    refused = await preflight(apps["admin"], PORTAL)
    assert refused.status_code == 400
    assert "access-control-allow-origin" not in refused.headers


async def test_the_admin_app_allows_only_get_and_post(apps: dict[str, FastAPI]) -> None:
    assert (await preflight(apps["admin"], MODULE, "POST")).status_code == 200
    for method in ("PUT", "PATCH", "DELETE"):
        assert (await preflight(apps["admin"], MODULE, method)).status_code == 400


def test_the_seller_app_refuses_to_start_without_its_keys_in_prod(settings: Settings) -> None:
    """The admin app and the worker may run without payout or rate-limit keys; the seller app
    may not."""
    from vendor_api.app import check_seller_settings

    # model_copy skips validation on purpose: this is what prod settings hold when both are unset.
    bare = settings.model_copy(update={"payout_encryption_keys": None, "rate_limit_hmac_key": None})
    with pytest.raises(RuntimeError, match="PAYOUT_ENCRYPTION_KEYS.*RATE_LIMIT_HMAC_KEY"):
        check_seller_settings(bare)
