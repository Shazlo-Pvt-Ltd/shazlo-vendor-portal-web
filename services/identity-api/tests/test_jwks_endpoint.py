import json
import uuid
from collections.abc import Callable
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient
from shazlo_security.keys import KeyConfigError, load_keyring

from identity_api import cli
from identity_api.app import create_app
from identity_api.core.security import (
    REFRESH_KEY_PREFIX,
    key_ring_config,
    refresh_token_config,
    token_issuer,
)
from identity_api.core.settings import Settings

ISSUER = "https://identity.test"
ADMIN_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
PRIVATE_PARAMS = {"d", "p", "q", "dp", "dq", "qi", "oth", "k"}
Override = Callable[..., Settings]


@pytest.fixture
def two_keys(settings: Settings, override: Override, key_pems: dict[str, str]) -> Settings:
    return override(
        settings,
        jwt_issuer=ISSUER,
        jwt_keys=json.dumps(key_pems),
        jwt_signing_kid="test-key-1",
    )


def test_settings_become_the_key_ring_config(two_keys: Settings) -> None:
    ring = load_keyring(key_ring_config(two_keys))
    assert ring.signing.kid == "test-key-1"
    assert set(ring.kids) == {"test-key-1", "test-key-2"}
    # The secret keys never show up in the config's repr (it can end up in a log).
    assert "PRIVATE" not in repr(key_ring_config(two_keys))


def test_token_issuer_uses_the_configured_issuer_and_lifetime(
    two_keys: Settings, override: Override
) -> None:
    settings = override(two_keys, access_token_ttl_seconds=120)
    issued = token_issuer(settings, load_keyring(key_ring_config(settings))).issue(
        subject=ADMIN_ID, roles=[], audience="vendor-api"
    )
    claims = jwt.decode(issued.token, options={"verify_signature": False})
    assert claims["iss"] == ISSUER
    assert claims["exp"] - claims["iat"] == 120
    assert issued.lifetime_seconds == 120


def test_refresh_settings_become_the_store_config(settings: Settings, override: Override) -> None:
    config = refresh_token_config(
        override(
            settings,
            refresh_token_ttl_days=3,
            refresh_family_max_days=9,
            refresh_reuse_grace_seconds=4,
        )
    )
    assert config.prefix == REFRESH_KEY_PREFIX == "identity:"
    assert (config.token_ttl.days, config.family_max_ttl.days) == (3, 9)
    assert config.reuse_grace_seconds == 4


def test_jwks_endpoint(two_keys: Settings, key_pems: dict[str, str]) -> None:
    with TestClient(create_app(two_keys, readiness_checks={})) as client:
        response = client.get("/.well-known/jwks.json")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "max-age=600"
        assert response.headers["content-type"] == "application/json"
        body = response.json()
        assert {key["kid"] for key in body["keys"]} == {"test-key-1", "test-key-2"}
        for pem in key_pems.values():
            assert "PRIVATE" not in response.text
            assert pem not in response.text
        for key in body["keys"]:
            assert not PRIVATE_PARAMS & key.keys()

        # End to end: a token from the app's issuer verifies against what the endpoint served.
        issued = client.app.state.token_issuer.issue(  # type: ignore[attr-defined]
            subject=ADMIN_ID, roles=["vendor_reviewer"], audience="vendor-api"
        )
        claims = jwt.decode(
            issued.token,
            jwt.PyJWKSet.from_dict(body)["test-key-1"].key,
            algorithms=["RS256"],
            audience="vendor-api",
            issuer=ISSUER,
        )
        assert claims["roles"] == ["vendor_reviewer"]


def test_app_refuses_to_start_without_keys(settings: Settings) -> None:
    with pytest.raises(KeyConfigError):
        create_app(settings.model_copy(update={"jwt_keys": None}), readiness_checks={})


def test_generate_key_command_writes_a_loadable_key(
    settings: Settings,
    override: Override,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["generate-key", "--dir", str(tmp_path), "--kid", "dev-1"]) == 0
    output = capsys.readouterr().out
    assert "dev-1" in output
    assert "PRIVATE KEY" not in output
    from_dir = override(settings, jwt_keys=None, jwt_keys_dir=str(tmp_path))
    ring = load_keyring(key_ring_config(from_dir))
    assert ring.signing.kid == "dev-1"
    # Running it again with the same kid fails instead of replacing the key.
    assert cli.main(["generate-key", "--dir", str(tmp_path), "--kid", "dev-1"]) == 1
