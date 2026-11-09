"""Builds the shazlo_security and shazlo_auth configuration from vendor-api's settings."""

from collections.abc import Callable
from datetime import UTC, datetime

from shazlo_security.keys import KeyRing, KeyRingConfig
from shazlo_security.tokens import TokenIssuer

from vendor_api.core.settings import Settings


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
