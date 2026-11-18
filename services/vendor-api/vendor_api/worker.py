"""The publisher worker: `python -m vendor_api.worker` (ADR 0003, section 5).

Runs next to the API, shares its database and delivers the outbox to the central app. Several may
run. It stops cleanly on SIGTERM or SIGINT: the requests in flight finish and no new ones start.
"""

import asyncio
import logging
import signal
import sys
from datetime import time
from types import FrameType

from shazlo_security.signing import RequestSigner, SigningKey

from vendor_api.core.logging import configure_logging
from vendor_api.core.settings import Settings, get_settings
from vendor_api.db.session import create_engine, create_sessionmaker
from vendor_api.services.outbox import OutboxWriter
from vendor_api.services.publisher import CentralClient, Publisher
from vendor_api.services.reconciliation import Reconciler, run_nightly

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
        sessions = create_sessionmaker(engine)
        jobs = [Publisher(sessions, client).run(stop)]
        if settings.reconcile_enabled:
            # Once a day, at RECONCILE_AT (UTC): re-send what the central app is behind on.
            reconciler = Reconciler(
                sessions,
                OutboxWriter(settings.outbox_events_enabled),
                client,
                max_pending=settings.reconcile_max_pending,
            )
            logger.info("reconciliation runs daily", extra={"at": settings.reconcile_at})
            jobs.append(run_nightly(reconciler, time.fromisoformat(settings.reconcile_at), stop))
        await asyncio.gather(*jobs)
    finally:
        await client.close()
        await engine.dispose()
        logger.info("publisher stopped")


def install_signal_handlers(loop: asyncio.AbstractEventLoop, stop: asyncio.Event) -> None:
    """SIGTERM and SIGINT set `stop`. Windows' event loops have no `add_signal_handler`, so there
    the plain `signal.signal` is used (Ctrl+C still stops the worker cleanly)."""

    def request_stop(_signum: int, _frame: FrameType | None) -> None:
        loop.call_soon_threadsafe(stop.set)

    for signum in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(signum, stop.set)
        except NotImplementedError:
            signal.signal(signum, request_stop)


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    stop = asyncio.Event()
    install_signal_handlers(asyncio.get_running_loop(), stop)
    await run(settings, stop)


def describe(error: BaseException) -> str:
    """What to print for a failure: the type, and the message when there is one."""
    message = str(error).strip()
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


def cli() -> int:
    """The program's exit code. A failure prints one message and no traceback: a bad setting is
    named (its value is not, see `hide_input_in_errors` on the settings) and nothing else shown
    could hold a secret."""
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"worker failed: {describe(error)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(cli())
