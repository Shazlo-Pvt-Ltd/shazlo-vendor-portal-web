from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from vendor_api.db.session import POSTGRES_SCHEMES


class Settings(BaseSettings):
    """Runtime configuration, read from the environment (and `.env` in local dev).

    Settings that carry credentials have no default, so the app refuses to start without them.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"

    database_url: str
    redis_url: str

    # Origins allowed to call the API with credentials (the vendor portal).
    # Comma separated in the environment.
    cors_allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5174"]

    # Refresh-token cookie (added with vendor login). `Secure` is on by default; turn it off only
    # for local dev. SameSite=None requires Secure (browsers drop the cookie otherwise).
    cookie_secure: bool = True
    cookie_samesite: Literal["strict", "lax", "none"] = "strict"
    cookie_domain: str | None = None

    # The `iss` of the tokens vendor-api issues itself (ADR 0009): this service's base URL.
    jwt_issuer: str = "http://localhost:8002"
    # RS256 keys, from a directory of `<kid>.pem` files and/or a JSON object {"<kid>": "<PEM>"}.
    # `jwt_signing_kid` picks the key that signs; the others are only published in the JWKS.
    # vendor-api has its own keys, never identity-api's (ADR 0009). The service refuses to start
    # without one: create it with `python -m vendor_api.cli generate-key`.
    jwt_keys_dir: str | None = None
    jwt_keys: SecretStr | None = None
    jwt_signing_kid: str | None = None
    access_token_ttl_seconds: int = Field(default=15 * 60, gt=0, le=3600)

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def _check_origins(cls, value: list[str]) -> list[str]:
        # A wildcard cannot be combined with credentials, so it is never what is meant.
        if "*" in value:
            raise ValueError("a wildcard origin is not allowed: credentials are enabled")
        return value

    @field_validator("database_url")
    @classmethod
    def _check_database_url(cls, value: str) -> str:
        if not value.startswith(POSTGRES_SCHEMES):
            raise ValueError("must start with " + ", ".join(POSTGRES_SCHEMES))
        return value

    @field_validator("redis_url")
    @classmethod
    def _check_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://")):
            raise ValueError("must start with redis:// or rediss://")
        return value

    @model_validator(mode="after")
    def _check_cookie(self) -> "Settings":
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
