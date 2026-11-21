"""Sealing payout numbers (a bank account number or a UPI ID) before they reach the database.

AES-256-GCM with a random 96-bit nonce. A sealed value is
`0x01 | len(kid) | kid | nonce (12) | ciphertext+tag`, so it names the key it was sealed with and
keys can rotate: add the new key to `PAYOUT_ENCRYPTION_KEYS`, point `PAYOUT_ENCRYPTION_KID` at it,
and values sealed with an older key still open while that key stays in the ring.

The associated data binds a sealed value to its vendor, its field and its key id, so a value
copied into another vendor's row, or into another column, does not open.

Nothing in the API returns a sealed value or what it opens to: sellers and admins see only the
last four digits of an account and a masked UPI ID, which are kept in clear next to it.
"""

import base64
import binascii
import json
import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = 1
NONCE_BYTES = 12
KEY_BYTES = 32
MAX_KID_LENGTH = 64


class PayoutCipherError(Exception):
    """A sealed value that does not open. The message never carries the value or a key."""


def _check_kid(kid: str) -> None:
    if not kid or len(kid) > MAX_KID_LENGTH or not kid.isascii() or not kid.isprintable():
        raise ValueError(f"payout key ids are 1 to {MAX_KID_LENGTH} printable ASCII characters")


def parse_keys(raw: str) -> dict[str, bytes]:
    """`{"<kid>": "<base64 of 32 random bytes>", ...}` -> {kid: key}."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("PAYOUT_ENCRYPTION_KEYS must be a JSON object") from None
    if not isinstance(data, dict) or not data:
        raise ValueError("PAYOUT_ENCRYPTION_KEYS must be a non-empty JSON object")
    keys: dict[str, bytes] = {}
    for kid, value in data.items():
        _check_kid(kid)
        if not isinstance(value, str):
            raise ValueError("each payout key must be a base64 string")
        try:
            key = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("each payout key must be valid base64") from None
        if len(key) != KEY_BYTES:
            raise ValueError(f"each payout key must be {KEY_BYTES} bytes")
        keys[kid] = key
    return keys


class PayoutCipher:
    def __init__(self, keys: dict[str, bytes], active_kid: str) -> None:
        for kid, key in keys.items():
            _check_kid(kid)
            if len(key) != KEY_BYTES:
                raise ValueError(f"payout keys must be {KEY_BYTES} bytes")
        if active_kid not in keys:
            raise ValueError("the active payout key id is not in the key ring")
        self._keys = {kid: AESGCM(key) for kid, key in keys.items()}
        self._active = active_kid

    @staticmethod
    def _aad(kid: str, vendor_id: uuid.UUID, field: str) -> bytes:
        return b"shazlo-payout:v1:" + kid.encode() + b":" + vendor_id.bytes + b":" + field.encode()

    def seal(self, plaintext: str, vendor_id: uuid.UUID, field: str) -> bytes:
        kid = self._active
        nonce = os.urandom(NONCE_BYTES)
        sealed = self._keys[kid].encrypt(
            nonce, plaintext.encode(), self._aad(kid, vendor_id, field)
        )
        return bytes([VERSION, len(kid)]) + kid.encode() + nonce + sealed

    @staticmethod
    def _split(blob: bytes) -> tuple[str, bytes, bytes]:
        if len(blob) < 2 or blob[0] != VERSION:
            raise PayoutCipherError("unknown sealed value format")
        kid_end = 2 + blob[1]
        if blob[1] == 0 or len(blob) < kid_end + NONCE_BYTES + 16:
            raise PayoutCipherError("sealed value is truncated")
        try:
            kid = blob[2:kid_end].decode("ascii")
        except UnicodeDecodeError:
            raise PayoutCipherError("sealed value has a bad key id") from None
        return kid, blob[kid_end : kid_end + NONCE_BYTES], blob[kid_end + NONCE_BYTES :]

    def key_id_of(self, blob: bytes) -> str:
        return self._split(blob)[0]

    def open(self, blob: bytes, vendor_id: uuid.UUID, field: str) -> str:
        kid, nonce, sealed = self._split(blob)
        aead = self._keys.get(kid)
        if aead is None:
            raise PayoutCipherError("sealed with a key that is not in the ring")
        try:
            return aead.decrypt(nonce, sealed, self._aad(kid, vendor_id, field)).decode()
        except InvalidTag:
            raise PayoutCipherError("sealed value does not open") from None
