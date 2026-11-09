import logging
import smtplib
from collections.abc import Callable
from email.message import EmailMessage
from typing import Any

import pytest
from smtp_server import fake_smtp

from vendor_api.core.settings import Settings
from vendor_api.services.email import (
    ConsoleEmailSender,
    EmailTemplate,
    SmtpConfig,
    SmtpEmailSender,
    build_sender,
)

BASE = "https://vendors.shazlo.test"
TOKEN = "tok_Secret-9f8e7d"  # noqa: S105
VERIFY = {"token": TOKEN, "expires_in_minutes": 60}
Override = Callable[..., Settings]


def smtp_sender(port: int, **changes: Any) -> SmtpEmailSender:
    config = SmtpConfig(host="127.0.0.1", port=port, security="none", **changes)
    return SmtpEmailSender(config, from_address="Shazlo <no-reply@shazlo.test>", base_url=BASE)


def body(message: EmailMessage, kind: str) -> str:
    part = message.get_body(preferencelist=(kind,))
    assert part is not None
    return str(part.get_content())


# --- SMTP --------------------------------------------------------------------------------


async def test_smtp_delivers_a_multipart_email_to_the_fake_server() -> None:
    async with fake_smtp() as server:
        await smtp_sender(server.port).send("owner@brand.test", EmailTemplate.VERIFY_EMAIL, VERIFY)

    assert server.envelopes == [("<no-reply@shazlo.test>", ["<owner@brand.test>"])]
    (message,) = server.messages
    assert message["From"] == "Shazlo <no-reply@shazlo.test>"
    assert message["To"] == "owner@brand.test"
    assert message["Subject"] == "Verify your email address for Shazlo"
    assert message["Auto-Submitted"] == "auto-generated"
    assert message["Message-ID"] and message["Date"]
    link = f"{BASE}/verify-email#token={TOKEN}"
    assert link in body(message, "plain")
    assert link in body(message, "html")
    assert message.get_body(preferencelist=("plain",)) is not None


async def test_the_envelope_goes_only_to_the_given_address() -> None:
    """The recipient is the address passed in, not whatever the To header parses into."""
    async with fake_smtp() as server:
        sender = smtp_sender(server.port)
        await sender.send("owner@brand.test", EmailTemplate.ACCOUNT_EXISTS, {})
    assert [recipients for _, recipients in server.envelopes] == [["<owner@brand.test>"]]


async def test_smtp_runs_in_its_own_thread_pool() -> None:
    from vendor_api.services.email.senders import SMTP_WORKERS

    sender = smtp_sender(1)
    assert sender._pool._max_workers == SMTP_WORKERS


async def test_smtp_logs_in_when_a_user_is_configured() -> None:
    async with fake_smtp() as server:
        sender = smtp_sender(server.port, user="mailer", password="p4ss-word")  # noqa: S106
        await sender.send("a@b.test", EmailTemplate.ACCOUNT_EXISTS, {})
    assert server.credentials == [("mailer", "p4ss-word")]


async def test_smtp_does_not_log_in_without_a_user() -> None:
    async with fake_smtp() as server:
        await smtp_sender(server.port).send("a@b.test", EmailTemplate.ACCOUNT_EXISTS, {})
    assert server.credentials == []


async def test_smtp_raises_when_the_provider_refuses() -> None:
    async with fake_smtp() as server:
        server.refuse_with = "550 mailbox unavailable"
        with pytest.raises(smtplib.SMTPException):
            await smtp_sender(server.port).send("a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY)
    assert server.messages == []


async def test_smtp_raises_when_nothing_listens() -> None:
    async with fake_smtp() as server:
        port = server.port
    with pytest.raises(OSError, match=r".+"):
        await smtp_sender(port).send("a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY)


async def test_smtp_refuses_an_address_that_could_add_headers() -> None:
    async with fake_smtp() as server:
        with pytest.raises(ValueError, match=r".+"):
            await smtp_sender(server.port).send(
                "a@b.test\r\nBcc: evil@x.test", EmailTemplate.VERIFY_EMAIL, VERIFY
            )
    assert server.messages == []


async def test_smtp_config_never_shows_the_password() -> None:
    config = SmtpConfig("h", 25, "none", user="u", password="hunter2-very-secret")  # noqa: S106
    assert "hunter2" not in repr(config)


# --- Console -----------------------------------------------------------------------------


async def test_the_console_backend_prints_the_link_in_dev(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO):
        await ConsoleEmailSender(BASE, show_links=True).send(
            "owner@brand.test", EmailTemplate.VERIFY_EMAIL, VERIFY
        )
    text = "\n".join(record.getMessage() for record in caplog.records)
    assert f"{BASE}/verify-email#token={TOKEN}" in text
    assert "owner@brand.test" in text


@pytest.mark.parametrize("template", list(EmailTemplate))
async def test_the_console_backend_logs_no_token_outside_dev(
    caplog: pytest.LogCaptureFixture, template: EmailTemplate
) -> None:
    context = {
        EmailTemplate.ACCOUNT_EXISTS: {},
        EmailTemplate.STAFF_INVITE: {**VERIFY, "vendor_name": "Brand"},
    }.get(template, VERIFY)
    with caplog.at_level(logging.DEBUG):
        await ConsoleEmailSender(BASE, show_links=False).send("owner@brand.test", template, context)
    assert caplog.records
    for record in caplog.records:
        assert TOKEN not in str(record.__dict__)
        assert TOKEN not in record.getMessage()
        assert "owner@brand.test" not in record.getMessage()


# --- Choosing the backend ----------------------------------------------------------------


def test_the_console_backend_is_the_default(settings: Settings) -> None:
    assert isinstance(build_sender(settings), ConsoleEmailSender)


def test_dev_shows_links_and_other_environments_do_not(
    settings: Settings, override: Override
) -> None:
    dev = build_sender(override(settings, env="dev"))
    test = build_sender(override(settings, env="test"))
    assert dev._show_links is True  # type: ignore[attr-defined]  # noqa: SLF001
    assert test._show_links is False  # type: ignore[attr-defined]  # noqa: SLF001


async def test_switching_to_smtp_is_a_settings_change(
    settings: Settings, override: Override
) -> None:
    async with fake_smtp() as server:
        smtp = override(
            settings,
            email_backend="smtp",
            smtp_host="127.0.0.1",
            smtp_port=server.port,
            smtp_security="none",
            email_from="Shazlo <hello@shazlo.test>",
            portal_base_url="https://vendors.example/",
        )
        sender = build_sender(smtp)
        assert isinstance(sender, SmtpEmailSender)
        await sender.send("a@b.test", EmailTemplate.PASSWORD_RESET, VERIFY)
    (message,) = server.messages
    assert message["From"] == "Shazlo <hello@shazlo.test>"
    assert "https://vendors.example/reset-password#token=" in body(message, "plain")
    assert server.credentials == []  # no TLS on the fake server, so no credentials (Settings)
