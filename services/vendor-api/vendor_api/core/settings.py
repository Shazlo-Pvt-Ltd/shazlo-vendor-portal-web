import ipaddress
import re
import secrets
from functools import lru_cache
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import BeforeValidator, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from shazlo_auth.jwks import check_jwks_url
from shazlo_security.rate_limit import RateRule

from vendor_api.db.session import POSTGRES_SCHEMES

# The endpoints that have limits (the names `RATE_LIMIT_FAIL_CLOSED` may list).
RATE_LIMITED_ENDPOINTS = frozenset(
    {
        "login",
        "signup",
        "resend_verification",
        "verify_email",
        "forgot_password",
        "set_password",
        "refresh",
        "change_password",
        "staff_invite",
        "asset_sign",
        "bulk_import",
    }
)
# HMAC-SHA256 keys shorter than this are guessable enough to reverse the hashed emails in Redis.
MIN_HMAC_KEY_LENGTH = 32
# A Cloudinary folder path: lower-case segments, so one environment's files never land in another's.
FOLDER_PATH = re.compile(r"^[a-z0-9_-]+(/[a-z0-9_-]+)*$")
# Hosts a production JWT_ISSUER must not name.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})  # noqa: S104


def _parse_rule(value: object) -> object:
    """Accepts `"<limit>/<window seconds>"` (e.g. `5/900`) so environment values stay short."""
    if isinstance(value, str):
        limit, separator, window = value.partition("/")
        if not separator:
            raise ValueError('use "<limit>/<window seconds>", e.g. "5/900"')
        return {"limit": limit.strip(), "window_seconds": window.strip()}
    return value


