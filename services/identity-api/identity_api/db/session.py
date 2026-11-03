from collections.abc import AsyncIterator
from typing import cast

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Accepted DATABASE_URL schemes; each consumer swaps in the driver it needs.
POSTGRES_SCHEMES = ("postgresql+asyncpg://", "postgresql+psycopg://", "postgresql://")


def _with_driver(url: str, driver: str | None) -> str:
    """Replaces the URL's scheme with `postgresql+<driver>://`, or plain `postgresql://`."""
    prefix = f"postgresql+{driver}://" if driver else "postgresql://"
    for scheme in POSTGRES_SCHEMES:
        if url.startswith(scheme):
            return prefix + url.removeprefix(scheme)
    raise ValueError("DATABASE_URL must be a postgresql:// URL")


def async_url(url: str) -> str:
    """URL for the app's async engine (asyncpg)."""
    return _with_driver(url, "asyncpg")


def sync_url(url: str) -> str:
    """URL for Alembic, which runs on a sync engine (psycopg 3)."""
    return _with_driver(url, "psycopg")


def libpq_url(url: str) -> str:
    """Plain `postgresql://` DSN, for drivers called directly (`asyncpg.connect`)."""
    return _with_driver(url, None)


def create_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(async_url(database_url), pool_pre_ping=True)


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False: objects stay readable after commit without another round trip.
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request. Uncommitted work is rolled back at the end."""
    sessionmaker = cast(async_sessionmaker[AsyncSession], request.app.state.sessionmaker)
    async with sessionmaker() as session:
        yield session
