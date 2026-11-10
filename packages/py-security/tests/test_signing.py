"""Request signing: the contract's worked example, and every way a request can fail."""

import pytest

from shazlo_security.signing import (
    SIGNATURE_HEADER,
    BadSignatureError,
    MalformedSignatureError,
    RequestSigner,
    RequestVerifier,
    SignatureError,
    SigningKey,
    StaleTimestampError,
    UnknownKeyError,
    sign,
)

# The worked example in docs/adr/0003-contract/README.md.
SECRET = b"shazlo-contract-test-secret-not-for-production"
TIMESTAMP = 1792750800
BODY = (
    b'{"event_id":"d2c8a7b1-3e5f-4092-8b4c-6f9e1d8b2c35","type":"brand_profile.unpublished",'
    b'"version":4,"occurred_at":"2026-10-24T08:00:00Z","producer":"vendor-api","aggregate":'
    b'{"type":"brand_profile","id":"3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10"},"payload":'
    b'{"vendor_id":"3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10","reason":"vendor_suspended",'
    b'"unpublished_at":"2026-10-24T08:00:00Z"}}'
)
SIGNATURE = "v1=634f5e1066ac490d1e347ddf886c874a5083ec5f01b38c706c069e3056470785"

K1 = SigningKey("k1", SECRET)
K2 = SigningKey("k2", b"a-second-secret-for-a-rotation-0123456789")


def clock_at(seconds: float):  # type: ignore[no-untyped-def]
    return lambda: seconds


def signed(key: SigningKey = K1, body: bytes = BODY, at: int = TIMESTAMP) -> dict[str, str]:
    return RequestSigner(key, clock_at(at)).headers(body)


def verifier(*keys: SigningKey, now: float = TIMESTAMP) -> RequestVerifier:
    return RequestVerifier(keys or (K1,), clock_at(now))


def test_the_contract_test_vector() -> None:
    assert len(BODY) == 371
    assert sign(SECRET, TIMESTAMP, BODY) == SIGNATURE


def test_the_signer_sends_the_three_headers() -> None:
    assert signed() == {
        "X-Shazlo-Key-Id": "k1",
        "X-Shazlo-Timestamp": str(TIMESTAMP),
        "X-Shazlo-Signature": SIGNATURE,
    }


def test_a_signed_request_verifies_and_names_its_key() -> None:
    assert verifier().verify(signed(), BODY) is K1


def test_header_names_are_case_insensitive() -> None:
    headers = {name.lower(): value for name, value in signed().items()}
    assert verifier().verify(headers, BODY) is K1


def test_a_changed_body_is_refused() -> None:
    with pytest.raises(BadSignatureError):
        verifier().verify(signed(), BODY.replace(b'"version":4', b'"version":5'))


def test_a_reserialised_body_is_refused() -> None:
    # The same JSON with a space added is different bytes, so a different signature.
    with pytest.raises(BadSignatureError):
        verifier().verify(signed(), BODY.replace(b'","', b'", "', 1))


def test_a_changed_timestamp_is_refused() -> None:
    headers = signed() | {"X-Shazlo-Timestamp": str(TIMESTAMP + 1)}
    with pytest.raises(BadSignatureError):
        verifier().verify(headers, BODY)


def test_a_signature_from_another_secret_is_refused() -> None:
    other = SigningKey("k1", b"x" * 40)
    with pytest.raises(BadSignatureError):
        verifier().verify(signed(other), BODY)


def test_an_unknown_key_id_is_refused() -> None:
    with pytest.raises(UnknownKeyError):
        verifier().verify(signed(K2), BODY)


@pytest.mark.parametrize("offset", [60, -60, 0])
def test_the_window_includes_sixty_seconds(offset: int) -> None:
    assert verifier(now=TIMESTAMP + offset).verify(signed(), BODY) is K1


@pytest.mark.parametrize("offset", [61, -61, 3600])
def test_outside_the_window_is_refused(offset: int) -> None:
    with pytest.raises(StaleTimestampError):
        verifier(now=TIMESTAMP + offset).verify(signed(), BODY)


@pytest.mark.parametrize("missing", ["X-Shazlo-Key-Id", "X-Shazlo-Timestamp", SIGNATURE_HEADER])
def test_a_missing_header_is_refused(missing: str) -> None:
    headers = {name: value for name, value in signed().items() if name != missing}
    with pytest.raises(MalformedSignatureError):
        verifier().verify(headers, BODY)


@pytest.mark.parametrize("timestamp", ["", "abc", "-5", "1.5", "01792750800", " 1792750800", "1e9"])
def test_a_malformed_timestamp_is_refused(timestamp: str) -> None:
    with pytest.raises(MalformedSignatureError):
        verifier().verify(signed() | {"X-Shazlo-Timestamp": timestamp}, BODY)


@pytest.mark.parametrize(
    "signature",
    [
        "",
        SIGNATURE.removeprefix("v1="),
        SIGNATURE.replace("v1=", "v2="),
        SIGNATURE.upper(),
        SIGNATURE[:-1],
        SIGNATURE + "0",
    ],
)
def test_a_malformed_signature_is_refused(signature: str) -> None:
    with pytest.raises(MalformedSignatureError):
        verifier().verify(signed() | {SIGNATURE_HEADER: signature}, BODY)


def test_two_keys_are_both_accepted_during_a_rotation() -> None:
    both = verifier(K1, K2)
    assert both.verify(signed(K1), BODY) is K1
    assert both.verify(signed(K2), BODY) is K2


def test_a_retired_key_stops_working() -> None:
    with pytest.raises(UnknownKeyError):
        verifier(K2).verify(signed(K1), BODY)


def test_every_failure_is_a_signature_error_with_a_code() -> None:
    codes = {
        cls.code
        for cls in (
            MalformedSignatureError,
            UnknownKeyError,
            StaleTimestampError,
            BadSignatureError,
        )
    }
    assert len(codes) == 4
    assert all(issubclass(c, SignatureError) for c in (BadSignatureError, UnknownKeyError))


def test_a_weak_secret_is_refused() -> None:
    with pytest.raises(ValueError, match="at least 32 bytes"):
        SigningKey("k1", b"short")


@pytest.mark.parametrize("key_id", ["", " k1", "k 1", "-k1", "k" * 65, "k1\n"])
def test_a_bad_key_id_is_refused(key_id: str) -> None:
    with pytest.raises(ValueError, match="key id"):
        SigningKey(key_id, SECRET)


def test_a_verifier_needs_a_key() -> None:
    with pytest.raises(ValueError, match="at least one key"):
        RequestVerifier([])


def test_the_secret_is_never_printed() -> None:
    assert SECRET.decode() not in repr(K1)
    assert SECRET.decode() not in str(K1)
    assert "k1" in repr(K1)
