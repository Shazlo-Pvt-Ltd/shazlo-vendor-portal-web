import base64
import json
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from shazlo_auth import InvalidTokenError, StaticKeySource, TokenVerifier
from shazlo_security.keys import KeyRing, KeyRingConfig, load_keyring
from shazlo_security.tokens import TokenIssuer

from vendor_api.core.security import key_ring_config, token_issuer
from vendor_api.core.settings import Settings
from vendor_api.db.models import VendorUserRole
from vendor_api.services.tokens import VENDOR_AUDIENCE, VendorTokens

ISSUER = "https://vendor.test"
IDENTITY_ISSUER = "https://identity.test"
USER_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
VENDOR_ID = uuid.UUID("9b2f1c3e-0d4a-4c1e-8f6a-2b7d5e9a1c30")
Override = Callable[..., Settings]


@pytest.fixture
def vendor_settings(settings: Settings, override: Override) -> Settings:
    return override(settings, jwt_issuer=ISSUER)


@pytest.fixture
def ring(vendor_settings: Settings) -> KeyRing:
    return load_keyring(key_ring_config(vendor_settings))


@pytest.fixture
def tokens(vendor_settings: Settings, ring: KeyRing) -> VendorTokens:
    return VendorTokens(token_issuer(vendor_settings, ring), ring, issuer_url=ISSUER)


def decode(token: str) -> dict[str, Any]:
    return jwt.decode(token, options={"verify_signature": False})


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def forged(header: dict[str, Any], claims: dict[str, Any], signature: bytes = b"") -> str:
    parts = [b64(json.dumps(header).encode()), b64(json.dumps(claims).encode())]
    return ".".join([*parts, b64(signature)])


def vendor_claims(**changes: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "sub": str(USER_ID),
        "aud": VENDOR_AUDIENCE,
        "vendor_id": str(VENDOR_ID),
        "roles": ["owner"],
        "iat": now,
        "exp": now + 900,
        "jti": uuid.uuid4().hex,
    }
    claims.update(changes)
    return {key: value for key, value in claims.items() if value is not None}


def sign(ring: KeyRing, claims: dict[str, Any], kid: str | None = None) -> str:
    return jwt.encode(
        claims,
        ring.signing.private_key,
        algorithm="RS256",
        headers={"kid": kid or ring.signing.kid},
    )


# --- Issuing -----------------------------------------------------------------------------


def test_the_token_has_the_agreed_claims_and_header(tokens: VendorTokens) -> None:
    issued = tokens.issue(user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.OWNER)
    assert jwt.get_unverified_header(issued.token) == {
        "alg": "RS256",
        "typ": "JWT",
        "kid": "test-key-1",
    }
    claims = decode(issued.token)
    assert claims == {
        "iss": ISSUER,
        "sub": str(USER_ID),
        "aud": "vendor-api",
        "vendor_id": str(VENDOR_ID),
        "roles": ["owner"],
        "iat": claims["iat"],
        "exp": claims["iat"] + 15 * 60,
        "jti": issued.jti,
    }
    assert issued.lifetime_seconds == 900


def test_the_token_has_exactly_one_audience_and_no_personal_data(tokens: VendorTokens) -> None:
    claims = decode(
        tokens.issue(user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.STAFF).token
    )
    assert isinstance(claims["aud"], str)
    assert not {"email", "name", "display_name", "phone"} & claims.keys()


def test_the_lifetime_follows_the_setting(
    vendor_settings: Settings, override: Override, ring: KeyRing
) -> None:
    short = override(vendor_settings, access_token_ttl_seconds=60)
    issued = VendorTokens(token_issuer(short, ring), ring, issuer_url=ISSUER).issue(
        user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.STAFF
    )
    claims = decode(issued.token)
    assert claims["exp"] - claims["iat"] == 60


def test_only_vendor_roles_can_be_issued(tokens: VendorTokens) -> None:
    for role in ("super_admin", "admin", ""):
        with pytest.raises(ValueError, match="is not a valid"):
            tokens.issue(user_id=USER_ID, vendor_id=VENDOR_ID, role=cast(VendorUserRole, role))


# --- Verifying ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(VendorUserRole))
async def test_an_issued_token_verifies(tokens: VendorTokens, role: VendorUserRole) -> None:
    issued = tokens.issue(user_id=USER_ID, vendor_id=VENDOR_ID, role=role)
    claims = await tokens.verify(issued.token)
    assert claims.user_id == USER_ID
    assert claims.vendor_id == VENDOR_ID
    assert claims.role is role
    assert claims.jti == issued.jti
    assert claims.expires_at == issued.expires_at


async def test_an_expired_token_is_rejected(
    vendor_settings: Settings, ring: KeyRing, tokens: VendorTokens
) -> None:
    long_ago = datetime.now(UTC) - timedelta(hours=1)
    old = VendorTokens(
        token_issuer(vendor_settings, ring, clock=lambda: long_ago), ring, issuer_url=ISSUER
    ).issue(user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.OWNER)
    with pytest.raises(InvalidTokenError):
        await tokens.verify(old.token)


async def test_a_token_just_past_its_expiry_gets_thirty_seconds_of_leeway(
    ring: KeyRing, tokens: VendorTokens
) -> None:
    now = int(time.time())
    assert (await tokens.verify(sign(ring, vendor_claims(exp=now - 10)))).user_id == USER_ID
    with pytest.raises(InvalidTokenError):
        await tokens.verify(sign(ring, vendor_claims(exp=now - 60)))


async def test_an_unknown_kid_is_rejected(ring: KeyRing, tokens: VendorTokens) -> None:
    with pytest.raises(InvalidTokenError, match="unknown kid"):
        await tokens.verify(sign(ring, vendor_claims(), kid="someone-elses-key"))


