import pytest
from pydantic import ValidationError

from identity_api.core.settings import Settings

PROD = {"env": "prod", "jwt_issuer": "https://identity.shazlo.example"}


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
    assert s.cors_allowed_origins == ["http://localhost:5173"]
    assert s.cookie_secure is True
    assert s.cookie_samesite == "strict"
    assert s.access_token_ttl_seconds == 900
    assert s.exchanged_token_ttl_seconds == 300
    # identity-api tokens come from login and refresh only, never from the token exchange.
    assert "identity-api" not in s.audience_roles
    assert s.refresh_reuse_grace_seconds == 10


def test_cors_origins_are_comma_separated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://a.example, https://b.example ,")
    s = make()
    assert s.cors_allowed_origins == ["https://a.example", "https://b.example"]


def test_environment_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("ENV", "test")
    s = make()
    assert s.cookie_secure is False
    assert s.env == "test"


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@localhost/db",
        "postgresql+asyncpg://u:p@localhost/db",
        "postgresql+psycopg://u:p@localhost/db",
    ],
)
def test_database_url_schemes_are_accepted(url: str) -> None:
    assert make(database_url=url).database_url == url


@pytest.mark.parametrize(
    "overrides",
    [
        {"database_url": "mysql://x"},
        {"redis_url": "http://localhost"},
        {"env": "staging"},
        {"exchanged_token_ttl_seconds": 29},
        {"exchanged_token_ttl_seconds": 901},
        {"refresh_reuse_grace_seconds": -1},
        {"refresh_reuse_grace_seconds": 61},
        {"access_token_ttl_seconds": 0},
        {"access_token_ttl_seconds": -60},
        {"access_token_ttl_seconds": 3601},
    ],
)
def test_invalid_values_are_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        make(**overrides)


def test_rate_limit_defaults() -> None:
    s = make()
    assert (s.rate_limit_login_email.limit, s.rate_limit_login_email.window_seconds) == (5, 900)
    global_rule = s.rate_limit_login_email_global
    assert (global_rule.limit, global_rule.window_seconds) == (50, 3600)
    assert s.rate_limit_ipv6_prefix == 64
    assert s.rate_limit_fail_closed == ["login", "change_password"]
    assert s.trusted_proxies == []


def test_rate_limits_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_LOGIN_IP", "3/10")
    monkeypatch.setenv("RATE_LIMIT_FAIL_CLOSED", "login, refresh,")
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.0/8, 192.168.1.5/32")
    s = make()
    assert (s.rate_limit_login_ip.limit, s.rate_limit_login_ip.window_seconds) == (3, 10)
    assert s.rate_limit_fail_closed == ["login", "refresh"]
    assert s.trusted_proxies == ["10.0.0.0/8", "192.168.1.5/32"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"rate_limit_login_ip": "5"},
        {"rate_limit_login_ip": "0/60"},
        {"rate_limit_login_ip": "5/0"},
        {"rate_limit_login_ip": "many/60"},
        {"rate_limit_fail_closed": ["logn"]},
        {"trusted_proxies": ["not-a-network"]},
        {**PROD},  # no RATE_LIMIT_HMAC_KEY
        {**PROD, "rate_limit_hmac_key": ""},
        {**PROD, "rate_limit_hmac_key": "   "},
        {**PROD, "rate_limit_hmac_key": "x" * 31},
        {"rate_limit_hmac_key": "short"},  # a short key is refused outside prod too
        {"rate_limit_ipv6_prefix": 0},
        {"rate_limit_ipv6_prefix": 129},
    ],
)
def test_invalid_rate_limit_settings_are_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        make(**overrides)


def test_hmac_key_is_random_outside_prod_and_never_empty() -> None:
    first, second = make(), make()
    assert first.rate_limit_hmac_key is not None and second.rate_limit_hmac_key is not None
    assert (
        first.rate_limit_hmac_key.get_secret_value()
        != second.rate_limit_hmac_key.get_secret_value()
    )


def test_a_32_character_hmac_key_is_accepted_in_prod() -> None:
    s = make(**PROD, rate_limit_hmac_key="x" * 32)
    assert s.rate_limit_hmac_key is not None
    assert s.rate_limit_hmac_key.get_secret_value() == "x" * 32


@pytest.mark.parametrize(
    "overrides",
    [
        {"cookie_secure": False},
        {"jwt_issuer": "http://localhost:8001"},  # the default left in place
        {"jwt_issuer": "https://localhost:8001"},
        {"jwt_issuer": "https://127.0.0.1"},
        {"jwt_issuer": "http://identity.shazlo.example"},  # not https
        {"jwt_issuer": "identity.shazlo.example"},
    ],
)
def test_unsafe_prod_settings_are_rejected(overrides: dict[str, object]) -> None:
    values = {**PROD, "rate_limit_hmac_key": "x" * 32, **overrides}
    with pytest.raises(ValidationError):
        make(**values)


def test_the_same_unsafe_settings_are_fine_outside_prod() -> None:
    s = make(cookie_secure=False, jwt_issuer="http://localhost:8001")
    assert s.cookie_secure is False


def test_an_empty_hmac_key_outside_prod_counts_as_unset() -> None:
    """`RATE_LIMIT_HMAC_KEY=` copied from .env.example gets a random key, not an empty one."""
    s = make(rate_limit_hmac_key="")
    assert s.rate_limit_hmac_key is not None
    assert len(s.rate_limit_hmac_key.get_secret_value()) == 64


def test_samesite_none_requires_secure() -> None:
    with pytest.raises(ValidationError, match="cookie_secure"):
        make(cookie_samesite="none", cookie_secure=False)
    s = make(cookie_samesite="none", cookie_secure=True)
    assert s.cookie_samesite == "none"
    # Lax or strict without Secure stays possible for local http development.
    assert make(cookie_samesite="lax", cookie_secure=False).cookie_secure is False


@pytest.mark.parametrize("seconds", [0, 60])
def test_reuse_grace_window_bounds_are_inclusive(seconds: int) -> None:
    assert make(refresh_reuse_grace_seconds=seconds).refresh_reuse_grace_seconds == seconds


@pytest.mark.parametrize("ttl", [1, 3600])
def test_access_token_ttl_bounds_are_inclusive(ttl: int) -> None:
    assert make(access_token_ttl_seconds=ttl).access_token_ttl_seconds == ttl
