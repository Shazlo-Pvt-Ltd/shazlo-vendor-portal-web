import uuid
from dataclasses import dataclass
from datetime import datetime

from shazlo_auth import InvalidTokenError, StaticKeySource, TokenVerifier
from shazlo_security.keys import KeyRing
from shazlo_security.tokens import IssuedToken, TokenIssuer

from vendor_api.db.models import VendorUserRole

# The one audience of vendor-api's own tokens. identity-api's tokens are for other audiences, so
# neither service accepts the other's tokens (ADR 0009).
VENDOR_AUDIENCE = "vendor-api"
VENDOR_ID_CLAIM = "vendor_id"


@dataclass(frozen=True)
class VendorClaims:
    user_id: uuid.UUID
    vendor_id: uuid.UUID
    role: VendorUserRole
    jti: str
    expires_at: datetime


class VendorTokens:
    """Issues and verifies vendor-api's own access tokens.

    A token carries the vendor user (`sub`), their vendor (`vendor_id`) and one role (`owner` or
    `staff`). No email or name goes into it: login and `GET /v1/me` return those. The signing
    and verifying code is `packages/py-security` and `packages/py-auth`; this class only fixes
    vendor-api's audience, claim and roles.
    """

    def __init__(self, issuer: TokenIssuer, keyring: KeyRing, *, issuer_url: str) -> None:
        self._issuer = issuer
        self._verifier = TokenVerifier(
            # The keys are held in-process, so there is no JWKS fetch for our own tokens.
            StaticKeySource(keyring.public_keys),
            issuer=issuer_url,
            audience=VENDOR_AUDIENCE,
            required_extra_claims=[VENDOR_ID_CLAIM],
        )

    def issue(
        self, *, user_id: uuid.UUID, vendor_id: uuid.UUID, role: VendorUserRole
    ) -> IssuedToken:
        return self._issuer.issue(
            subject=user_id,
            roles=[VendorUserRole(role).value],
            audience=VENDOR_AUDIENCE,
            extra_claims={VENDOR_ID_CLAIM: str(vendor_id)},
        )

    async def verify(self, token: str) -> VendorClaims:
        """Raises InvalidTokenError for anything that is not a valid vendor-api token."""
        claims = await self._verifier.verify(token)
        try:
            vendor_id = uuid.UUID(str(claims.extra[VENDOR_ID_CLAIM]))
            (role_name,) = claims.roles
            role = VendorUserRole(role_name)
        except (ValueError, TypeError) as error:
            raise InvalidTokenError(
                "vendor_id must be a UUID and roles exactly one vendor role"
            ) from error
        if claims.expires_at is None:  # the verifier always sets it
            raise InvalidTokenError("exp is required")
        return VendorClaims(claims.subject, vendor_id, role, claims.jti, claims.expires_at)
