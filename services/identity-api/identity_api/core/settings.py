from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment (and `.env` in local dev).

    Settings that carry credentials have no default, so the app refuses to start without them.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"

    database_url: str
    redis_url: str

    # Origins allowed to call the API with credentials (the Shazlo-One shell).
    # Comma separated in the environment.
    cors_allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # Refresh-token cookie. `Secure` is on by default; turn it off only for local dev.
    # SameSite=None requires Secure (browsers drop the cookie otherwise), so that pair is refused.
    # The cookie-authenticated endpoints also check Origin against `cors_allowed_origins`.
    cookie_secure: bool = True
    cookie_samesite: Literal["strict", "lax", "none"] = "strict"
    cookie_domain: str | None = None

    jwt_issuer: str = "http://localhost:8001"
    # RS256 keys, from a directory of `<kid>.pem` files and/or a JSON object {"<kid>": "<PEM>"}.
    # `jwt_signing_kid` picks the key that signs; the others are only published in the JWKS.
    jwt_keys_dir: str | None = None
    jwt_keys: SecretStr | None = None
    jwt_signing_kid: str | None = None
    # Which roles may get a token for which service (ADR 0009), as JSON in the environment.
    # An admin gets a token for a service if at least one of their roles is listed for it.
    # Adding a service is a settings change only.
    audience_roles: dict[str, list[str]] = {
        "identity-api": ["super_admin", "vendor_reviewer"],
        "vendor-api": ["super_admin", "vendor_reviewer"],
    }
    # Bounded so a typo cannot issue tokens that never verify (0 or negative) or that outlive
    # key rotation (the rotation runbook's waits assume at most an hour).
    access_token_ttl_seconds: int = Field(default=15 * 60, gt=0, le=3600)
    refresh_token_ttl_days: int = 7
    refresh_family_max_days: int = 30
    # Two tabs that refresh at the same moment send the same token, and the second one looks
    # like reuse of a stolen token. A token reused less than this many seconds after its first
    # use gets 409 `refresh_conflict` instead: nothing is revoked, and the browser already holds
    # the new cookie the first request set, so a retry works. The trade-off: inside the window a
    # replay is not treated as theft. A thief who replays a token just after the real client gets
    # no new token, but goes unnoticed; if the thief refreshes first, the real client's refresh
    # gets 409 and the family is only revoked when the client tries again after the window.
    # 0 disables the window (any reuse revokes the family at once).
    refresh_reuse_grace_seconds: int = Field(default=10, ge=0, le=60)

    # Argon2id cost (OWASP baseline: 19 MiB, 2 passes, 1 lane). Raising any of these makes
    # existing hashes rehash on the next successful login.
    argon2_memory_cost_kib: int = 19_456
    argon2_time_cost: int = 2
    argon2_parallelism: int = 1

    password_min_length: int = 12

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("audience_roles")
    @classmethod
    def _check_audience_roles(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        if "identity-api" not in value:
            raise ValueError("must include identity-api, the audience of the shell's own token")
        if any(not audience or not roles for audience, roles in value.items()):
            raise ValueError("every audience needs a name and at least one role")
        return value

    @field_validator("database_url")
    @classmethod
    def _check_database_url(cls, value: str) -> str:
        if not value.startswith(("postgresql://", "postgresql+asyncpg://")):
            raise ValueError("must start with postgresql:// or postgresql+asyncpg://")
        return value

    @field_validator("redis_url")
    @classmethod
    def _check_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://")):
            raise ValueError("must start with redis:// or rediss://")
        return value

    @model_validator(mode="after")
    def _check_cookie_flags(self) -> "Settings":
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("cookie_samesite='none' requires cookie_secure=true")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