# NoDecode: the environment value is "5/900", not JSON.
Rule = Annotated[RateRule, BeforeValidator(_parse_rule), NoDecode]


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

    # Argon2id cost (OWASP baseline: 19 MiB, 2 passes, 1 lane). Raising any of these makes
    # existing hashes rehash on the next successful login.
    argon2_memory_cost_kib: int = 19_456
    argon2_time_cost: int = 2
    argon2_parallelism: int = 1
    password_min_length: int = 12

    # Admin tokens come from identity-api (ADR 0009), verified through its JWKS: `/v1/admin/*`
    # accepts only those, `/v1/vendor/*` only vendor-api's own. The JWKS is fetched lazily on the
    # first admin token and cached, so vendor-api starts and serves vendors while identity-api is
    # down. Both settings go together; outside dev the URL must be https, and prod needs them.
    identity_jwks_url: str | None = None
    identity_issuer: str | None = None

    # Rate limits (ADR 0009), as "<limit>/<window seconds>". Most endpoints have a limit per
    # client IP and one per subject: the email (hashed) for endpoints that send mail or check a
    # password, the refresh family for refresh, the user for change-password and the vendor for
    # staff invites. A subject is never stored in plain text.
    rate_limit_login_ip: Rule = RateRule(limit=20, window_seconds=60)
    # Failed logins for one email from one client IP (the strict one). Keyed on the pair, so
    # nobody can lock a vendor out from another network.
    rate_limit_login_email: Rule = RateRule(limit=5, window_seconds=900)
    # Every login for one email from any IP (loose): slows guessing spread over many IPs.
    rate_limit_login_email_global: Rule = RateRule(limit=50, window_seconds=3600)
    # Signup creates an account and sends an email (verification, or "you already have one"), so
    # it is limited per IP and per address: nobody can mail-bomb an inbox through it.
    rate_limit_signup_ip: Rule = RateRule(limit=10, window_seconds=3600)
    rate_limit_signup_email: Rule = RateRule(limit=3, window_seconds=3600)
    rate_limit_resend_verification_ip: Rule = RateRule(limit=10, window_seconds=3600)
    rate_limit_resend_verification_email: Rule = RateRule(limit=3, window_seconds=3600)
    rate_limit_verify_email_ip: Rule = RateRule(limit=20, window_seconds=60)
    # Used by the password-reset and invite endpoints (issue #83).
    rate_limit_forgot_password_ip: Rule = RateRule(limit=10, window_seconds=3600)
    rate_limit_forgot_password_email: Rule = RateRule(limit=3, window_seconds=3600)
    rate_limit_set_password_ip: Rule = RateRule(limit=20, window_seconds=900)
    rate_limit_staff_invite_vendor: Rule = RateRule(limit=20, window_seconds=3600)
    rate_limit_refresh_ip: Rule = RateRule(limit=60, window_seconds=60)
    rate_limit_refresh_session: Rule = RateRule(limit=20, window_seconds=60)
    rate_limit_change_password_user: Rule = RateRule(limit=5, window_seconds=900)
    # Signing an upload lets a user store a file at the provider, so it is limited per user.
    # Not fail-closed by default (a Redis outage should not stop uploads); add `asset_sign` to
    # RATE_LIMIT_FAIL_CLOSED to make it so.
    rate_limit_asset_sign_user: Rule = RateRule(limit=60, window_seconds=3600)
    # A bulk import (or a validation run of one) parses a whole file, so it is limited per vendor.
    # Not fail-closed by default; add `bulk_import` to RATE_LIMIT_FAIL_CLOSED to make it so.
    rate_limit_bulk_import_vendor: Rule = RateRule(limit=10, window_seconds=3600)
    # What happens when Redis is down. Endpoints listed here answer 503 (fail closed): the ones
    # that check a password (login, change_password) so guessing stays limited, and the ones that
    # send email (signup, resend_verification, forgot_password, staff_invite) so an outage cannot
    # be used to flood an inbox. The others skip the limit and log a warning (fail open):
    # refresh (signed-in vendors keep working), verify_email and set_password (they need a 256-bit
    # token, which cannot be guessed at any rate).
    rate_limit_fail_closed: Annotated[list[str], NoDecode] = [
        "login",
        "signup",
        "resend_verification",
        "forgot_password",
        "change_password",
        "staff_invite",
    ]
    # Keys the hashes that name subjects in Redis, so a Redis dump does not reveal emails.
    # Every instance must share it, and it is not identity-api's. Required in prod; elsewhere a
    # random key per process. At least 32 characters when set; empty counts as unset.
    rate_limit_hmac_key: SecretStr | None = None
    # IPv6 clients are counted per network of this prefix length, because one host usually
    # holds a whole /64 and could otherwise rotate addresses to dodge the per-IP limits.
    rate_limit_ipv6_prefix: int = 64
    # Networks of the reverse proxies whose X-Forwarded-For header is believed (CIDR, comma
    # separated). Empty: the header is ignored and the TCP peer is the client.
    trusted_proxies: Annotated[list[str], NoDecode] = []

    # Sessions: a refresh token lives 7 days and never outlives its family (30 days after login).
    refresh_token_ttl_days: int = 7
    refresh_family_max_days: int = 30
    # A refresh token used again within this many seconds is a concurrent request (a second tab),
    # not theft: it gets 409 and nothing is revoked. 0 makes any reuse revoke the family.
    refresh_reuse_grace_seconds: int = Field(default=10, ge=0, le=60)

    # How long an invite link (a staff invite, or the invite of a migrated vendor's owner) works,
    # and how long a password-reset link works. A reset is short because it replaces the password.
    invite_token_ttl_minutes: int = Field(default=24 * 60, ge=5, le=14 * 24 * 60)
    reset_token_ttl_minutes: int = Field(default=60, ge=5, le=24 * 60)

    # How long an email-verification link works (24 hours).
    email_verification_ttl_minutes: int = Field(default=24 * 60, ge=5, le=7 * 24 * 60)

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

    # Cloudinary (ADR 0005): images upload straight from the browser with a signature made here,
    # so the API never handles file bytes. The three credentials go together; without them the
    # asset endpoints answer 503 `uploads_not_configured` and everything else works.
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    # A secret with no default: set it in the environment, never in the repository.
    cloudinary_api_secret: SecretStr | None = None
    # Every file lives under `<root>/vendors/<vendor id>/...`. Give each environment its own root.
    cloudinary_root_folder: str = "shazlo"
    # Optional: the name of an upload preset (created in Cloudinary) that is signed into every
    # upload, so the provider can enforce its own size and format limits as a second layer.
    cloudinary_upload_preset: str | None = None
    # Largest image accepted, in bytes. Checked when signing (the size the client declares) and
    # again when registering (the size Cloudinary reports, which is the one that counts).
    upload_max_bytes: int = Field(default=10 * 1024 * 1024, gt=0, le=100 * 1024 * 1024)
    # Bulk product import (.xlsx / .csv): the largest file in bytes, and the most data rows (blank
    # rows do not count). Both are checked before anything is parsed or written.
    import_max_bytes: int = Field(default=2 * 1024 * 1024, gt=0, le=20 * 1024 * 1024)
    import_max_rows: int = Field(default=1000, gt=0, le=5000)

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

    @field_validator("rate_limit_fail_closed", "trusted_proxies", mode="before")
    @classmethod
    def _split_list(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("rate_limit_fail_closed")
    @classmethod
    def _check_fail_closed(cls, value: list[str]) -> list[str]:
        unknown = set(value) - RATE_LIMITED_ENDPOINTS
        if unknown:
            raise ValueError(
                f"unknown endpoint(s) {sorted(unknown)}; use {sorted(RATE_LIMITED_ENDPOINTS)}"
            )
        return value

    @field_validator("trusted_proxies")
    @classmethod
    def _check_trusted_proxies(cls, value: list[str]) -> list[str]:
        for network in value:
            ipaddress.ip_network(network)  # raises ValueError on a bad CIDR
        return value

    @field_validator("rate_limit_ipv6_prefix")
    @classmethod
    def _check_ipv6_prefix(cls, value: int) -> int:
        if not 1 <= value <= 128:
            raise ValueError("must be between 1 and 128")
        return value

    @model_validator(mode="after")
    def _check_identity(self) -> Self:
        url = (self.identity_jwks_url or "").strip() or None
        issuer = (self.identity_issuer or "").strip() or None
        self.identity_jwks_url, self.identity_issuer = url, issuer
        if (url is None) != (issuer is None):
            raise ValueError("IDENTITY_JWKS_URL and IDENTITY_ISSUER go together")
        if url is None:
            if self.env == "prod":
                raise ValueError("IDENTITY_JWKS_URL and IDENTITY_ISSUER are required in prod")
            return self
        try:
            # Plain http is for dev (a compose hostname); anywhere else the keys that decide
            # which admin tokens are valid must not travel unprotected.
            check_jwks_url(url, allow_insecure=self.env == "dev")
        except ValueError as error:
            raise ValueError(f"IDENTITY_JWKS_URL: {error}") from error
        if self.env != "dev" and not url.startswith("https://"):
            raise ValueError("IDENTITY_JWKS_URL must be https outside dev")
        return self

    @model_validator(mode="after")
    def _rate_limit_key(self) -> Self:
        key = self.rate_limit_hmac_key
        if key is not None and not key.get_secret_value().strip():
            key = None  # `RATE_LIMIT_HMAC_KEY=` copied from .env.example means "not set"
        if key is None:
            if self.env == "prod":
                raise ValueError("RATE_LIMIT_HMAC_KEY is required in prod")
            key = SecretStr(secrets.token_hex(32))
        elif len(key.get_secret_value()) < MIN_HMAC_KEY_LENGTH:
            # In every env: a short key set on purpose is a mistake wherever it is made.
            raise ValueError(
                f"RATE_LIMIT_HMAC_KEY must be at least {MIN_HMAC_KEY_LENGTH} characters"
            )
        self.rate_limit_hmac_key = key
        return self

    @field_validator("portal_base_url")
    @classmethod
    def _check_portal_base_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")) or " " in value or "#" in value:
            raise ValueError(
                "must be an http(s) address without a fragment, e.g. https://vendors.shazlo.store"
            )
        return value

    @model_validator(mode="after")
    def _check_cloudinary(self) -> Self:
        # `CLOUDINARY_API_KEY=` copied from .env.example means "not set".
        name = (self.cloudinary_cloud_name or "").strip() or None
        key = (self.cloudinary_api_key or "").strip() or None
        secret = self.cloudinary_api_secret
        if secret is not None and not secret.get_secret_value().strip():
            secret = None
        self.cloudinary_cloud_name, self.cloudinary_api_key = name, key
        self.cloudinary_api_secret = secret
        if len({name is None, key is None, secret is None}) != 1:
            raise ValueError(
                "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET go together"
            )
        if name is not None and not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            raise ValueError("CLOUDINARY_CLOUD_NAME may only hold letters, digits, - and _")
        root = self.cloudinary_root_folder.strip().strip("/")
        if not FOLDER_PATH.match(root):
            raise ValueError(
                "CLOUDINARY_ROOT_FOLDER must be lower-case letters, digits, - and _ "
                "(segments may be separated by /)"
            )
        self.cloudinary_root_folder = root
        self.cloudinary_upload_preset = (self.cloudinary_upload_preset or "").strip() or None
        return self

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
        if self.smtp_user and self.smtp_security == "none":
            # smtplib would send the credentials in clear text, in any environment.
            raise ValueError("SMTP_USER and SMTP_PASSWORD need SMTP_SECURITY=starttls or ssl")
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
        if self.env == "prod" and not self.cookie_secure:
            raise ValueError("COOKIE_SECURE=false is not allowed in prod")
        return self

    @model_validator(mode="after")
    def _check_issuer(self) -> "Settings":
        issuer = self.jwt_issuer.strip().rstrip("/")
        if self.env == "prod":
            host = urlsplit(issuer).hostname or ""
            if not issuer.startswith("https://") or host in LOCAL_HOSTS:
                # The default (http://localhost:8002) left in place would put a localhost `iss`
                # into every production token.
                raise ValueError("JWT_ISSUER must be this service's public https URL in prod")
        if self.identity_issuer and issuer == self.identity_issuer.strip().rstrip("/"):
            # Vendor and admin tokens share `aud=vendor-api`; the issuer is one of the two things
            # (with the signing keys) that keeps them apart.
            raise ValueError("JWT_ISSUER must differ from IDENTITY_ISSUER")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
