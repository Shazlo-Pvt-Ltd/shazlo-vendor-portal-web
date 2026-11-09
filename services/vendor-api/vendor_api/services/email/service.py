import asyncio
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field

from fastapi import BackgroundTasks

from vendor_api.services.email.senders import EmailSender
from vendor_api.services.email.templates import EmailContextError, EmailTemplate

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingEmail:
    """An email a flow decided to send. The flow returns it after its transaction committed;
    the route queues it, so nothing is sent for work that was rolled back."""

    to: str
    template: EmailTemplate
    # Holds the one-time token: kept out of repr, so logging the object cannot leak it.
    context: Mapping[str, object] = field(default_factory=dict, repr=False)


class EmailService:
    """Sends email without ever breaking or slowing the request that asked for it.

    `send_in_background` queues the send to run after the response. A failure is retried a few
    times with a growing pause, then logged and dropped; it never reaches the caller. Log lines
    carry the template name and the kind of error, never the recipient's token or the provider's
    reply (which can echo the address).
    """

    def __init__(
        self, sender: EmailSender, *, attempts: int = 3, retry_delay_seconds: float = 1.0
    ) -> None:
        if attempts < 1:
            raise ValueError("attempts must be at least 1")
        self._sender = sender
        self._attempts = attempts
        self._retry_delay = retry_delay_seconds

    def send_in_background(
        self,
        background: BackgroundTasks,
        to: str,
        template: EmailTemplate,
        context: Mapping[str, object],
    ) -> None:
        background.add_task(self.deliver, to, template, dict(context))

    def queue(self, background: BackgroundTasks, email: OutgoingEmail | None) -> None:
        if email is not None:
            self.send_in_background(background, email.to, email.template, email.context)

    async def deliver(
        self, to: str, template: EmailTemplate, context: Mapping[str, object]
    ) -> bool:
        """Tries up to `attempts` times. Returns whether the email was handed to the provider."""
        name = EmailTemplate(template).value
        for attempt in range(1, self._attempts + 1):
            try:
                await self._sender.send(to, template, context)
            except EmailContextError as error:
                # A programming error (a bad context), not a delivery problem: retrying cannot
                # help, so log it now instead of after the backoff.
                logger.error(
                    "email not sent: bad context",
                    # The message names context keys only, never their values.
                    extra={"template": name, "error": type(error).__name__, "detail": str(error)},
                )
                return False
            except Exception as error:
                details = {"template": name, "attempt": attempt, "error": type(error).__name__}
                if attempt == self._attempts:
                    logger.error("email gave up", extra={**details, "attempts": self._attempts})
                    return False
                logger.warning("email delivery failed, will retry", extra=details)
                await asyncio.sleep(self._retry_delay * 2 ** (attempt - 1))
            else:
                logger.info("email sent", extra={"template": name})
                return True
        return False  # not reached; keeps the type checker content
