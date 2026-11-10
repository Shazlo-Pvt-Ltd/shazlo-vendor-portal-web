from collections.abc import Callable

import pytest
from pydantic import ValidationError

from vendor_api.core.settings import Settings

# What prod needs besides email: where admin tokens come from (identity-api), over https.
PROD_IDENTITY = {
    "identity_jwks_url": "https://identity.shazlo.store/.well-known/jwks.json",
    "identity_issuer": "https://identity.shazlo.store",
    "jwt_issuer": "https://vendor-api.shazlo.store",
}


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
    assert not hasattr(s, "cookie_domain")  # host-only cookies: no Domain setting
    assert s.jwt_issuer == "http://localhost:8002"


def test_cors_origins_are_comma_separated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://a.example, https://b.example ,")
    assert make().cors_allowed_origins == ["https://a.example", "https://b.example"]


def test_environment_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COOKIE_SAMESITE", "lax")
    monkeypatch.setenv("ENV", "prod")
    # Production must be able to send email, over TLS, with links to an https portal.
    monkeypatch.setenv("EMAIL_BACKEND", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.provider.example")
    monkeypatch.setenv("PORTAL_BASE_URL", "https://vendors.shazlo.store")
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "k" * 32)  # required in prod
    monkeypatch.setenv("IDENTITY_JWKS_URL", PROD_IDENTITY["identity_jwks_url"])
    monkeypatch.setenv("IDENTITY_ISSUER", PROD_IDENTITY["identity_issuer"])
    monkeypatch.setenv("JWT_ISSUER", PROD_IDENTITY["jwt_issuer"])
    s = make()
    assert s.cookie_samesite == "lax"
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
    values = {
        "portal_base_url": "https://vendors.shazlo.store",
        "rate_limit_hmac_key": "k" * 32,  # so the email settings are what is refused
        **PROD_IDENTITY,
        **overrides,
    }
    with pytest.raises(ValidationError, match="EMAIL_BACKEND|SMTP_SECURITY|PORTAL_BASE_URL"):
        make(env="prod", **values)


def test_prod_accepts_smtp_over_tls_with_an_https_portal() -> None:
    s = make(
        env="prod",
        email_backend="smtp",
        smtp_host="smtp.provider.example",
        smtp_user="mailer",
        smtp_password="s3cret-value",  # noqa: S106
        portal_base_url="https://vendors.shazlo.store",
        rate_limit_hmac_key="k" * 32,
        **PROD_IDENTITY,
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


# --- Rate limits -------------------------------------------------------------------------


def test_rate_limit_defaults() -> None:
    s = make()
    assert (s.rate_limit_login_email.limit, s.rate_limit_login_email.window_seconds) == (5, 900)
    assert (s.rate_limit_signup_ip.limit, s.rate_limit_signup_ip.window_seconds) == (10, 3600)
    assert (s.rate_limit_signup_email.limit, s.rate_limit_signup_email.window_seconds) == (3, 3600)
    assert s.rate_limit_ipv6_prefix == 64
    assert s.trusted_proxies == []
    # Endpoints that check a password or send email fail closed; the rest fail open.
    assert set(s.rate_limit_fail_closed) == {
        "login",
        "signup",
        "resend_verification",
        "forgot_password",
        "change_password",
        "staff_invite",
    }
    assert "refresh" not in s.rate_limit_fail_closed
    assert "verify_email" not in s.rate_limit_fail_closed


def test_rate_limits_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_SIGNUP_IP", "3/10")
    monkeypatch.setenv("RATE_LIMIT_FAIL_CLOSED", "login, refresh")
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.0/8, 192.168.1.5/32")
    s = make()
    assert (s.rate_limit_signup_ip.limit, s.rate_limit_signup_ip.window_seconds) == (3, 10)
    assert s.rate_limit_fail_closed == ["login", "refresh"]
    assert s.trusted_proxies == ["10.0.0.0/8", "192.168.1.5/32"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"rate_limit_signup_ip": "5"},
        {"rate_limit_signup_ip": "0/60"},
        {"rate_limit_signup_ip": "5/0"},
        {"rate_limit_signup_ip": "many/60"},
        {"rate_limit_fail_closed": ["logn"]},
        {"trusted_proxies": ["not-a-network"]},
        {"rate_limit_hmac_key": "short"},  # a short key is refused outside prod too
        {"rate_limit_ipv6_prefix": 0},
        {"rate_limit_ipv6_prefix": 129},
    ],
    ids=str,
)
def test_invalid_rate_limit_settings_are_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        make(**overrides)


