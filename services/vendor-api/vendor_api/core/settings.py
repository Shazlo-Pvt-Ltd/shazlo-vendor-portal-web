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

    # Transactional email (signup verification, invites, password reset). The code depends on a
    # small interface; the provider is this setting. `console` sends nothing (it logs the link
    # in dev only), `smtp` works with Mailpit locally and with most providers in production.
    email_backend: Literal["console", "smtp"] = "console"
    email_from: str = "Shazlo <no-reply@shazlo.store>"
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_user: str | None = None
    # A secret with no default: set it in the environment, never in the repository.
    smtp_password: SecretStr | None = None
    # `none` is for a local catcher only: production refuses it.
    smtp_security: Literal["none", "starttls", "ssl"] = "starttls"
    # Give up on an email after this many tries (a pause that doubles between them).
    email_send_attempts: int = Field(default=3, ge=1, le=10)
    # The vendor portal's address, without a trailing slash: the links in emails point here.
    portal_base_url: str = "http://localhost:5174"

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

    @field_validator("portal_base_url")
    @classmethod
    def _check_portal_base_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")) or " " in value or "#" in value:
            raise ValueError(
                "must be an http(s) address without a fragment, e.g. https://vendors.shazlo.store"
            )
        return value

    @field_validator("email_from")
    @classmethod
    def _check_email_from(cls, value: str) -> str:
        value = value.strip()
        if "@" not in value or "\r" in value or "\n" in value:
            raise ValueError("must be an address such as 'Shazlo <no-reply@shazlo.store>'")
        return value

    @model_validator(mode="after")
    def _check_email(self) -> "Settings":
        if self.email_backend == "smtp" and not self.smtp_host:
            raise ValueError("EMAIL_BACKEND=smtp requires SMTP_HOST")
        if bool(self.smtp_user) != bool(
            self.smtp_password and self.smtp_password.get_secret_value()
        ):
            raise ValueError("SMTP_USER and SMTP_PASSWORD go together")
        if self.env == "prod":
            if self.email_backend != "smtp":
                raise ValueError("EMAIL_BACKEND=console sends nothing: use smtp in prod")
            if self.smtp_security == "none":
                raise ValueError("SMTP_SECURITY=none is not allowed in prod")
            if not self.portal_base_url.startswith("https://"):
                raise ValueError("PORTAL_BASE_URL must be https in prod")
        return self

    @model_validator(mode="after")
    def _check_cookie(self) -> "Settings":
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
