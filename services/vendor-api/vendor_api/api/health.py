import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import cast

import asyncpg
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from vendor_api.core.settings import Settings
from vendor_api.db.session import libpq_url
from vendor_api.services.outbox_admin import outbox_stats

logger = logging.getLogger(__name__)

CHECK_TIMEOUT_SECONDS = 2.0

ReadinessCheck = Callable[[], Awaitable[None]]

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness: the process is up. Does not touch any dependency."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness: every dependency answers. 503 if any check fails or times out."""
    checks = cast(dict[str, ReadinessCheck], request.app.state.readiness_checks)
    results = await asyncio.gather(*(_run(name, check) for name, check in checks.items()))
    statuses = dict(results)
    ok = all(status == "ok" for status in statuses.values())
    return JSONResponse(
        {
            "status": "ok" if ok else "unavailable",
            "checks": statuses,
            # For monitoring only: it never changes the status (an alert on `dead` or on the age of
            # the oldest due event is the monitor's job). Null when it could not be read.
            "outbox": await _outbox(request),
        },
        status_code=200 if ok else 503,
    )


async def _outbox(request: Request) -> dict[str, int | None] | None:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            async with request.app.state.sessionmaker() as db:
                stats = await outbox_stats(db, datetime.now(UTC))
    except Exception as exc:
        logger.warning("outbox stats unavailable", extra={"error": type(exc).__name__})
        return None
    return {
        "pending": stats.pending,
        "sending": stats.sending,
        "dead": stats.dead,
        "oldest_due_age_seconds": stats.oldest_due_age_seconds,
    }


async def _run(name: str, check: ReadinessCheck) -> tuple[str, str]:
    try:
        await asyncio.wait_for(check(), CHECK_TIMEOUT_SECONDS)
    except Exception as exc:
        # No traceback: probes hit this every few seconds while a dependency is down.
        logger.warning("readiness check failed", extra={"check": name, "error": type(exc).__name__})
        return name, "unavailable"
    return name, "ok"


def default_readiness_checks(settings: Settings) -> dict[str, ReadinessCheck]:
    async def postgres() -> None:
        dsn = libpq_url(settings.database_url)
        connection = await asyncpg.connect(dsn, timeout=CHECK_TIMEOUT_SECONDS)
        try:
            await connection.execute("SELECT 1")
        finally:
            await connection.close()

    async def redis() -> None:
        client = Redis.from_url(settings.redis_url)
        try:
            await client.ping()
        finally:
            await client.aclose()

    return {"postgres": postgres, "redis": redis}