def test_the_hmac_key_is_required_in_prod_and_never_empty() -> None:
    prod = {
        "env": "prod",
        "email_backend": "smtp",
        "smtp_host": "smtp.provider.example",
        "portal_base_url": "https://vendors.shazlo.store",
        **PROD_IDENTITY,
    }
    for bad in (None, "", "   ", "x" * 31):
        with pytest.raises(ValidationError, match="RATE_LIMIT_HMAC_KEY"):
            make(**prod, rate_limit_hmac_key=bad)
    accepted = make(**prod, rate_limit_hmac_key="x" * 32).rate_limit_hmac_key
    assert accepted is not None
    assert accepted.get_secret_value() == "x" * 32


def test_outside_prod_each_process_gets_its_own_key_and_it_is_a_secret() -> None:
    first, second = make(), make()
    assert first.rate_limit_hmac_key is not None
    assert second.rate_limit_hmac_key is not None
    assert (
        first.rate_limit_hmac_key.get_secret_value()
        != second.rate_limit_hmac_key.get_secret_value()
    )
    assert len(first.rate_limit_hmac_key.get_secret_value()) == 64
    assert first.rate_limit_hmac_key.get_secret_value() not in repr(first)
    assert make(rate_limit_hmac_key="").rate_limit_hmac_key is not None  # empty counts as unset


def test_link_lifetimes() -> None:
    s = make()
    assert s.invite_token_ttl_minutes == 24 * 60  # invites: 24 hours
    assert s.reset_token_ttl_minutes == 60  # resets: 1 hour
    assert make(reset_token_ttl_minutes=5).reset_token_ttl_minutes == 5
    for name, value in (
        ("invite_token_ttl_minutes", 4),
        ("invite_token_ttl_minutes", 14 * 24 * 60 + 1),
        ("reset_token_ttl_minutes", 4),
        ("reset_token_ttl_minutes", 24 * 60 + 1),
    ):
        with pytest.raises(ValidationError):
            make(**{name: value})


# --- identity-api (admin tokens) ---------------------------------------------------------


def test_admin_auth_is_off_unless_configured() -> None:
    s = make()
    assert (s.identity_jwks_url, s.identity_issuer) == (None, None)
    # Empty counts as unset (a line copied from .env.example).
    blank = make(identity_jwks_url="  ", identity_issuer="")
    assert (blank.identity_jwks_url, blank.identity_issuer) == (None, None)


def test_the_two_identity_settings_go_together() -> None:
    with pytest.raises(ValidationError, match="go together"):
        make(identity_jwks_url="https://identity.test/.well-known/jwks.json")
    with pytest.raises(ValidationError, match="go together"):
        make(identity_issuer="https://identity.test")


def test_dev_may_use_plain_http_for_a_compose_hostname() -> None:
    s = make(
        identity_jwks_url="http://identity-api:8001/.well-known/jwks.json",
        identity_issuer="http://localhost:8001",
    )
    assert s.identity_jwks_url is not None


@pytest.mark.parametrize("env", ["test", "prod"])
def test_outside_dev_the_jwks_url_must_be_https(env: str) -> None:
    extra: dict[str, object] = {
        "email_backend": "smtp",
        "smtp_host": "smtp.provider.example",
        "portal_base_url": "https://vendors.shazlo.store",
        "rate_limit_hmac_key": "k" * 32,
    }
    for url in (
        "http://identity.test/jwks",
        "http://127.0.0.1:8001/jwks",
        "ftp://x/jwks",
        "nohost",
    ):
        with pytest.raises(ValidationError, match="IDENTITY_JWKS_URL"):
            make(
                env=env,
                identity_jwks_url=url,
                identity_issuer="https://identity.test",
                jwt_issuer="https://vendor-api.test",
                **extra,
            )


def test_prod_needs_the_identity_settings() -> None:
    with pytest.raises(ValidationError, match="IDENTITY_JWKS_URL"):
        make(
            env="prod",
            jwt_issuer="https://vendor-api.shazlo.store",
            email_backend="smtp",
            smtp_host="smtp.provider.example",
            portal_base_url="https://vendors.shazlo.store",
            rate_limit_hmac_key="k" * 32,
        )


PROD_EMAIL: dict[str, object] = {
    "email_backend": "smtp",
    "smtp_host": "smtp.provider.example",
    "portal_base_url": "https://vendors.shazlo.store",
    "rate_limit_hmac_key": "k" * 32,
}


@pytest.mark.parametrize(
    "issuer",
    [
        "http://localhost:8002",
        "https://localhost:8002",
        "https://127.0.0.1",
        "http://vendor.example",
    ],
)
def test_prod_needs_a_public_https_issuer(issuer: str) -> None:
    with pytest.raises(ValidationError, match="JWT_ISSUER"):
        make(env="prod", **PROD_EMAIL, **{**PROD_IDENTITY, "jwt_issuer": issuer})


def test_the_issuer_must_differ_from_identity_apis() -> None:
    with pytest.raises(ValidationError, match="JWT_ISSUER must differ"):
        make(
            identity_jwks_url="http://identity-api:8001/.well-known/jwks.json",
            identity_issuer="http://localhost:8001/",
            jwt_issuer="http://localhost:8001",
        )


