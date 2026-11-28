"""What the seller app and the admin app build the same way (ADR 0011).

vendor-api is one package that runs as two deployables over one database:

- the seller app (`vendor_api.app:create_seller_app`, `vendor_api.main:app`) serves the Vendor
  Portal: `/v1/auth`, `/v1/vendor/*`, `/v1/public/*` and the vendor JWKS;
- the admin app (`vendor_api.admin_app:create_admin_app`, `vendor_api.admin_main:app`) serves
  Shazlo One's Vendors module: `/v1/admin/*` only.

Both write to the same tables, so an approval still writes its central-app event in the same
transaction (ADR 0003). Both need the same `REDIS_URL` (the admin app ends vendor sessions in the
seller app's refresh store) and the same `OUTBOX_EVENTS_ENABLED`.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from vendor_api import __version__
from vendor_api.api import health
from vendor_api.core.errors import register_exception_handlers
from vendor_api.core.logging import configure_logging
from vendor_api.core.middleware import REQUEST_ID_HEADER, RequestIdMiddleware
from vendor_api.core.settings import Settings
from vendor_api.db.session import create_engine, create_sessionmaker
from vendor_api.services.commission import CommissionService
from vendor_api.services.email import EmailService, build_sender
from vendor_api.services.outbox import OutboxWriter


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await app.state.engine.dispose()
    await app.state.redis.aclose()
    http = getattr(app.state, "http", None)
    if http is not None:
        await http.aclose()


def new_app(settings: Settings, title: str) -> FastAPI:
    configure_logging(settings.log_level)
    # OpenAPI docs are for development; production does not serve them.
    docs_enabled = settings.env != "prod"
    app = FastAPI(
        title=title,
        version=__version__,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    return app


def add_common_state(
    app: FastAPI,
    settings: Settings,
    *,
    redis: Redis | None,
    readiness_checks: dict[str, health.ReadinessCheck] | None,
) -> None:
    """The database, Redis, email, the outbox writer and the readiness checks."""
    # The engine and the Redis client connect lazily, so creating the app does not need either.
    app.state.engine = create_engine(settings.database_url)
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    app.state.redis = redis or Redis.from_url(settings.redis_url)
    app.state.emails = EmailService(build_sender(settings), attempts=settings.email_send_attempts)
    # The seller app writes archive events with it, the admin app approvals and status changes.
    app.state.outbox_writer = OutboxWriter(settings.outbox_events_enabled)
    app.state.commissions = CommissionService()
    app.state.readiness_checks = (
        readiness_checks
        if readiness_checks is not None
        else health.default_readiness_checks(settings)
    )


def add_middleware(
    app: FastAPI, *, origins: list[str], credentials: bool, methods: list[str]
) -> None:
    # Middleware added last runs first: request ID wraps CORS so even CORS answers carry an ID.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=credentials,
        allow_methods=methods,
        allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
        # Retry-After is not a CORS-safelisted response header: without this, a browser on another
        # origin cannot read how long a 429 asks it to wait.
        expose_headers=[REQUEST_ID_HEADER, "Retry-After"],
    )
    app.add_middleware(RequestIdMiddleware)
    register_exception_handlers(app)