async def test_a_missing_kid_is_rejected(ring: KeyRing, tokens: VendorTokens) -> None:
    token = jwt.encode(vendor_claims(), ring.signing.private_key, algorithm="RS256")
    with pytest.raises(InvalidTokenError, match="kid"):
        await tokens.verify(token)


async def test_alg_none_is_rejected(tokens: VendorTokens) -> None:
    token = forged({"alg": "none", "typ": "JWT", "kid": "test-key-1"}, vendor_claims())
    with pytest.raises(InvalidTokenError, match="RS256"):
        await tokens.verify(token)


async def test_hs256_signed_with_the_public_key_is_rejected(
    ring: KeyRing, tokens: VendorTokens
) -> None:
    """The classic confusion attack: the published public key used as an HMAC key."""
    import hashlib
    import hmac

    public_pem = ring.public_keys["test-key-1"].public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    header = {"alg": "HS256", "typ": "JWT", "kid": "test-key-1"}
    unsigned = ".".join(
        [b64(json.dumps(header).encode()), b64(json.dumps(vendor_claims()).encode())]
    )
    signature = hmac.new(public_pem, unsigned.encode(), hashlib.sha256).digest()
    with pytest.raises(InvalidTokenError, match="RS256"):
        await tokens.verify(f"{unsigned}.{b64(signature)}")


async def test_a_signature_from_another_key_is_rejected(
    key_pems: dict[str, str], tokens: VendorTokens
) -> None:
    other = load_keyring(
        KeyRingConfig(keys_json=json.dumps({"test-key-1": key_pems["test-key-2"]}))
    )
    with pytest.raises(InvalidTokenError):
        await tokens.verify(sign(other, vendor_claims()))


@pytest.mark.parametrize("claim", ["iss", "sub", "aud", "exp", "iat", "jti", "roles", "vendor_id"])
async def test_missing_claims_are_rejected(ring: KeyRing, tokens: VendorTokens, claim: str) -> None:
    claims = vendor_claims()
    del claims[claim]
    with pytest.raises(InvalidTokenError):
        await tokens.verify(sign(ring, claims))


@pytest.mark.parametrize(
    "changes",
    [
        {"iss": "https://evil.test"},
        {"aud": "identity-api"},
        {"aud": ["vendor-api", "identity-api"]},
        {"vendor_id": "not-a-uuid"},
        {"vendor_id": None},
        {"roles": []},
        {"roles": ["owner", "staff"]},
        {"roles": ["super_admin"]},
        {"roles": ["vendor_reviewer"]},
        {"roles": "owner"},
        {"sub": "not-a-uuid"},
    ],
    ids=str,
)
async def test_invalid_claims_are_rejected(
    ring: KeyRing, tokens: VendorTokens, changes: dict[str, Any]
) -> None:
    claims = vendor_claims(**changes)
    # `vendor_claims` drops None; an explicit null must reach the verifier.
    claims.update({k: v for k, v in changes.items() if v is None})
    with pytest.raises(InvalidTokenError):
        await tokens.verify(sign(ring, claims))


@pytest.mark.parametrize("token", ["", "garbage", "a.b.c", "a.b"])
async def test_garbage_is_rejected(tokens: VendorTokens, token: str) -> None:
    with pytest.raises(InvalidTokenError):
        await tokens.verify(token)


# --- identity-api and vendor-api never accept each other's tokens -------------------------


def identity_side(
    key_pems: dict[str, str], kid: str = "identity-key"
) -> tuple[TokenIssuer, KeyRing]:
    """What identity-api has: its own key ring and issuer (the same shared code)."""
    ring = load_keyring(KeyRingConfig(keys_json=json.dumps({kid: key_pems["test-key-2"]})))
    return TokenIssuer(IDENTITY_ISSUER, ring, access_ttl_seconds=900), ring


def identity_verifier(ring: KeyRing) -> TokenVerifier:
    """How identity-api checks its own tokens (`SELF_AUDIENCE` is `identity-api`)."""
    return TokenVerifier(
        StaticKeySource(ring.public_keys), issuer=IDENTITY_ISSUER, audience="identity-api"
    )


async def test_an_identity_api_token_is_rejected_here(
    key_pems: dict[str, str], tokens: VendorTokens
) -> None:
    issuer, _ = identity_side(key_pems)
    for audience in ("identity-api", "vendor-api"):
        token = issuer.issue(subject=USER_ID, roles=["super_admin"], audience=audience).token
        with pytest.raises(InvalidTokenError):
            await tokens.verify(token)


async def test_a_vendor_token_is_rejected_by_identity_api(
    key_pems: dict[str, str], tokens: VendorTokens
) -> None:
    _, identity_ring = identity_side(key_pems)
    token = tokens.issue(user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.OWNER).token
    with pytest.raises(InvalidTokenError):
        await identity_verifier(identity_ring).verify(token)


async def test_issuer_and_audience_alone_keep_the_services_apart(
    vendor_settings: Settings, tokens: VendorTokens, ring: KeyRing
) -> None:
    """Even if both services were ever given the same key, neither token would pass as the
    other's: `iss` and `aud` differ, and identity-api's has no `vendor_id`."""
    shared = TokenIssuer(IDENTITY_ISSUER, ring, access_ttl_seconds=900)
    admin_token = shared.issue(subject=USER_ID, roles=["super_admin"], audience="vendor-api").token
    with pytest.raises(InvalidTokenError):
        await tokens.verify(admin_token)

    vendor_token = tokens.issue(
        user_id=USER_ID, vendor_id=VENDOR_ID, role=VendorUserRole.OWNER
    ).token
    with pytest.raises(InvalidTokenError):
        await identity_verifier(ring).verify(vendor_token)
