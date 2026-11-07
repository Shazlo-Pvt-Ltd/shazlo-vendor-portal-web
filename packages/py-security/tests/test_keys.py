import json
import stat
import sys
from dataclasses import replace
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from shazlo_security.keys import (
    KeyConfigError,
    KeyRingConfig,
    generate_private_key,
    load_keyring,
    private_key_pem,
    public_key_pem,
    write_new_key,
)

posix_only = pytest.mark.skipif(sys.platform == "win32", reason="Windows has no POSIX file modes")


@pytest.fixture
def settings(key_pems: dict[str, str]) -> KeyRingConfig:
    return KeyRingConfig(keys_json=json.dumps({"test-key-1": key_pems["test-key-1"]}))


def override(config: KeyRingConfig, **changes: object) -> KeyRingConfig:
    return replace(config, **changes)  # type: ignore[arg-type]


def public_pem(private_pem: str) -> str:
    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    assert isinstance(key, rsa.RSAPrivateKey)
    return public_key_pem(key.public_key()).decode()


def test_loads_a_single_key_without_a_signing_kid(settings: KeyRingConfig) -> None:
    ring = load_keyring(settings)
    assert ring.signing.kid == "test-key-1"
    assert ring.kids == ("test-key-1",)


def test_empty_signing_kid_counts_as_unset(settings: KeyRingConfig) -> None:
    ring = load_keyring(override(settings, signing_kid=""))
    assert ring.signing.kid == "test-key-1"


def test_several_keys_need_an_explicit_signing_kid(
    settings: KeyRingConfig, key_pems: dict[str, str]
) -> None:
    both = override(settings, keys_json=json.dumps(key_pems))
    with pytest.raises(KeyConfigError, match="JWT_SIGNING_KID"):
        load_keyring(both)
    ring = load_keyring(override(both, signing_kid="test-key-2"))
    assert ring.signing.kid == "test-key-2"
    assert set(ring.kids) == {"test-key-1", "test-key-2"}


def test_a_public_only_key_is_published_but_cannot_sign(
    settings: KeyRingConfig, key_pems: dict[str, str]
) -> None:
    keys = {"test-key-1": key_pems["test-key-1"], "old": public_pem(key_pems["test-key-2"])}
    base = override(settings, keys_json=json.dumps(keys))
    ring = load_keyring(override(base, signing_kid="test-key-1"))
    assert set(ring.kids) == {"test-key-1", "old"}
    with pytest.raises(KeyConfigError, match="no private part"):
        load_keyring(override(base, signing_kid="old"))


def test_unknown_signing_kid_is_rejected(settings: KeyRingConfig) -> None:
    with pytest.raises(KeyConfigError, match="not one of the configured keys"):
        load_keyring(override(settings, signing_kid="nope"))


def test_no_keys_fails_with_a_pointer_to_the_command(settings: KeyRingConfig) -> None:
    with pytest.raises(KeyConfigError, match="generate-key"):
        load_keyring(override(settings, keys_json=None))


@pytest.mark.parametrize(
    "keys",
    [{"k": "not a pem"}, {"bad kid!": "x"}, {"key-1\n": "x"}],
    ids=["pem", "kid", "kid-trailing-newline"],
)
def test_invalid_keys_are_rejected(settings: KeyRingConfig, keys: dict[str, str]) -> None:
    with pytest.raises(KeyConfigError):
        load_keyring(override(settings, keys_json=json.dumps(keys)))


def test_malformed_json_is_rejected_without_echoing_it(settings: KeyRingConfig) -> None:
    with pytest.raises(KeyConfigError, match="not valid JSON") as error:
        load_keyring(override(settings, keys_json="{secret-looking"))
    assert "secret-looking" not in str(error.value)
    # The JSONDecodeError keeps the whole value in `.doc`; it must not be chained to the error,
    # or a traceback or error reporter would print the secret.
    assert error.value.__cause__ is None
    assert error.value.__context__ is None
    assert error.value.__suppress_context__ is True


def test_short_keys_are_rejected(settings: KeyRingConfig) -> None:
    weak = rsa.generate_private_key(public_exponent=65537, key_size=1024)  # noqa: S505
    keys = json.dumps({"weak": private_key_pem(weak).decode()})
    with pytest.raises(KeyConfigError, match="shorter than 2048"):
        load_keyring(override(settings, keys_json=keys))


def test_loads_keys_from_a_directory_and_rejects_duplicates(
    settings: KeyRingConfig, key_pems: dict[str, str], tmp_path: Path
) -> None:
    (tmp_path / "test-key-2.pem").write_text(key_pems["test-key-2"])
    (tmp_path / "test-key-2.pem").chmod(0o600)
    from_dir = override(settings, keys_json=None, keys_dir=str(tmp_path))
    assert load_keyring(from_dir).kids == ("test-key-2",)

    duplicate = override(from_dir, keys_json=json.dumps({"test-key-2": key_pems["test-key-2"]}))
    with pytest.raises(KeyConfigError, match="configured twice"):
        load_keyring(duplicate)


def test_missing_directory_is_rejected(settings: KeyRingConfig, tmp_path: Path) -> None:
    with pytest.raises(KeyConfigError, match="not a directory"):
        load_keyring(override(settings, keys_dir=str(tmp_path / "absent")))


@posix_only
def test_private_key_files_readable_by_others_are_refused(
    settings: KeyRingConfig, key_pems: dict[str, str], tmp_path: Path
) -> None:
    path = tmp_path / "test-key-2.pem"
    path.write_text(key_pems["test-key-2"])
    from_dir = override(settings, keys_json=None, keys_dir=str(tmp_path))
    path.chmod(0o644)
    with pytest.raises(KeyConfigError, match="mode 0644"):
        load_keyring(from_dir)
    if path.stat().st_uid != 0:  # root may grant its group read access, like PostgreSQL allows
        path.chmod(0o640)
        with pytest.raises(KeyConfigError, match="chmod 600"):
            load_keyring(from_dir)
    path.chmod(0o400)
    assert load_keyring(from_dir).kids == ("test-key-2",)


@posix_only
def test_public_key_files_may_be_world_readable(
    settings: KeyRingConfig, key_pems: dict[str, str], tmp_path: Path
) -> None:
    path = tmp_path / "old.pem"
    path.write_text(public_pem(key_pems["test-key-2"]))
    path.chmod(0o644)
    with_old = override(settings, keys_dir=str(tmp_path), signing_kid="test-key-1")
    ring = load_keyring(with_old)
    assert set(ring.kids) == {"test-key-1", "old"}


def test_write_new_key_is_private_and_never_overwrites(tmp_path: Path) -> None:
    path = write_new_key(tmp_path, "dev-1")
    assert path.name == "dev-1.pem"
    if sys.platform != "win32":  # Windows has no POSIX file modes
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert path.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----")
    with pytest.raises(FileExistsError):
        write_new_key(tmp_path, "dev-1")


@pytest.mark.parametrize("kid", ["../escape", "dev-1\n"])
def test_write_new_key_rejects_bad_kids(tmp_path: Path, kid: str) -> None:
    with pytest.raises(KeyConfigError):
        write_new_key(tmp_path, kid)


def test_generated_keys_are_2048_bit_rsa() -> None:
    assert generate_private_key().key_size == 2048
