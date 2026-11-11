"""The publisher worker: `python -m vendor_api.worker` (ADR 0003, section 5).

Runs next to the API, shares its database and delivers the outbox to the central app. Several may
run. It stops cleanly on SIGTERM or SIGINT: the requests in flight finish and no new ones start.
"""

import asyncio
import logging
import signal
import sys

from shazlo_security.signing import RequestSigner, SigningKey

from vendor_api.core.logging import configure_logging
from vendor_api.core.settings import Settings, get_settings
from vendor_api.db.session import create_engine, create_sessionmaker
from vendor_api.services.publisher import CentralClient, Publisher

logger = logging.getLogger("vendor_api.worker")


async def run(settings: Settings, stop: asyncio.Event) -> None:
    if not settings.central_publishing_enabled:
        # Not an error: events queue in the outbox until publishing is configured.
        logger.warning("CENTRAL_PUBLISHING_ENABLED is off: nothing is sent, events keep queueing")
        await stop.wait()
        return
    # The settings check these three are set when publishing is on.
    assert settings.central_api_url and settings.central_signing_key_id  # noqa: S101
    assert settings.central_signing_secret is not None  # noqa: S101
    signer = RequestSigner(
        SigningKey(
            settings.central_signing_key_id,
            settings.central_signing_secret.get_secret_value().encode(),
        )
    )
    engine = create_engine(settings.database_url)
    client = CentralClient(settings.central_api_url, signer)
    try:
        logger.info("publisher started", extra={"key_id": signer.key_id})
        await Publisher(create_sessionmaker(engine), client).run(stop)
    finally:
        await client.close()
        await engine.dispose()
        logger.info("publisher stopped")


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, stop.set)
    await run(settings, stop)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:  # a bad setting: say which, not a traceback of secrets
        print(f"worker failed to start: {error}", file=sys.stderr)
        sys.exit(1)
