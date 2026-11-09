from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from vendor_api import __version__
from vendor_api.api import health
from vendor_api.core.errors import register_exception_handlers
from vendor_api.core.logging import configure_logging
from vendor_api.core.middleware import REQUEST_ID_HEADER, RequestIdMiddleware
from vendor_api.core.settings import Settings, get_settings
from vendor_api.db.session import create_engine, create_sessionmaker


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
        title="vendor-api",
        version=__version__,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    # The engine and the Redis client connect lazily, so creating the app does not need either.
    app.state.engine = create_engine(settings.database_url)
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    app.state.redis = redis or Redis.from_url(settings.redis_url)
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
    v1 = APIRouter(prefix="/v1")
    app.include_router(v1)  # feature routers are added here
    return app
