import json
import stat
import sys
from collections.abc import Callable
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient
from shazlo_security.keys import KeyConfigError, load_keyring

from vendor_api import cli
from vendor_api.app import create_app
from vendor_api.core.security import key_ring_config
from vendor_api.core.settings import Settings

PRIVATE_PARAMS = {"d", "p", "q", "dp", "dq", "qi", "oth", "k"}
Override = Callable[..., Settings]


def test_jwks_endpoint_serves_public_keys_only(
    settings: Settings, override: Override, key_pems: dict[str, str]
) -> None:
    both = override(
        settings, jwt_keys=json.dumps(key_pems), jwt_signing_kid="test-key-1", env="test"
    )
    with TestClient(create_app(both, readiness_checks={})) as client:
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
            assert (key["kty"], key["alg"], key["use"]) == ("RSA", "RS256", "sig")

        # End to end: a token from the app's own issuer verifies against what was served.
        issued = client.app.state.vendor_tokens._issuer.issue(  # type: ignore[attr-defined]
            subject="11111111-2222-3333-4444-555555555555", roles=["owner"], audience="vendor-api"
        )
        claims = jwt.decode(
            issued.token,
            jwt.PyJWKSet.from_dict(body)["test-key-1"].key,
            algorithms=["RS256"],
            audience="vendor-api",
            issuer=both.jwt_issuer,
        )
        assert claims["roles"] == ["owner"]


def test_the_app_refuses_to_start_without_keys(settings: Settings, override: Override) -> None:
    with pytest.raises(KeyConfigError, match="no JWT keys"):
        create_app(override(settings, jwt_keys=None), readiness_checks={})


def test_the_app_refuses_a_signing_kid_that_is_not_configured(
    settings: Settings, override: Override
) -> None:
    with pytest.raises(KeyConfigError, match="not one of the configured keys"):
        create_app(override(settings, jwt_signing_kid="nope"), readiness_checks={})


def test_the_key_config_never_shows_the_keys(settings: Settings) -> None:
    config = key_ring_config(settings)
    assert config.keys_json is not None
    assert "PRIVATE" not in repr(config)
    assert "PRIVATE" not in repr(settings)


def test_generate_key_writes_a_loadable_private_key(
    settings: Settings,
    override: Override,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["generate-key", "--dir", str(tmp_path), "--kid", "dev-1"]) == 0
    output = capsys.readouterr().out
    assert "dev-1" in output
    assert "PRIVATE KEY" not in output
    path = tmp_path / "dev-1.pem"
    assert path.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----")
    if sys.platform != "win32":  # Windows has no POSIX file modes
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    from_dir = override(settings, jwt_keys=None, jwt_keys_dir=str(tmp_path))
    assert load_keyring(key_ring_config(from_dir)).signing.kid == "dev-1"


def test_generate_key_never_overwrites(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["generate-key", "--dir", str(tmp_path), "--kid", "dev-1"]) == 0
    before = (tmp_path / "dev-1.pem").read_bytes()
    assert cli.main(["generate-key", "--dir", str(tmp_path), "--kid", "dev-1"]) == 1
    assert "already exists" in capsys.readouterr().err
    assert (tmp_path / "dev-1.pem").read_bytes() == before


def test_generate_key_rejects_a_bad_kid(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["generate-key", "--dir", str(tmp_path), "--kid", "../escape"]) == 1
    assert "kid may only contain" in capsys.readouterr().err
    assert list(tmp_path.iterdir()) == []
