"""The admin app: the backend of Shazlo One's Vendors module (ADR 0011).

It serves `/v1/admin/*` and the probes, nothing else. It accepts only identity-api tokens
(`aud=vendor-api`, verified through identity-api's JWKS) and refuses to start without them. It
holds no vendor signing key, no payout key and no rate-limit key: it issues no tokens, reads payout
details only masked, and ends vendor sessions through the refresh store alone.
"""

from fastapi import APIRouter, FastAPI
from redis.asyncio import Redis
from shazlo_auth import JwksClient, KeySource, TokenVerifier
from shazlo_security.refresh_tokens import RefreshTokenStore

from vendor_api.api import (
    admin,
    admin_commission,
    admin_module_summary,
    admin_outbox,
    admin_reviews,
    admin_summary,
    admin_vendors,
    health,
)
from vendor_api.app_common import add_common_state, add_middleware, new_app
from vendor_api.core.security import refresh_token_config
from vendor_api.core.settings import Settings, get_settings
from vendor_api.services.admin_summary import AdminSummaryService
from vendor_api.services.auth import VendorSessions
from vendor_api.services.outbox_admin import OutboxAdminService
from vendor_api.services.review_decisions import ReviewDecisionService
from vendor_api.services.review_queue import ReviewQueueService
from vendor_api.services.tokens import VENDOR_AUDIENCE
from vendor_api.services.vendor_accounts import VendorAccountService

# The audience names the logical service, which runs as two apps (ADR 0011); identity-api's
# AUDIENCE_ROLES still maps `vendor-api` to super_admin and vendor_reviewer.
ADMIN_AUDIENCE = VENDOR_AUDIENCE


def check_admin_settings(settings: Settings) -> tuple[str, str]:
    """What only the admin app needs (the seller app and the worker never read these). Returns
    identity-api's JWKS URL and issuer."""
    jwks_url, issuer = settings.identity_jwks_url, settings.identity_issuer
    if not (jwks_url and issuer):
        raise RuntimeError("the admin app needs IDENTITY_JWKS_URL and IDENTITY_ISSUER")
    if settings.env == "prod":
        plain = [o for o in settings.admin_cors_allowed_origins if not o.startswith("https://")]
        if plain:
            raise RuntimeError("ADMIN_CORS_ALLOWED_ORIGINS must be https in prod")
    return jwks_url, issuer


def create_admin_app(
    settings: Settings | None = None,
    readiness_checks: dict[str, health.ReadinessCheck] | None = None,
    redis: Redis | None = None,
    identity_keys: KeySource | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    jwks_url, issuer = check_admin_settings(settings)
    app = new_app(settings, "vendor-api (admin)")
    add_common_state(app, settings, redis=redis, readiness_checks=readiness_checks)
    # One client per process, created here and never per request. It fetches nothing now: the
    # first admin token triggers the first fetch, so a down identity-api cannot stop this app
    # from starting.
    keys = identity_keys or JwksClient.from_url(jwks_url, allow_insecure=settings.env == "dev")
    app.state.token_verifier = TokenVerifier(keys, issuer=issuer, audience=ADMIN_AUDIENCE)
    app.state.review_queue = ReviewQueueService()
    app.state.review_decisions = ReviewDecisionService()
    # An approval writes its central-app event in the same transaction (ADR 0003, section 5).
    app.state.review_decisions.add_hook(app.state.outbox_writer.on_decision)
    app.state.outbox_admin = OutboxAdminService()
    app.state.admin_summary = AdminSummaryService()
    # The seller app's refresh store (same Redis, same `vendor:` prefix): suspending or rejecting
    # a vendor ends its sessions there.
    app.state.refresh_tokens = RefreshTokenStore(app.state.redis, refresh_token_config(settings))
    app.state.vendor_sessions = VendorSessions(app.state.refresh_tokens)
    app.state.vendor_accounts = VendorAccountService(
        app.state.vendor_sessions, events=app.state.outbox_writer
    )

    # Bearer tokens only, never cookies: no credentials. Every admin route is a GET or a POST.
    add_middleware(
        app,
        origins=settings.admin_cors_allowed_origins,
        credentials=False,
        methods=["GET", "POST"],
    )

    app.include_router(health.router)
    v1 = APIRouter(prefix="/v1")
    v1.include_router(admin.router)
    v1.include_router(admin_reviews.router)
    v1.include_router(admin_vendors.router)
    v1.include_router(admin_commission.router)
    v1.include_router(admin_outbox.router)
    v1.include_router(admin_summary.router)
    v1.include_router(admin_module_summary.router)
    app.include_router(v1)
    return app
