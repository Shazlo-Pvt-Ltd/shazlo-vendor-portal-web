"""`python -m vendor_api.cli generate-payout-key`: a new AES-256 key for PAYOUT_ENCRYPTION_KEYS."""

import base64
import json

import pytest

from vendor_api import cli
from vendor_api.services.payout_cipher import parse_keys


def test_prints_a_key_ring_entry_that_the_settings_accept(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["generate-payout-key", "--kid", "2026-11"]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    ring = json.loads(out[0])
    assert list(ring) == ["2026-11"]
    assert len(base64.b64decode(ring["2026-11"])) == 32
    assert parse_keys(out[0]) == {"2026-11": base64.b64decode(ring["2026-11"])}


def test_two_keys_differ_and_a_kid_is_chosen(capsys: pytest.CaptureFixture[str]) -> None:
    cli.main(["generate-payout-key"])
    cli.main(["generate-payout-key"])
    first, second = (
        json.loads(line) for line in capsys.readouterr().out.split("\n") if line.startswith("{")
    )
    assert first != second
    assert all(kid for kid in (*first, *second))


def test_a_bad_kid_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["generate-payout-key", "--kid", "x" * 65]) == 1
    assert "generate-payout-key failed" in capsys.readouterr().err
