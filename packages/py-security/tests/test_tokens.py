import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest

from shazlo_security.keys import KeyRing, KeyRingConfig, load_keyring
from shazlo_security.tokens import TokenIssuer, TokenWindowClosedError

ISSUER = "https://identity.test"
ADMIN_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
# PyJWT checks `iat` and `exp` against the real clock, so the fake clock starts at the real now.
NOW = datetime.now(UTC).replace(microsecond=0)
ACCESS_TTL_SECONDS = 15 * 60


@dataclass(frozen=True)
class Setup:
    keys: KeyRingConfig
    access_ttl_seconds: int = ACCESS_TTL_SECONDS


Configure = Callable[..., Setup]
PRIVATE_PARAMS = {"d", "p", "q", "dp", "dq", "qi", "oth", "k"}


@pytest.fixture
def configured() -> Configure:
    def apply(key_pems: dict[str, str], signing: str, access_token_ttl_seconds: int = 900) -> Setup:
        keys = KeyRingConfig(keys_json=json.dumps(key_pems), signing_kid=signing)
        return Setup(keys, access_token_ttl_seconds)

    return apply


def make_issuer(setup: Setup, ring: KeyRing, now: datetime = NOW) -> TokenIssuer:
    return TokenIssuer(ISSUER, ring, access_ttl_seconds=setup.access_ttl_seconds, clock=lambda: now)


def verify(token: str, jwks: dict[str, Any], audience: str = "vendor-api") -> dict[str, Any]:
    """Verifies like a consuming service: key chosen by `kid` from the JWKS, RS256 only."""
    kid = jwt.get_unverified_header(token)["kid"]
    key = jwt.PyJWKSet.from_dict(jwks)[kid]
    return jwt.decode(
        token,
        key.key,
        algorithms=["RS256"],
        audience=audience,
        issuer=ISSUER,
        options={"require": ["exp", "iat", "iss", "sub", "aud", "jti", "roles"]},
        leeway=0,
    )


