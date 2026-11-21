"""Payout numbers are sealed with AES-256-GCM before they reach the database.

The sealed value names its key, so keys can rotate, and it is bound to the vendor and the field,
so a sealed value copied to another vendor's row (or another column) does not open.
"""

import base64
import json
import os
import uuid

import pytest

from vendor_api.services.payout_cipher import PayoutCipher, PayoutCipherError, parse_keys

VENDOR = uuid.UUID("9b2f1c3e-0d4a-4c1e-8f6a-2b7d5e9a1c30")
OTHER = uuid.UUID("11111111-2222-3333-4444-555555555555")


def _key() -> bytes:
    return os.urandom(32)


def test_round_trip() -> None:
    cipher = PayoutCipher({"k1": _key()}, "k1")
    sealed = cipher.seal("50100123454821", VENDOR, "account_number")
    assert cipher.open(sealed, VENDOR, "account_number") == "50100123454821"


def test_the_plaintext_is_not_in_the_sealed_value() -> None:
    cipher = PayoutCipher({"k1": _key()}, "k1")
    sealed = cipher.seal("50100123454821", VENDOR, "account_number")
    assert b"50100123454821" not in sealed


def test_two_seals_of_the_same_value_differ() -> None:
    cipher = PayoutCipher({"k1": _key()}, "k1")
    one = cipher.seal("50100123454821", VENDOR, "account_number")
    two = cipher.seal("50100123454821", VENDOR, "account_number")
    assert one != two


@pytest.mark.parametrize(
    ("vendor", "field"),
    [(OTHER, "account_number"), (VENDOR, "upi_id")],
)
def test_a_sealed_value_is_bound_to_its_vendor_and_field(vendor: uuid.UUID, field: str) -> None:
    cipher = PayoutCipher({"k1": _key()}, "k1")
    sealed = cipher.seal("50100123454821", VENDOR, "account_number")
    with pytest.raises(PayoutCipherError):
        cipher.open(sealed, vendor, field)


def test_a_tampered_value_does_not_open() -> None:
    cipher = PayoutCipher({"k1": _key()}, "k1")
    sealed = bytearray(cipher.seal("50100123454821", VENDOR, "account_number"))
    sealed[-1] ^= 1
    with pytest.raises(PayoutCipherError):
        cipher.open(bytes(sealed), VENDOR, "account_number")


@pytest.mark.parametrize("blob", [b"", b"\x01", b"\x09k1" + b"0" * 40, b"\x01\x02k1"])
def test_garbage_does_not_open(blob: bytes) -> None:
    cipher = PayoutCipher({"k1": _key()}, "k1")
    with pytest.raises(PayoutCipherError):
        cipher.open(blob, VENDOR, "account_number")


def test_rotation_keeps_old_values_readable_and_seals_with_the_new_key() -> None:
    old_key, new_key = _key(), _key()
    before = PayoutCipher({"k1": old_key}, "k1")
    sealed = before.seal("50100123454821", VENDOR, "account_number")

    after = PayoutCipher({"k1": old_key, "k2": new_key}, "k2")
    assert after.open(sealed, VENDOR, "account_number") == "50100123454821"
    assert after.key_id_of(after.seal("x", VENDOR, "account_number")) == "k2"
    assert after.key_id_of(sealed) == "k1"


def test_a_value_sealed_with_a_retired_key_does_not_open() -> None:
    sealed = PayoutCipher({"k1": _key()}, "k1").seal("50100123454821", VENDOR, "account_number")
    with pytest.raises(PayoutCipherError):
        PayoutCipher({"k2": _key()}, "k2").open(sealed, VENDOR, "account_number")


def test_the_active_key_must_be_in_the_ring() -> None:
    with pytest.raises(ValueError, match="active"):
        PayoutCipher({"k1": _key()}, "k2")


@pytest.mark.parametrize("size", [16, 24, 31, 33])
def test_keys_must_be_256_bits(size: int) -> None:
    with pytest.raises(ValueError, match="32 bytes"):
        PayoutCipher({"k1": os.urandom(size)}, "k1")


def test_parse_keys_reads_base64_json() -> None:
    key = _key()
    raw = json.dumps({"2026-11": base64.b64encode(key).decode()})
    assert parse_keys(raw) == {"2026-11": key}


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[]",
        "{}",
        json.dumps({"k1": "not base64!"}),
        json.dumps({"k1": base64.b64encode(b"short").decode()}),
        json.dumps({"": base64.b64encode(os.urandom(32)).decode()}),
        json.dumps({"k" * 65: base64.b64encode(os.urandom(32)).decode()}),
    ],
)
def test_parse_keys_refuses_bad_input(raw: str) -> None:
    with pytest.raises(ValueError):
        parse_keys(raw)


def test_errors_never_carry_the_plaintext_or_key() -> None:
    key = _key()
    cipher = PayoutCipher({"k1": key}, "k1")
    sealed = cipher.seal("50100123454821", VENDOR, "account_number")
    with pytest.raises(PayoutCipherError) as error:
        cipher.open(sealed, OTHER, "account_number")
    assert "50100123454821" not in str(error.value)
    assert key.hex() not in str(error.value)
