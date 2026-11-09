from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from shazlo_auth import StaticKeySource, TokenVerifier
from shazlo_security.client_ip import parse_networks
from shazlo_security.keys import load_keyring
from shazlo_security.passwords import PasswordService
from shazlo_security.rate_limit import RateLimitGuard, RedisRateLimiter
from shazlo_security.refresh_tokens import RefreshTokenStore

from identity_api import __version__
from identity_api.api import admins, auth, health, jwks, me
from identity_api.core.errors import register_exception_handlers
from identity_api.core.logging import configure_logging
from identity_api.core.middleware import REQUEST_ID_HEADER, RequestIdMiddleware
from identity_api.core.security import (
    RATE_LIMIT_KEY_PREFIX,
    key_ring_config,
    password_config,
    rate_limit_config,
    refresh_token_config,
    token_issuer,
)
from identity_api.core.settings import Settings, get_settings
from identity_api.db.session import create_engine, create_sessionmaker
from identity_api.services.admins import AdminService
from identity_api.services.auth import SELF_AUDIENCE, AuthService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await app.state.engine.dispose()
    await app.state.redis.aclose()


def create_app(
    settings: Settings | None = None,
    readiness_checks: dict[str, health.ReadinessCheck] | None = None,
    redis: Redis | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    # OpenAPI docs are for development; production does not serve them.
    docs_enabled = settings.env != "prod"
    app = FastAPI(
        title="identity-api",
        version=__version__,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    # The engine connects lazily, so creating the app does not need a reachable database.
    app.state.engine = create_engine(settings.database_url)
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    # Keys are loaded now, so a missing or broken key stops the service at startup.
    app.state.keyring = load_keyring(key_ring_config(settings))
    app.state.token_issuer = token_issuer(settings, app.state.keyring)
    # The same verifier other services use, with the keys held in-process instead of a JWKS fetch.
    app.state.token_verifier = TokenVerifier(
        StaticKeySource(app.state.keyring.public_keys),
        issuer=settings.jwt_issuer,
        audience=SELF_AUDIENCE,
    )
    # Like the engine, the Redis client connects lazily.
    app.state.redis = redis or Redis.from_url(settings.redis_url)
    passwords = PasswordService(password_config(settings))
    refresh_tokens = RefreshTokenStore(app.state.redis, refresh_token_config(settings))
    app.state.auth = AuthService(settings, passwords, app.state.token_issuer, refresh_tokens)
    app.state.admins = AdminService(settings, passwords, refresh_tokens)
    app.state.rate_limits = RateLimitGuard(
        RedisRateLimiter(app.state.redis, RATE_LIMIT_KEY_PREFIX), rate_limit_config(settings)
    )
    app.state.trusted_proxies = parse_networks(settings.trusted_proxies)
    app.state.readiness_checks = (
        readiness_checks
        if readiness_checks is not None
        else health.default_readiness_checks(settings)
    )

    # Middleware added last runs first: request ID wraps CORS so even CORS answers carry an ID.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIdMiddleware)
    register_exception_handlers(app)

    app.include_router(health.router)
    app.include_router(jwks.router)
    v1 = APIRouter(prefix="/v1")
    v1.include_router(auth.router)
    v1.include_router(me.router)
    v1.include_router(admins.router)
    app.include_router(v1)  # feature routers are added here
    return app