def test_prod_refuses_insecure_cookies() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SECURE"):
        make(env="prod", **PROD_EMAIL, **PROD_IDENTITY, cookie_secure=False)
    assert make(env="prod", **PROD_EMAIL, **PROD_IDENTITY).cookie_secure is True


def test_smtp_credentials_are_never_sent_without_tls() -> None:
    with pytest.raises(ValidationError, match="SMTP_SECURITY"):
        make(
            email_backend="smtp",
            smtp_host="mailpit",
            smtp_security="none",
            smtp_user="mailer",
            smtp_password="s3cret-value",  # noqa: S106
        )
    assert make(email_backend="smtp", smtp_host="mailpit", smtp_security="none").smtp_user is None


# --- Cloudinary --------------------------------------------------------------------------

CLOUDINARY = {
    "cloudinary_cloud_name": "demo",
    "cloudinary_api_key": "123456",
    "cloudinary_api_secret": "a-secret",
}


def test_cloudinary_is_optional_and_off_by_default() -> None:
    s = make()
    assert (s.cloudinary_cloud_name, s.cloudinary_api_key, s.cloudinary_api_secret) == (
        None,
        None,
        None,
    )
    assert s.cloudinary_root_folder == "shazlo"
    assert s.cloudinary_upload_preset is None
    assert s.upload_max_bytes == 10 * 1024 * 1024


def test_cloudinary_credentials_work_together_and_the_secret_stays_secret() -> None:
    s = make(**CLOUDINARY)
    assert s.cloudinary_cloud_name == "demo"
    assert s.cloudinary_api_secret is not None
    assert s.cloudinary_api_secret.get_secret_value() == "a-secret"
    assert "a-secret" not in repr(s)


@pytest.mark.parametrize("missing", list(CLOUDINARY))
def test_cloudinary_credentials_all_or_none(missing: str) -> None:
    partial = {k: v for k, v in CLOUDINARY.items() if k != missing}
    with pytest.raises(ValidationError, match="go together"):
        make(**partial)


def test_blank_cloudinary_values_copied_from_the_example_file_mean_not_set() -> None:
    s = make(cloudinary_cloud_name="", cloudinary_api_key=" ", cloudinary_api_secret="")
    assert s.cloudinary_cloud_name is None and s.cloudinary_api_secret is None


@pytest.mark.parametrize("name", ["has space", "a/b", "demo.cloud", "x;y"])
def test_a_cloud_name_with_odd_characters_is_refused(name: str) -> None:
    with pytest.raises(ValidationError, match="CLOUDINARY_CLOUD_NAME"):
        make(**{**CLOUDINARY, "cloudinary_cloud_name": name})


@pytest.mark.parametrize(
    ("folder", "expected"),
    [("shazlo", "shazlo"), ("/shazlo/staging/", "shazlo/staging"), (" dev_1 ", "dev_1")],
)
def test_the_root_folder_is_normalised(folder: str, expected: str) -> None:
    assert make(cloudinary_root_folder=folder).cloudinary_root_folder == expected


@pytest.mark.parametrize("folder", ["", "/", "Shazlo", "a//b", "../up", "a b", "a/../b"])
def test_a_root_folder_that_could_escape_or_clash_is_refused(folder: str) -> None:
    with pytest.raises(ValidationError, match="CLOUDINARY_ROOT_FOLDER"):
        make(cloudinary_root_folder=folder)


@pytest.mark.parametrize("size", [0, -1, 100 * 1024 * 1024 + 1])
def test_the_upload_size_limit_has_sane_bounds(size: int) -> None:
    with pytest.raises(ValidationError):
        make(upload_max_bytes=size)


def test_asset_sign_is_a_known_rate_limited_endpoint() -> None:
    s = make(rate_limit_fail_closed=["asset_sign"])
    assert s.rate_limit_fail_closed == ["asset_sign"]
    assert (s.rate_limit_asset_sign_user.limit, s.rate_limit_asset_sign_user.window_seconds) == (
        60,
        3600,
    )


# --- Bulk import -------------------------------------------------------------------------


def test_the_import_limits_have_defaults_and_bounds() -> None:
    s = make()
    assert (s.import_max_bytes, s.import_max_rows) == (2 * 1024 * 1024, 1000)
    rule = s.rate_limit_bulk_import_vendor
    assert (rule.limit, rule.window_seconds) == (10, 3600)
    bad_values: list[dict[str, int]] = [
        {"import_max_bytes": 0},
        {"import_max_bytes": 20 * 1024 * 1024 + 1},
        {"import_max_rows": 0},
        {"import_max_rows": 5001},
    ]
    for bad in bad_values:
        with pytest.raises(ValidationError):
            make(**bad)


def test_bulk_import_is_a_known_rate_limited_endpoint() -> None:
    assert make(rate_limit_fail_closed=["bulk_import"]).rate_limit_fail_closed == ["bulk_import"]
