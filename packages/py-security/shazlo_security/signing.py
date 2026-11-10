"""HMAC signing of server-to-server requests (ADR 0003, section 2).

The producer signs the **exact bytes** it sends; the receiver verifies the exact bytes it
received, before it parses them. Three headers carry the proof:

- `X-Shazlo-Key-Id`: which shared secret signed the request (two may be active during a rotation);
- `X-Shazlo-Timestamp`: Unix seconds when it was signed;
- `X-Shazlo-Signature`: `v1=` and the lowercase hex of `HMAC_SHA256(secret, timestamp.body)`.

A receiver refuses a timestamp more than 60 seconds from its own clock, so a captured request is
useless after about a minute (inside it, a replay is harmless: the receiver de-duplicates on the
event id). The signature is compared in constant time.

Nothing here knows about events or a service: it signs and verifies bytes.
"""

import hashlib
import hmac
import re
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass

KEY_ID_HEADER = "X-Shazlo-Key-Id"
TIMESTAMP_HEADER = "X-Shazlo-Timestamp"
SIGNATURE_HEADER = "X-Shazlo-Signature"
SCHEME = "v1"
# A request signed more than this many seconds ago (or in the future) is refused.
DEFAULT_TOLERANCE_SECONDS = 60
# Secrets are generated with at least 32 random bytes and never committed (ADR 0003).
MIN_SECRET_BYTES = 32

_KEY_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
# The timestamp as plain decimal digits with no leading zero, so there is one way to write it.
_TIMESTAMP = re.compile(r"0|[1-9][0-9]{0,11}")
_SIGNATURE = re.compile(r"v1=[0-9a-f]{64}")


class SignatureError(Exception):
    """A request could not be verified. `code` is the machine-readable reason a receiver answers
    with (`401` for every one of them). The message never contains a secret or a signature."""

    code = "invalid_signature"


class MalformedSignatureError(SignatureError):
    code = "malformed_signature"


class UnknownKeyError(SignatureError):
    code = "unknown_key"


class StaleTimestampError(SignatureError):
    code = "stale_timestamp"


class BadSignatureError(SignatureError):
    code = "bad_signature"


@dataclass(frozen=True)
class SigningKey:
    """A shared secret and the id it is known by (so two can be active during a rotation)."""

    key_id: str
    secret: bytes

    def __post_init__(self) -> None:
        if not _KEY_ID.fullmatch(self.key_id):
            raise ValueError(
                "a key id is 1 to 64 letters, digits, dots, dashes or underscores, starting with "
                "a letter or digit"
            )
        if len(self.secret) < MIN_SECRET_BYTES:
            raise ValueError(f"a signing secret must be at least {MIN_SECRET_BYTES} bytes")

    def __repr__(self) -> str:
        # Never print the secret, in a log line or a traceback.
        return f"SigningKey(key_id={self.key_id!r}, secret=<hidden>)"


def sign(secret: bytes, timestamp: int, body: bytes) -> str:
    """`v1=<hex>`: HMAC-SHA256 of `"<timestamp>." + body`. Pure: no clock, no key lookup."""
    message = f"{timestamp}.".encode("ascii") + body
    return f"{SCHEME}=" + hmac.new(secret, message, hashlib.sha256).hexdigest()


class RequestSigner:
    """Signs request bodies with one key. `clock` returns Unix seconds (tests pass a fixed one)."""

    def __init__(self, key: SigningKey, clock: Callable[[], float] = time.time) -> None:
        self._key = key
        self._clock = clock

    @property
    def key_id(self) -> str:
        return self._key.key_id

    def headers(self, body: bytes) -> dict[str, str]:
        """The three headers for `body`. Send exactly these bytes as the request body."""
        timestamp = int(self._clock())
        return {
            KEY_ID_HEADER: self._key.key_id,
            TIMESTAMP_HEADER: str(timestamp),
            SIGNATURE_HEADER: sign(self._key.secret, timestamp, body),
        }


class RequestVerifier:
    """Verifies a request against the keys it knows (more than one while a key is rotated)."""

    def __init__(
        self,
        keys: Iterable[SigningKey],
        clock: Callable[[], float] = time.time,
        tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    ) -> None:
        self._keys = {key.key_id: key for key in keys}
        if not self._keys:
            raise ValueError("a verifier needs at least one key")
        self._clock = clock
        self._tolerance = tolerance_seconds

    def verify(self, headers: Mapping[str, str], body: bytes) -> SigningKey:
        """Returns the key that signed the request, or raises a `SignatureError`.

        `body` must be the raw bytes as received, never a re-serialised JSON document. The order
        is the contract's: the key, then the timestamp window, then the signature, and nothing is
        parsed before all three pass.
        """
        lowered = {name.lower(): value for name, value in headers.items()}
        key_id = lowered.get(KEY_ID_HEADER.lower())
        timestamp = lowered.get(TIMESTAMP_HEADER.lower())
        signature = lowered.get(SIGNATURE_HEADER.lower())
        if key_id is None or timestamp is None or signature is None:
            raise MalformedSignatureError("a signature header is missing")
        key = self._keys.get(key_id)
        if key is None:
            raise UnknownKeyError("the key id is not known")
        if not _TIMESTAMP.fullmatch(timestamp):
            raise MalformedSignatureError("the timestamp is not a Unix time in seconds")
        if abs(self._clock() - int(timestamp)) > self._tolerance:
            raise StaleTimestampError("the timestamp is outside the allowed window")
        if not _SIGNATURE.fullmatch(signature):
            raise MalformedSignatureError("the signature is not v1= and 64 lower-case hex digits")
        expected = sign(key.secret, int(timestamp), body)
        if not hmac.compare_digest(expected.encode("ascii"), signature.encode("ascii")):
            raise BadSignatureError("the signature does not match")
        return key
