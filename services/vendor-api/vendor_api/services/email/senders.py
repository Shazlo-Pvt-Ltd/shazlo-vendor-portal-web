import asyncio
import logging
import smtplib
import ssl
from collections.abc import Mapping
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Literal, Protocol

from vendor_api.core.settings import Settings
from vendor_api.services.email.templates import EmailTemplate, render

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 10


class EmailSender(Protocol):
    """What the rest of the app depends on. The provider behind it is a setting."""

    async def send(self, to: str, template: EmailTemplate, context: Mapping[str, object]) -> None:
        """Sends one email. Raises if it could not be handed to the provider."""
        ...


class ConsoleEmailSender:
    """Development and tests: nothing is sent.

    With `show_links` (ENV=dev only) the email and its link are logged, so a developer can click
    it. Otherwise only the template name is logged: the link holds a one-time token.
    """

    def __init__(self, base_url: str, *, show_links: bool) -> None:
        self._base_url = base_url
        self._show_links = show_links

    async def send(self, to: str, template: EmailTemplate, context: Mapping[str, object]) -> None:
        rendered = render(template, context, base_url=self._base_url)
        if self._show_links:
            logger.info(
                "email (console backend) to %s: %s\n%s",
                to,
                rendered.subject,
                rendered.link,
                extra={"template": template.value},
            )
        else:
            logger.info(
                "email not sent (console backend)",
                extra={"template": EmailTemplate(template).value},
            )


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    security: Literal["none", "starttls", "ssl"]
    user: str | None = None
    # A secret: kept out of repr so it cannot reach a log or traceback.
    password: str | None = field(default=None, repr=False)


class SmtpEmailSender:
    """Plain SMTP: Mailpit locally, most providers (SES, Postmark, Resend, ...) in production."""

    def __init__(self, config: SmtpConfig, *, from_address: str, base_url: str) -> None:
        self._config = config
        self._from = from_address
        self._base_url = base_url

    async def send(self, to: str, template: EmailTemplate, context: Mapping[str, object]) -> None:
        rendered = render(template, context, base_url=self._base_url)
        message = EmailMessage()
        message["From"] = self._from
        message["To"] = to
        message["Subject"] = rendered.subject
        message["Date"] = formatdate(localtime=False)
        message["Message-ID"] = make_msgid(domain="shazlo.store")
        # Tells mail systems this is automatic, so they do not send out-of-office replies.
        message["Auto-Submitted"] = "auto-generated"
        message.set_content(rendered.text)
        message.add_alternative(rendered.html, subtype="html")
        await asyncio.to_thread(self._deliver, message)

    def _deliver(self, message: EmailMessage) -> None:
        config = self._config
        client: smtplib.SMTP
        if config.security == "ssl":
            client = smtplib.SMTP_SSL(
                config.host,
                config.port,
                timeout=SMTP_TIMEOUT_SECONDS,
                context=ssl.create_default_context(),
            )
        else:
            client = smtplib.SMTP(config.host, config.port, timeout=SMTP_TIMEOUT_SECONDS)
        with client:
            if config.security == "starttls":
                client.starttls(context=ssl.create_default_context())
            if config.user and config.password:
                client.login(config.user, config.password)
            client.send_message(message)


def build_sender(settings: Settings) -> EmailSender:
    """The sender the settings ask for. Switching provider is a configuration change."""
    base_url = settings.portal_base_url
    if settings.email_backend == "smtp":
        if settings.smtp_host is None:  # Settings refuses smtp without a host
            raise ValueError("SMTP_HOST is not set")
        password = settings.smtp_password
        return SmtpEmailSender(
            SmtpConfig(
                host=settings.smtp_host,
                port=settings.smtp_port,
                security=settings.smtp_security,
                user=settings.smtp_user,
                password=password.get_secret_value() if password is not None else None,
            ),
            from_address=settings.email_from,
            base_url=base_url,
        )
    return ConsoleEmailSender(base_url, show_links=settings.env == "dev")
