"""Format checks for Indian business details (store details, payouts).

The rules match the seller portal's (`apps/vendor-portal/src/lib/validators.ts` on the Build 2
branch), so a value the screens accept is accepted here and the other way round.
"""

import time

import pytest

from vendor_api.services import indian_formats as f


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("9876543210", "9876543210"),
        ("+91 98765 43210", "9876543210"),
        ("+91-98765-43210", "9876543210"),
        ("919876543210", "9876543210"),
        ("09876543210", "9876543210"),
        ("(987) 654-3210", "9876543210"),
        ("5876543210", None),  # mobiles start 6 to 9
        ("987654321", None),
        ("98765432100", None),
        ("+1 987 654 3210", None),
        ("98765４3210", None),  # a full-width digit is not a digit here
        ("", None),
        ("+91", None),
    ],
)
def test_normalise_phone(raw: str, expected: str | None) -> None:
    assert f.normalise_phone(raw) == expected


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("@kalki.studio", True),
        ("kalki_studio", True),
        ("kalkistudio.in", True),
        ("https://kalkistudio.in/shop", True),
        ("http://www.kalki-studio.co.in", True),
        ("kalki..studio", False),
        ("javascript:alert(1)", False),
        ("ftp://kalki.in", False),
        ("https://", False),
        ("a" * 31, False),
        ("https://kalki.in/" + "x" * 300, False),  # longer than the column
        ("", False),
    ],
)
def test_is_valid_link(raw: str, ok: bool) -> None:
    assert f.is_valid_link(raw) is ok


@pytest.mark.parametrize(
    ("raw", "ok"),
    [("380009", True), ("380 009", True), ("080009", False), ("38000", False), ("3800091", False)],
)
def test_pin(raw: str, ok: bool) -> None:
    assert f.is_valid_pin(raw) is ok


def test_normalise_pin_drops_spaces() -> None:
    assert f.normalise_pin(" 380 009 ") == "380009"


@pytest.mark.parametrize(
    ("raw", "normalised", "ok"),
    [
        ("HDFC0001234", "HDFC0001234", True),
        ("hdfc 0001234", "HDFC0001234", True),
        ("SBIN0ABC123", "SBIN0ABC123", True),
        ("HDFC1001234", "HDFC1001234", False),  # the fifth character is always 0
        ("HDF00001234", "HDF00001234", False),
        ("HDFC000123", "HDFC000123", False),
        ("HDFC00012345", "HDFC00012345", False),
        ("HDFC000123$", "HDFC000123$", False),
    ],
)
def test_ifsc(raw: str, normalised: str, ok: bool) -> None:
    assert f.normalise_ifsc(raw) == normalised
    assert f.is_valid_ifsc(raw) is ok


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("123456789", True),
        ("1234 5678 9012 3456", True),
        ("1234-5678-9012", True),
        ("12345678", False),
        ("1234567890123456789", False),
        ("12345678a", False),
        ("", False),
    ],
)
def test_account_number(raw: str, ok: bool) -> None:
    assert f.is_valid_account_number(raw) is ok


def test_account_last4() -> None:
    assert f.account_last4("5010 0123 4567 4821") == "4821"


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("kalki.studio@okhdfcbank", True),
        ("Kalki.Studio@OKHDFCBANK", True),
        ("98765@ybl", True),
        ("k@ybl", False),  # at least two characters before the @
        ("kalki@", False),
        ("@ybl", False),
        ("kalki@ok-hdfc", False),
        ("kalki studio@ybl", False),
        ("kalki@1bank", False),
    ],
)
def test_upi_id(raw: str, ok: bool) -> None:
    assert f.is_valid_upi_id(raw) is ok


@pytest.mark.parametrize(
    ("raw", "masked"),
    [
        ("kalki.studio@okhdfcbank", "ka•••@okhdfcbank"),
        ("ab@ybl", "a•••@ybl"),
        ("KALKI@YBL", "ka•••@ybl"),
    ],
)
def test_mask_upi_id(raw: str, masked: str) -> None:
    assert f.mask_upi_id(raw) == masked


def _with_check(first14: str) -> str:
    return first14 + f.gstin_check_char(first14)


@pytest.mark.parametrize(
    "gstin",
    [
        "27AAPFU0939F1ZV",  # a published sample GSTIN (Maharashtra)
        _with_check("24ABCDE1234F1Z"),
        _with_check("07ABCDE1234F2Z").lower(),
        _with_check("99ABCDE1234F1Z"),
    ],
)
def test_valid_gstin(gstin: str) -> None:
    assert f.is_valid_gstin(gstin)


@pytest.mark.parametrize(
    "gstin",
    [
        "27AAPFU0939F1ZA",  # wrong check character
        _with_check("39ABCDE1234F1Z"),  # no such state code
        _with_check("00ABCDE1234F1Z"),
        _with_check("24ABCDE1234F0Z"),  # the entity number is 1-9 or a letter
        _with_check("24ABCDE1234F1Y"),  # the 14th character is always Z
        "24ABCDE1234F1Z",
        "",
    ],
)
def test_invalid_gstin(gstin: str) -> None:
    assert not f.is_valid_gstin(gstin)


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("asha@atelier.in", True),
        ("asha@atelier", False),
        ("asha atelier@x.in", False),
        ("@x.in", False),
        ("a" * 316 + "@x.in", False),  # 321 characters, one more than the column
    ],
)
def test_email(raw: str, ok: bool) -> None:
    assert f.is_valid_email(raw) is ok


# --- crafted input must not make a check slow (CodeQL: polynomial regular expressions) -------

SLOW = 0.25  # seconds; a linear check of these strings takes microseconds


@pytest.mark.parametrize(
    "raw",
    [
        "a@" + "!" * 20_000,
        "a@" + "!" * 20_000 + "@",
        "!" * 20_000 + "@a",
        "a@b" + "." * 20_000,
    ],
)
def test_email_check_is_linear(raw: str) -> None:
    started = time.perf_counter()
    assert not f.is_valid_email(raw)
    assert time.perf_counter() - started < SLOW


@pytest.mark.parametrize(
    "raw",
    [
        "a" + "-" * 20_000,
        "a" + "-" * 20_000 + "!",
        "a." + "a-." * 7_000 + "!",
        "https://" + "a-" * 10_000,
    ],
)
def test_link_check_is_linear(raw: str) -> None:
    started = time.perf_counter()
    f.is_valid_link(raw)
    assert time.perf_counter() - started < SLOW


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("kalki-studio.co.in", True),
        ("https://www.kalki-studio.in/a/b?c=d", True),
        ("kalki.in/", True),
        ("kalki-studio.i", False),  # a hyphen: not an Instagram handle
        ("kalki-studio.in1", False),
        (".kalki-studio.in", False),
        ("kalki-studio..in", False),
        ("kalki.in/ path", False),
        ("http:/kalki.in", False),
        ("HTTPS://KALKI.IN", True),
    ],
)
def test_website_shapes(raw: str, ok: bool) -> None:
    assert f.is_valid_link(raw) is ok


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("a@b.c", True),
        ("a@b.c.d", True),
        ("a@.c", False),
        ("a@b.", False),
        ("a@@b.c", False),
        ("a@b .c", False),
    ],
)
def test_email_shapes(raw: str, ok: bool) -> None:
    assert f.is_valid_email(raw) is ok
