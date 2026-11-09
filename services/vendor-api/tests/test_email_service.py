import json
import logging
from collections.abc import Mapping

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient
from smtp_server import fake_smtp

from vendor_api.api.deps import Emails
from vendor_api.app import create_app
from vendor_api.core.settings import Settings
from vendor_api.services.email import (
    EmailService,
    EmailTemplate,
    SmtpConfig,
    SmtpEmailSender,
)

TOKEN = "tok_Secret-9f8e7d"  # noqa: S105
VERIFY = {"token": TOKEN, "expires_in_minutes": 60}


class FlakySender:
    """Fails `failures` times, then works. Its errors echo the address and token, like a
    careless provider's reply could."""

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.calls = 0
        self.sent: list[tuple[str, EmailTemplate]] = []

    async def send(self, to: str, template: EmailTemplate, context: Mapping[str, object]) -> None:
        self.calls += 1
        if self.calls <= self.failures:
            raise ConnectionError(f"cannot reach provider for {to} with {context.get('token')}")
        self.sent.append((to, template))


def service(sender: FlakySender, attempts: int = 3) -> EmailService:
    return EmailService(sender, attempts=attempts, retry_delay_seconds=0)


def all_log_text(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(
        record.getMessage() + json.dumps(record.__dict__, default=str) for record in caplog.records
    )


async def test_a_working_sender_is_called_once(caplog: pytest.LogCaptureFixture) -> None:
    sender = FlakySender(0)
    with caplog.at_level(logging.INFO):
        assert await service(sender).deliver("a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY)
    assert sender.calls == 1
    assert sender.sent == [("a@b.test", EmailTemplate.VERIFY_EMAIL)]


async def test_a_failure_is_retried_until_it_works(caplog: pytest.LogCaptureFixture) -> None:
    sender = FlakySender(2)
    with caplog.at_level(logging.INFO):
        assert await service(sender).deliver("a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY)
    assert sender.calls == 3
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert [r.__dict__["attempt"] for r in warnings] == [1, 2]


async def test_it_gives_up_after_the_configured_attempts(caplog: pytest.LogCaptureFixture) -> None:
    sender = FlakySender(99)
    with caplog.at_level(logging.INFO):
        assert not await service(sender, attempts=4).deliver(
            "a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY
        )
    assert sender.calls == 4
    (gave_up,) = [r for r in caplog.records if r.getMessage() == "email gave up"]
    assert gave_up.__dict__["template"] == "verify_email"
    assert gave_up.__dict__["error"] == "ConnectionError"


async def test_failures_never_log_the_token_the_address_or_the_provider_reply(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG):
        await service(FlakySender(99)).deliver(
            "owner@brand.test", EmailTemplate.PASSWORD_RESET, VERIFY
        )
    text = all_log_text(caplog)
    assert caplog.records
    assert TOKEN not in text
    assert "owner@brand.test" not in text
    assert "cannot reach provider" not in text


async def test_a_template_bug_is_logged_not_raised(caplog: pytest.LogCaptureFixture) -> None:
    from vendor_api.services.email import ConsoleEmailSender

    sender = ConsoleEmailSender("https://v.test", show_links=False)
    with caplog.at_level(logging.INFO):
        ok = await EmailService(sender, attempts=1).deliver(
            "a@b.test", EmailTemplate.VERIFY_EMAIL, {"token": TOKEN}
        )
    assert not ok
    assert TOKEN not in all_log_text(caplog)
    assert any(r.__dict__.get("error") == "EmailContextError" for r in caplog.records)


def test_attempts_must_be_positive() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        EmailService(FlakySender(0), attempts=0)


async def test_the_retry_pause_doubles(monkeypatch: pytest.MonkeyPatch) -> None:
    pauses: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        pauses.append(seconds)

    monkeypatch.setattr("vendor_api.services.email.service.asyncio.sleep", fake_sleep)
    await EmailService(FlakySender(99), attempts=4, retry_delay_seconds=1.5).deliver(
        "a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY
    )
    assert pauses == [1.5, 3.0, 6.0]


# --- In a request ------------------------------------------------------------------------


def app_with(settings: Settings, sender: FlakySender) -> TestClient:
    app: FastAPI = create_app(settings, readiness_checks={})
    app.state.emails = service(sender)

    @app.post("/signup-ish")
    async def signup(emails: Emails, background: BackgroundTasks) -> dict[str, str]:
        emails.send_in_background(background, "a@b.test", EmailTemplate.VERIFY_EMAIL, VERIFY)
        return {"status": "created"}

    return TestClient(app, raise_server_exceptions=True)


def test_a_failing_sender_does_not_fail_the_request(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    sender = FlakySender(99)
    with caplog.at_level(logging.INFO):
        response = app_with(settings, sender).post("/signup-ish")
    assert response.status_code == 200
    assert response.json() == {"status": "created"}
    assert sender.calls == 3  # tried, retried, gave up, all after the response
    assert TOKEN not in all_log_text(caplog)


def test_a_working_sender_sends_after_the_request(settings: Settings) -> None:
    sender = FlakySender(0)
    assert app_with(settings, sender).post("/signup-ish").status_code == 200
    assert sender.sent == [("a@b.test", EmailTemplate.VERIFY_EMAIL)]


async def test_the_app_builds_its_email_service_from_the_settings(settings: Settings) -> None:
    app = create_app(settings, readiness_checks={})
    assert isinstance(app.state.emails, EmailService)


async def test_a_real_email_reaches_the_fake_server_in_the_background(
    settings: Settings,
) -> None:
    """The whole path: service, SMTP sender, a server, in the shape the signup endpoint uses."""
    async with fake_smtp() as server:
        sender = SmtpEmailSender(
            SmtpConfig("127.0.0.1", server.port, "none"),
            from_address="Shazlo <no-reply@shazlo.test>",
            base_url="https://vendors.shazlo.test",
        )
        emails = EmailService(sender, retry_delay_seconds=0)
        tasks = BackgroundTasks()
        emails.send_in_background(tasks, "owner@brand.test", EmailTemplate.VERIFY_EMAIL, VERIFY)
        assert server.messages == []  # nothing is sent until the response is out
        await tasks()
    assert [m["To"] for m in server.messages] == ["owner@brand.test"]
