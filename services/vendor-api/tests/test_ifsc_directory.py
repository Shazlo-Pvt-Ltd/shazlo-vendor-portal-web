"""The bank behind an IFSC. Offline: the first four letters name the bank (RBI assigns them), so a
list of bank codes answers without calling anyone. Branches need RBI's full list, which is not
bundled, so `branch` is None."""

import pytest

from vendor_api.services.ifsc_directory import BANKS, IfscFormatError, lookup_ifsc


@pytest.mark.parametrize(
    ("raw", "ifsc", "bank"),
    [
        ("HDFC0001234", "HDFC0001234", "HDFC Bank"),
        ("hdfc 0001234", "HDFC0001234", "HDFC Bank"),
        ("SBIN0000691", "SBIN0000691", "State Bank of India"),
        ("UTIB0000004", "UTIB0000004", "Axis Bank"),
    ],
)
def test_known_banks(raw: str, ifsc: str, bank: str) -> None:
    found = lookup_ifsc(raw)
    assert found is not None
    assert (found.ifsc, found.bank, found.branch) == (ifsc, bank, None)


def test_an_unknown_bank_code_is_none() -> None:
    assert lookup_ifsc("ZZZZ0001234") is None


@pytest.mark.parametrize("raw", ["HDFC1001234", "HDFC", "", "HDFC0001234X", "../etc/passwd"])
def test_a_badly_formed_code_raises(raw: str) -> None:
    with pytest.raises(IfscFormatError):
        lookup_ifsc(raw)


def test_every_bank_code_is_four_capital_letters() -> None:
    assert BANKS
    for code, name in BANKS.items():
        assert len(code) == 4 and code.isascii() and code.isalpha() and code.isupper(), code
        assert name and name == name.strip()
