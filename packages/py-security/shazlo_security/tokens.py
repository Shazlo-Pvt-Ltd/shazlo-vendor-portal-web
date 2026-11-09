import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import jwt

from shazlo_security.keys import ALGORITHM, KeyRing

Clock = Callable[[], datetime]

# Claims the issuer (and the verifier) own; an extra claim may not use these names.
RESERVED_CLAIMS = frozenset(
    {"iss", "sub", "aud", "exp", "nbf", "iat", "jti", "roles", "must_change_password"}
)


@dataclass(frozen=True)
class IssuedToken:
    token: str
    expires_at: datetime
    jti: str
    # `exp - iat` of the token, for `expires_in`.
    lifetime_seconds: int


class TokenIssuer:
    """Signs access tokens (ADR 0009): one audience each, ids and roles only."""

    def __init__(
        self,
        issuer: str,
        keyring: KeyRing,
        *,
        access_ttl_seconds: int,
        clock: Clock = lambda: datetime.now(UTC),
    ) -> None:
        self._issuer = issuer
        self._ttl_seconds = access_ttl_seconds
        self._keyring = keyring
        self._clock = clock

    def issue(
        self,
        *,
        subject: uuid.UUID,
        roles: Sequence[str],
        audience: str,
        must_change_password: bool = False,
        ttl_seconds: int | None = None,
        not_after: datetime | None = None,
        extra_claims: Mapping[str, Any] | None = None,
    ) -> IssuedToken:
        """`audience` is a single service name; there is deliberately no way to pass several.

        No email or name goes into the token; login and `GET /v1/me` return those.

        A token for an admin who must change their password carries no roles, so no service
        grants it anything, and a `must_change_password` claim that identity-api itself checks.

        `ttl_seconds` replaces the access-token lifetime; `not_after` caps `exp` (an exchanged
        token never outlives the token that asked for it). A token that would already be
        expired is refused with `TokenWindowClosedError`.

        `extra_claims` adds claims of the service's own (vendor-api adds `vendor_id`). They
        cannot replace a claim set here: that raises ValueError. Keep them to ids, never
        personal data.
        """
        if not audience:
            raise ValueError("audience is required")
        issued_at = int(self._clock().timestamp())
        expires_at = issued_at + (self._ttl_seconds if ttl_seconds is None else ttl_seconds)
        if not_after is not None:
            expires_at = min(expires_at, int(not_after.timestamp()))
        if expires_at <= issued_at:
            raise TokenWindowClosedError("the token would already be expired")
        jti = uuid.uuid4().hex
        claims: dict[str, Any] = {
            "iss": self._issuer,
            "sub": str(subject),
            "aud": audience,
            "roles": [] if must_change_password else list(roles),
            "iat": issued_at,
            "exp": expires_at,
            "jti": jti,
        }
        if must_change_password:
            claims["must_change_password"] = True
        for name, value in (extra_claims or {}).items():
            if name in RESERVED_CLAIMS:
                raise ValueError(f"{name!r} is set by the issuer and cannot be an extra claim")
            claims[name] = value
        signing = self._keyring.signing
        token = jwt.encode(
            claims, signing.private_key, algorithm=ALGORITHM, headers={"kid": signing.kid}
        )
        return IssuedToken(
            token, datetime.fromtimestamp(expires_at, UTC), jti, expires_at - issued_at
        )


class TokenWindowClosedError(ValueError):
    """`not_after` is not in the future, so any token issued now would already be expired."""