def test_token_claims_and_header(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    ring = load_keyring(settings.keys)
    issued = make_issuer(settings, ring).issue(
        subject=ADMIN_ID, roles=["vendor_reviewer"], audience="vendor-api"
    )

    header = jwt.get_unverified_header(issued.token)
    assert header == {"alg": "RS256", "typ": "JWT", "kid": "test-key-1"}

    claims = verify(issued.token, ring.jwks())
    assert claims == {
        "iss": ISSUER,
        "sub": str(ADMIN_ID),
        "aud": "vendor-api",
        "roles": ["vendor_reviewer"],
        "iat": int(NOW.timestamp()),
        "exp": int((NOW + timedelta(minutes=15)).timestamp()),
        "jti": issued.jti,
    }
    assert issued.expires_at == NOW + timedelta(minutes=15)


def test_token_carries_no_personal_data(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    ring = load_keyring(settings.keys)
    token = make_issuer(settings, ring).issue(
        subject=ADMIN_ID, roles=["super_admin"], audience="identity-api"
    )
    claims = jwt.decode(token.token, options={"verify_signature": False})
    assert not {"email", "name", "display_name"} & claims.keys()


def test_jti_is_unique(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    issuer = make_issuer(settings, load_keyring(settings.keys))
    ids = {issuer.issue(subject=ADMIN_ID, roles=[], audience="a").jti for _ in range(20)}
    assert len(ids) == 20


def test_audience_is_required(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    with pytest.raises(ValueError, match="audience"):
        make_issuer(settings, load_keyring(settings.keys)).issue(
            subject=ADMIN_ID, roles=[], audience=""
        )


def test_expiry_follows_the_setting(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1", access_token_ttl_seconds=60)
    ring = load_keyring(settings.keys)
    issued = make_issuer(settings, ring).issue(subject=ADMIN_ID, roles=[], audience="a")
    claims = jwt.decode(issued.token, options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == 60


def test_ttl_override_and_not_after_cap(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    issuer = make_issuer(settings, load_keyring(settings.keys))
    short = issuer.issue(subject=ADMIN_ID, roles=[], audience="a", ttl_seconds=300)
    assert short.expires_at == NOW + timedelta(minutes=5)
    assert short.lifetime_seconds == 300

    parent_exp = NOW + timedelta(seconds=90)
    capped = issuer.issue(
        subject=ADMIN_ID, roles=[], audience="a", ttl_seconds=300, not_after=parent_exp
    )
    claims = jwt.decode(capped.token, options={"verify_signature": False})
    assert claims["exp"] == int(parent_exp.timestamp())
    assert capped.lifetime_seconds == 90


@pytest.mark.parametrize("seconds", [0, -10])
def test_not_after_in_the_past_is_refused(
    configured: Configure, key_pems: dict[str, str], seconds: int
) -> None:
    settings = configured(key_pems, "test-key-1")
    issuer = make_issuer(settings, load_keyring(settings.keys))
    with pytest.raises(TokenWindowClosedError):
        issuer.issue(
            subject=ADMIN_ID, roles=[], audience="a", not_after=NOW + timedelta(seconds=seconds)
        )


def test_expired_token_is_rejected(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    ring = load_keyring(settings.keys)
    old = NOW - timedelta(minutes=16)
    issued = make_issuer(settings, ring, now=old).issue(
        subject=ADMIN_ID, roles=[], audience="vendor-api"
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        verify(issued.token, ring.jwks())


def test_wrong_audience_is_rejected(configured: Configure, key_pems: dict[str, str]) -> None:
    settings = configured(key_pems, "test-key-1")
    ring = load_keyring(settings.keys)
    issued = make_issuer(settings, ring).issue(subject=ADMIN_ID, roles=[], audience="vendor-api")
    with pytest.raises(jwt.InvalidAudienceError):
        verify(issued.token, ring.jwks(), audience="identity-api")


def test_kid_selects_the_signing_key(configured: Configure, key_pems: dict[str, str]) -> None:
    for kid in ("test-key-1", "test-key-2"):
        configured_settings = configured(key_pems, kid)
        ring = load_keyring(configured_settings.keys)
        issued = make_issuer(configured_settings, ring).issue(
            subject=ADMIN_ID, roles=[], audience="vendor-api"
        )
        assert jwt.get_unverified_header(issued.token)["kid"] == kid
        verify(issued.token, ring.jwks())


def test_token_does_not_verify_against_the_other_key(
    configured: Configure, key_pems: dict[str, str]
) -> None:
    """The `kid` matters: a token must verify against its own key and not another."""
    settings = configured(key_pems, "test-key-1")
    ring = load_keyring(settings.keys)
    token = make_issuer(settings, ring).issue(subject=ADMIN_ID, roles=[], audience="vendor-api")
    other = jwt.PyJWKSet.from_dict(ring.jwks())["test-key-2"]
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token.token, other.key, algorithms=["RS256"], audience="vendor-api")


def test_rotation_overlap(configured: Configure, key_pems: dict[str, str]) -> None:
    """Step 1: new key published, old still signs. Step 2: new key signs, old still published."""
    old_only = {"test-key-1": key_pems["test-key-1"]}
    before = configured(old_only, "test-key-1")
    before_ring = load_keyring(before.keys)
    old_token = make_issuer(before, before_ring).issue(
        subject=ADMIN_ID, roles=[], audience="vendor-api"
    )

    published = configured(key_pems, "test-key-1")
    published_ring = load_keyring(published.keys)
    assert set(published_ring.kids) == {"test-key-1", "test-key-2"}
    assert (
        jwt.get_unverified_header(
            make_issuer(published, published_ring)
            .issue(subject=ADMIN_ID, roles=[], audience="vendor-api")
            .token
        )["kid"]
        == "test-key-1"
    )

    switched = configured(key_pems, "test-key-2")
    switched_ring = load_keyring(switched.keys)
    new_token = make_issuer(switched, switched_ring).issue(
        subject=ADMIN_ID, roles=[], audience="vendor-api"
    )
    assert jwt.get_unverified_header(new_token.token)["kid"] == "test-key-2"

    # With both keys published, tokens signed by either verify.
    jwks = switched_ring.jwks()
    verify(old_token.token, jwks)
    verify(new_token.token, jwks)


def test_jwks_has_public_material_only(configured: Configure, key_pems: dict[str, str]) -> None:
    ring = load_keyring(configured(key_pems, "test-key-1").keys)
    keys = ring.jwks()["keys"]
    assert [key["kid"] for key in keys] == ["test-key-1", "test-key-2"]
    for key in keys:
        assert set(key) - {"key_ops"} == {"kty", "n", "e", "kid", "use", "alg"}
        assert not PRIVATE_PARAMS & key.keys()
        assert key["kty"] == "RSA"
        assert key["alg"] == "RS256"
        assert key["use"] == "sig"


# --- Extra claims -------------------------------------------------------------------------


def test_extra_claims_are_signed_into_the_token(
    configured: Configure, key_pems: dict[str, str]
) -> None:
    setup = configured(key_pems, "test-key-1")
    ring = load_keyring(setup.keys)
    vendor_id = "9b2f1c3e-0d4a-4c1e-8f6a-2b7d5e9a1c30"
    issued = make_issuer(setup, ring).issue(
        subject=ADMIN_ID,
        roles=["vendor_owner"],
        audience="vendor-api",
        extra_claims={"vendor_id": vendor_id},
    )
    claims = verify(issued.token, ring.jwks())
    assert claims["vendor_id"] == vendor_id
    assert claims["roles"] == ["vendor_owner"]


def test_no_extra_claims_adds_nothing(configured: Configure, key_pems: dict[str, str]) -> None:
    setup = configured(key_pems, "test-key-1")
    ring = load_keyring(setup.keys)
    issuer = make_issuer(setup, ring)
    plain = issuer.issue(subject=ADMIN_ID, roles=[], audience="a")
    empty = issuer.issue(subject=ADMIN_ID, roles=[], audience="a", extra_claims={})
    for issued in (plain, empty):
        claims = jwt.decode(issued.token, options={"verify_signature": False})
        assert set(claims) == {"iss", "sub", "aud", "roles", "iat", "exp", "jti"}


@pytest.mark.parametrize(
    "name", ["iss", "sub", "aud", "exp", "nbf", "iat", "jti", "roles", "must_change_password"]
)
def test_an_extra_claim_cannot_replace_a_claim_the_issuer_sets(
    configured: Configure, key_pems: dict[str, str], name: str
) -> None:
    setup = configured(key_pems, "test-key-1")
    issuer = make_issuer(setup, load_keyring(setup.keys))
    with pytest.raises(ValueError, match=name):
        issuer.issue(subject=ADMIN_ID, roles=[], audience="a", extra_claims={name: "x"})
