import pytest
from smtp_server import fake_smtp

from vendor_api import cli
from vendor_api.core.settings import get_settings


@pytest.fixture(autouse=True)
def clean_settings_cache() -> None:
    get_settings.cache_clear()


def configure(monkeypatch: pytest.MonkeyPatch, env: str, **values: str) -> None:
    monkeypatch.setenv("ENV", env)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    for name, value in values.items():
        monkeypatch.setenv(name.upper(), value)


def test_send_test_email_prints_a_link_with_the_console_backend(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    configure(monkeypatch, "dev", email_backend="console")
    assert cli.main(["send-test-email", "--to", "dev@brand.test"]) == 0
    assert "Sent the verify_email email to dev@brand.test" in capsys.readouterr().out


@pytest.mark.parametrize("env", ["test", "prod"])
def test_send_test_email_only_runs_in_dev(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], env: str
) -> None:
    configure(
        monkeypatch,
        env,
        email_backend="smtp",
        smtp_host="smtp.provider.example",
        portal_base_url="https://vendors.shazlo.store",
        rate_limit_hmac_key="k" * 32,  # prod needs one
        identity_jwks_url="https://identity.shazlo.store/.well-known/jwks.json",
        identity_issuer="https://identity.shazlo.store",
        jwt_issuer="https://vendor-api.shazlo.store",
    )
    assert cli.main(["send-test-email"]) == 1
    assert "only runs with ENV=dev" in capsys.readouterr().err


def test_send_test_email_through_smtp_reaches_the_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    async def run() -> list[str]:
        async with fake_smtp() as server:
            configure(
                monkeypatch,
                "dev",
                email_backend="smtp",
                smtp_host="127.0.0.1",
                smtp_port=str(server.port),
                smtp_security="none",
            )
            # The command runs its own event loop, so call it from a worker thread.
            code = await asyncio.to_thread(
                cli.main, ["send-test-email", "--template", "staff_invite", "--to", "x@y.test"]
            )
            assert code == 0
            return [str(m["Subject"]) for m in server.messages]

    assert asyncio.run(run()) == ["You are invited to join Demo Brand on Shazlo"]


def test_a_failed_send_is_reported_without_details(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    configure(
        monkeypatch,
        "dev",
        email_backend="smtp",
        smtp_host="127.0.0.1",
        smtp_port="1",
        smtp_security="none",
    )
    assert cli.main(["send-test-email", "--to", "secret-person@brand.test"]) == 1
    error = capsys.readouterr().err
    assert "could not send" in error
    assert "secret-person" not in error
