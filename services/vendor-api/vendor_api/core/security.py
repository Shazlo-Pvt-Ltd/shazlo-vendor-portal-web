"""Builds the shazlo_security and shazlo_auth configuration from vendor-api's settings."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from shazlo_security.keys import KeyRing, KeyRingConfig
from shazlo_security.passwords import PasswordConfig
from shazlo_security.rate_limit import RateLimitConfig
from shazlo_security.refresh_tokens import RefreshTokenConfig
from shazlo_security.signing import RequestSigner, SigningKey
from shazlo_security.tokens import TokenIssuer

from vendor_api.core.settings import Settings

# Every Redis key of the refresh-token store starts with this (`vendor:rf:`, `vendor:rt:`, ...) and
# the refresh cookie is `vendor_refresh` (api/auth.py): identity-api uses `identity:` and
# `identity_refresh`, so the two never collide on a shared Redis or parent domain (ADR 0010).
REFRESH_KEY_PREFIX = "vendor:"
# The rate limiter's keys start with this (`vendor:rl:<endpoint>:<scope>:<hash>`).
RATE_LIMIT_KEY_PREFIX = "vendor:rl:"


def refresh_token_config(settings: Settings) -> RefreshTokenConfig:
    return RefreshTokenConfig(
        prefix=REFRESH_KEY_PREFIX,
        token_ttl=timedelta(days=settings.refresh_token_ttl_days),
        family_max_ttl=timedelta(days=settings.refresh_family_max_days),
        reuse_grace_seconds=settings.refresh_reuse_grace_seconds,
    )


def rate_limit_config(settings: Settings) -> RateLimitConfig:
    key = settings.rate_limit_hmac_key
    if key is None:  # Settings fills it in, so this is a programming error
        raise ValueError("rate_limit_hmac_key is not set")
    return RateLimitConfig(
        hmac_key=key.get_secret_value().encode(),
        fail_closed=frozenset(settings.rate_limit_fail_closed),
    )


def password_config(settings: Settings) -> PasswordConfig:
    return PasswordConfig(
        time_cost=settings.argon2_time_cost,
        memory_cost_kib=settings.argon2_memory_cost_kib,
        parallelism=settings.argon2_parallelism,
    )


def key_ring_config(settings: Settings) -> KeyRingConfig:
    keys = settings.jwt_keys
    return KeyRingConfig(
        keys_dir=settings.jwt_keys_dir,
        keys_json=keys.get_secret_value() if keys is not None else None,
        signing_kid=settings.jwt_signing_kid,
    )


def token_issuer(
    settings: Settings, keyring: KeyRing, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
) -> TokenIssuer:
    return TokenIssuer(
        settings.jwt_issuer,
        keyring,
        access_ttl_seconds=settings.access_token_ttl_seconds,
        clock=clock,
    )


def central_request_signer(
    settings: Settings, clock: Callable[[], float] | None = None
) -> RequestSigner | None:
    """The signer for requests to the central app, or None while publishing is off."""
    if not settings.central_publishing_enabled:
        return None
    secret = settings.central_signing_secret
    if secret is None or settings.central_signing_key_id is None:  # Settings checks this
        raise ValueError("the central signing key is not set")
    key = SigningKey(settings.central_signing_key_id, secret.get_secret_value().encode())
    return RequestSigner(key) if clock is None else RequestSigner(key, clock)
