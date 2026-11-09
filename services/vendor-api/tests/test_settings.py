from collections.abc import Callable

import pytest
from pydantic import ValidationError

from vendor_api.core.settings import Settings


def make(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "database_url": "postgresql://u:p@localhost/db",
        "redis_url": "redis://localhost:6379/0",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_missing_required_settings_fail_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None)
    missing = {error["loc"][0] for error in exc.value.errors()}
    assert missing == {"database_url", "redis_url"}


def test_defaults() -> None:
    s = make()
    assert s.env == "dev"
    assert s.cors_allowed_origins == ["http://localhost:5174"]
    assert s.cookie_secure is True
    assert s.cookie_samesite == "strict"
    assert s.cookie_domain is None
    assert s.jwt_issuer == "http://localhost:8002"


def test_cors_origins_are_comma_separated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://a.example, https://b.example ,")
    assert make().cors_allowed_origins == ["https://a.example", "https://b.example"]


def test_environment_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("ENV", "prod")
    # Production must be able to send email, over TLS, with links to an https portal.
    monkeypatch.setenv("EMAIL_BACKEND", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.provider.example")
    monkeypatch.setenv("PORTAL_BASE_URL", "https://vendors.shazlo.store")
    s = make()
    assert s.cookie_secure is False
    assert s.env == "prod"


@pytest.mark.parametrize(
    "scheme", ["postgresql://", "postgresql+asyncpg://", "postgresql+psycopg://"]
)
def test_every_postgres_scheme_is_accepted(scheme: str) -> None:
    assert make(database_url=scheme + "u:p@localhost/db").database_url.startswith(scheme)


@pytest.mark.parametrize(
    "overrides",
    [
        {"database_url": "mysql://x"},
        {"redis_url": "http://localhost"},
        {"env": "staging"},
        {"cors_allowed_origins": ["*"]},
        {"cookie_samesite": "none", "cookie_secure": False},
    ],
)
def test_invalid_values_are_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        make(**overrides)


def test_samesite_none_is_fine_with_secure() -> None:
    assert make(cookie_samesite="none", cookie_secure=True).cookie_samesite == "none"


def test_jwt_settings_defaults(settings: Settings) -> None:
    assert settings.jwt_keys_dir is None
    assert settings.jwt_signing_kid is None
    assert settings.access_token_ttl_seconds == 900


@pytest.mark.parametrize("seconds", [0, -1, 3601])
def test_access_token_lifetime_is_bounded(
    settings: Settings, override: Callable[..., Settings], seconds: int
) -> None:
    with pytest.raises(ValidationError):
        override(settings, access_token_ttl_seconds=seconds)


# --- Email -------------------------------------------------------------------------------


def test_email_defaults_send_nothing_and_point_at_the_local_portal() -> None:
    s = make()
    assert s.email_backend == "console"
    assert s.smtp_host is None
    assert s.smtp_password is None
    assert s.portal_base_url == "http://localhost:5174"
    assert s.email_send_attempts == 3


def test_the_smtp_password_is_a_secret() -> None:
    s = make(smtp_user="mailer", smtp_password="hunter2-very-secret")  # noqa: S106
    assert s.smtp_password is not None
    assert "hunter2" not in repr(s)
    assert "hunter2" not in str(s.model_dump())


def test_the_portal_base_url_loses_its_trailing_slash() -> None:
    assert make(portal_base_url="https://vendors.shazlo.store/").portal_base_url == (
        "https://vendors.shazlo.store"
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"portal_base_url": "vendors.shazlo.store"},
        {"portal_base_url": "ftp://vendors.shazlo.store"},
        {"portal_base_url": "https://vendors.shazlo.store/#x"},
        {"email_from": "no-at-sign"},
        {"email_from": "a@b.c\nBcc: x@y.z"},
        {"email_backend": "smtp"},  # no host
        {"smtp_user": "mailer"},  # user without password
        {"smtp_password": "secret-without-user"},
        {"email_send_attempts": 0},
        {"smtp_port": 0},
        {"smtp_security": "tls"},
    ],
)
def test_invalid_email_settings_are_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        make(**overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        {},  # the console backend sends nothing
        {"email_backend": "smtp", "smtp_host": "h", "smtp_security": "none"},
        {"email_backend": "smtp", "smtp_host": "h", "portal_base_url": "http://plain.example"},
    ],
    ids=["console", "no-tls", "http-portal"],
)
def test_prod_refuses_unsafe_email_settings(overrides: dict[str, object]) -> None:
    values = {"portal_base_url": "https://vendors.shazlo.store", **overrides}
    with pytest.raises(ValidationError):
        make(env="prod", **values)


def test_prod_accepts_smtp_over_tls_with_an_https_portal() -> None:
    s = make(
        env="prod",
        email_backend="smtp",
        smtp_host="smtp.provider.example",
        smtp_user="mailer",
        smtp_password="s3cret-value",  # noqa: S106
        portal_base_url="https://vendors.shazlo.store",
    )
    assert s.smtp_security == "starttls"


def test_session_defaults_and_bounds() -> None:
    s = make()
    assert (s.refresh_token_ttl_days, s.refresh_family_max_days) == (7, 30)
    assert s.refresh_reuse_grace_seconds == 10
    assert make(refresh_reuse_grace_seconds=0).refresh_reuse_grace_seconds == 0
    for seconds in (-1, 61):
        with pytest.raises(ValidationError):
            make(refresh_reuse_grace_seconds=seconds)
