"""Builds the shazlo_security configuration from identity-api's settings."""

from shazlo_security.passwords import PasswordConfig
from shazlo_security.rate_limit import RateLimitConfig

from identity_api.core.settings import Settings

# Every Redis key of the rate limiter starts with this, so identity-api and vendor-api can share
# one Redis without seeing each other's counters (ADR 0010).
RATE_LIMIT_KEY_PREFIX = "identity:rl:"


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
