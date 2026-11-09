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
