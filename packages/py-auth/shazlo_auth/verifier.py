import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from types import MappingProxyType

import jwt

from shazlo_auth.claims import AccessClaims
from shazlo_auth.errors import InvalidTokenError
from shazlo_auth.keys import KeySource

ALGORITHM = "RS256"
LEEWAY_SECONDS = 30
REQUIRED_CLAIMS = ["exp", "iat", "iss", "sub", "aud", "jti", "roles"]
# Claims the verifier reads itself. Everything else in a token is returned as `extra`.
KNOWN_CLAIMS = frozenset({*REQUIRED_CLAIMS, "nbf", "must_change_password"})


class TokenVerifier:
    """Verifies identity-api access tokens for one service (ADR 0009).

    - Only RS256. The header's `alg` is checked before any key is looked up, so `none`, `HS*`
      (including an HMAC "signed" with the public key) and everything else is refused.
    - `iss`, `aud` and `exp` are checked, with 30 seconds of leeway. `aud` must be exactly this
      service's name as a single string: a token that lists several audiences is refused.
    - `sub` (a UUID), `roles` (a list of strings) and `kid` are required.
    - `required_extra_claims` names further claims the token must carry (vendor-api requires
      `vendor_id`). A token without one, or with it set to null, is refused. All other claims
      come back in `AccessClaims.extra`.
    """

    def __init__(
        self,
        keys: KeySource,
        *,
        issuer: str,
        audience: str,
        required_extra_claims: Sequence[str] = (),
    ) -> None:
        self._keys = keys
        self._issuer = issuer
        self._audience = audience
        known = KNOWN_CLAIMS & set(required_extra_claims)
        if known:
            raise ValueError(f"{sorted(known)} are checked already; list only extra claims")
        self._required_extra = tuple(required_extra_claims)

    async def verify(self, token: str) -> AccessClaims:
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != ALGORITHM:
                raise InvalidTokenError("only RS256 is accepted")
            kid = header.get("kid")
            if not isinstance(kid, str) or not kid:
                raise InvalidTokenError("kid is required")
            key = await self._keys.get_key(kid)
            if key is None:
                raise InvalidTokenError("unknown kid")
            claims = jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                audience=self._audience,
                issuer=self._issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": REQUIRED_CLAIMS},
            )
            if claims["aud"] != self._audience:  # PyJWT also accepts a list that contains it
                raise InvalidTokenError("aud must be a single service name")
            roles = claims["roles"]
            if not isinstance(roles, list) or not all(isinstance(role, str) for role in roles):
                raise InvalidTokenError("roles must be a list of strings")
            if not isinstance(claims["jti"], str):
                raise InvalidTokenError("jti must be a string")
            for name in self._required_extra:
                if claims.get(name) is None:
                    raise InvalidTokenError(f"{name} is required")
            extra = {name: value for name, value in claims.items() if name not in KNOWN_CLAIMS}
            return AccessClaims(
                subject=uuid.UUID(claims["sub"]),
                roles=tuple(roles),
                jti=claims["jti"],
                must_change_password=claims.get("must_change_password") is True,
                expires_at=datetime.fromtimestamp(claims["exp"], UTC),
                extra=MappingProxyType(extra),
            )
        except InvalidTokenError:
            raise
        except (jwt.PyJWTError, ValueError, TypeError, AttributeError) as error:
            raise InvalidTokenError(str(error)) from error
