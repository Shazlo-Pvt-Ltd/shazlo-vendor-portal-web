"""The seller app: the Vendor Portal's backend (ADR 0011).

It serves `/v1/auth`, `/v1/vendor/*`, `/v1/public/*`, the vendor JWKS and the probes, and never
`/v1/admin/*` (that is the admin app, `vendor_api.admin_app`). It accepts only vendor tokens: it
has no identity-api verifier at all.
"""

import httpx
from fastapi import APIRouter, FastAPI
from redis.asyncio import Redis
from shazlo_security.client_ip import parse_networks
from shazlo_security.keys import load_keyring
from shazlo_security.passwords import PasswordService
from shazlo_security.rate_limit import RateLimitGuard, RedisRateLimiter
from shazlo_security.refresh_tokens import RefreshTokenStore

from vendor_api.api import (
    assets,
    auth,
    brand_profile,
    commission,
    health,
    jwks,
    product_import,
    products,
    public,
    size_charts,
    store_details,
    submissions,
    team,
    vendor,
)
from vendor_api.app_common import add_common_state, add_middleware, new_app
from vendor_api.core.security import (
    RATE_LIMIT_KEY_PREFIX,
    key_ring_config,
    password_config,
    rate_limit_config,
    refresh_token_config,
    token_issuer,
)
from vendor_api.core.settings import Settings, get_settings
from vendor_api.services.assets import AssetService
from vendor_api.services.auth import AuthService
from vendor_api.services.brand_profiles import BrandProfileService
from vendor_api.services.cloudinary import CloudinaryClient, ImageHost
from vendor_api.services.credentials import CredentialService
from vendor_api.services.payout_cipher import PayoutCipher, parse_keys
from vendor_api.services.product_import import ProductImportService
from vendor_api.services.products import ProductService
from vendor_api.services.signup import SignupService
from vendor_api.services.size_charts import SizeChartService
from vendor_api.services.store_details import StoreDetailsService
from vendor_api.services.submissions import SubmissionService
from vendor_api.services.team import TeamService
from vendor_api.services.tokens import VendorTokens


def check_seller_settings(settings: Settings) -> None:
    """What only the seller app needs. Settings leave these unset in prod when they are missing
    (the admin app and the worker never hold them), so the seller app refuses to start here."""
    missing = []
    if settings.payout_encryption_keys is None or settings.payout_encryption_kid is None:
        missing.append("PAYOUT_ENCRYPTION_KEYS and PAYOUT_ENCRYPTION_KID")
    if settings.rate_limit_hmac_key is None:
        missing.append("RATE_LIMIT_HMAC_KEY")
    if missing:
        raise RuntimeError("the seller app needs " + "; ".join(missing))


def create_seller_app(
    settings: Settings | None = None,
    readiness_checks: dict[str, health.ReadinessCheck] | None = None,
    redis: Redis | None = None,
    image_host: ImageHost | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    check_seller_settings(settings)
    app = new_app(settings, "vendor-api")
    # Keys are loaded now, so a missing or broken key stops the service at startup.
    app.state.keyring = load_keyring(key_ring_config(settings))
    app.state.vendor_tokens = VendorTokens(
        token_issuer(settings, app.state.keyring),
        app.state.keyring,
        issuer_url=settings.jwt_issuer,
    )
    add_common_state(app, settings, redis=redis, readiness_checks=readiness_checks)
    app.state.passwords = PasswordService(password_config(settings))
    app.state.rate_limits = RateLimitGuard(
        RedisRateLimiter(app.state.redis, RATE_LIMIT_KEY_PREFIX), rate_limit_config(settings)
    )
    app.state.trusted_proxies = parse_networks(settings.trusted_proxies)
    app.state.signup = SignupService(settings, app.state.passwords)
    app.state.credentials = CredentialService(settings, app.state.passwords)
    app.state.team = TeamService(settings)
    app.state.brand_profiles = BrandProfileService()
    app.state.products = ProductService(events=app.state.outbox_writer)
    app.state.submissions = SubmissionService()
    # One HTTP client per process for the image host's Admin API: short timeouts, so a slow
    # Cloudinary cannot hold requests open.
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
    secret = settings.cloudinary_api_secret
    if (
        image_host is None
        and settings.cloudinary_cloud_name
        and settings.cloudinary_api_key
        and secret
    ):
        image_host = CloudinaryClient(
            settings.cloudinary_cloud_name,
            settings.cloudinary_api_key,
            secret.get_secret_value(),
            app.state.http,
        )
    app.state.assets = AssetService(settings, image_host)
    app.state.product_import = ProductImportService(settings, app.state.products)
    app.state.refresh_tokens = RefreshTokenStore(app.state.redis, refresh_token_config(settings))
    app.state.sessions = AuthService(
        settings, app.state.passwords, app.state.vendor_tokens, app.state.refresh_tokens
    )
    payout_keys, payout_kid = settings.payout_encryption_keys, settings.payout_encryption_kid
    assert payout_keys is not None and payout_kid is not None  # noqa: S101 (checked above)
    app.state.payout_cipher = PayoutCipher(parse_keys(payout_keys.get_secret_value()), payout_kid)
    app.state.store_details = StoreDetailsService(app.state.payout_cipher)
    app.state.size_charts = SizeChartService()

    # Credentials on: the refresh token is the HttpOnly `vendor_refresh` cookie.
    add_middleware(
        app,
        origins=settings.cors_allowed_origins,
        credentials=True,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    )

    app.include_router(health.router)
    app.include_router(jwks.router)
    v1 = APIRouter(prefix="/v1")
    v1.include_router(auth.router)
    v1.include_router(vendor.router)
    v1.include_router(team.router)
    v1.include_router(brand_profile.router)
    v1.include_router(assets.router)
    v1.include_router(product_import.router)
    v1.include_router(products.router)
    v1.include_router(submissions.router)
    v1.include_router(store_details.router)
    v1.include_router(public.router)
    v1.include_router(commission.router)
    v1.include_router(size_charts.router)
    app.include_router(v1)  # seller routers are added here; admin routers go in admin_app.py
    return app
