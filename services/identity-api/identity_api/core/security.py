"""Builds the shazlo_security configuration from identity-api's settings."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from shazlo_security.keys import KeyRing, KeyRingConfig
from shazlo_security.passwords import PasswordConfig
from shazlo_security.rate_limit import RateLimitConfig
from shazlo_security.refresh_tokens import RefreshTokenConfig
from shazlo_security.tokens import TokenIssuer

from identity_api.core.settings import Settings

# Every Redis key of the rate limiter starts with this, so identity-api and vendor-api can share
# one Redis without seeing each other's counters (ADR 0010).
RATE_LIMIT_KEY_PREFIX = "identity:rl:"
# Refresh-token keys are `identity:rf:`, `identity:ra:`, `identity:rg:`, `identity:rt:` and
# `identity:rtu:`; the refresh cookie is `identity_refresh` (api/auth.py). vendor-api uses
# `vendor:` and `vendor_refresh`, so the two never collide on a shared Redis or domain.
REFRESH_KEY_PREFIX = "identity:"


def password_config(settings: Settings) -> PasswordConfig:
    return PasswordConfig(
        time_cost=settings.argon2_time_cost,
        memory_cost_kib=settings.argon2_memory_cost_kib,
        parallelism=settings.argon2_parallelism,
    )


def rate_limit_config(settings: Settings) -> RateLimitConfig:
    key = settings.rate_limit_hmac_key
    if key is None:  # Settings fills it in, so this is a programming error
        raise ValueError("rate_limit_hmac_key is not set")
    return RateLimitConfig(
        hmac_key=key.get_secret_value().encode(),
        fail_closed=frozenset(settings.rate_limit_fail_closed),
    )


def refresh_token_config(settings: Settings) -> RefreshTokenConfig:
    return RefreshTokenConfig(
        prefix=REFRESH_KEY_PREFIX,
        token_ttl=timedelta(days=settings.refresh_token_ttl_days),
        family_max_ttl=timedelta(days=settings.refresh_family_max_days),
        reuse_grace_seconds=settings.refresh_reuse_grace_seconds,
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
