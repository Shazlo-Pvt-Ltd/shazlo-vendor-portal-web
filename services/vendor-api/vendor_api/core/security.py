"""Builds the shazlo_security and shazlo_auth configuration from vendor-api's settings."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from shazlo_security.keys import KeyRing, KeyRingConfig
from shazlo_security.passwords import PasswordConfig
from shazlo_security.refresh_tokens import RefreshTokenConfig
from shazlo_security.tokens import TokenIssuer

from vendor_api.core.settings import Settings

# Every Redis key of the refresh-token store starts with this (`vendor:rf:`, `vendor:rt:`, ...) and
# the refresh cookie is `vendor_refresh` (api/auth.py): identity-api uses `identity:` and
# `identity_refresh`, so the two never collide on a shared Redis or parent domain (ADR 0010).
REFRESH_KEY_PREFIX = "vendor:"


def refresh_token_config(settings: Settings) -> RefreshTokenConfig:
    return RefreshTokenConfig(
        prefix=REFRESH_KEY_PREFIX,
        token_ttl=timedelta(days=settings.refresh_token_ttl_days),
        family_max_ttl=timedelta(days=settings.refresh_family_max_days),
        reuse_grace_seconds=settings.refresh_reuse_grace_seconds,
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
