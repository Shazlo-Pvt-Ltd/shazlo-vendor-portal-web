"""Format checks and normal forms for Indian business details: mobile numbers, PIN codes, IFSC,
bank account numbers, UPI IDs and GSTINs.

Pure functions with no messages (the API layer words the errors). The rules match the seller
portal's, so the screens and the API accept and refuse the same input. Every pattern uses
`[0-9]`, never `\\d`, which in Python also matches other scripts' digits.
"""

import re

# Indian mobiles: ten digits starting 6 to 9.
_MOBILE = re.compile(r"[6-9][0-9]{9}")
_PHONE_SEPARATORS = re.compile(r"[\s\-().]")


def normalise_phone(raw: str) -> str | None:
    """Ten digits, or None. Accepts +91, 91 or 0 in front and spaces, dashes or brackets."""
    digits = _PHONE_SEPARATORS.sub("", raw)
    if digits.startswith("+91"):
        digits = digits[3:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if _MOBILE.fullmatch(digits) else None


EMAIL_MAX = 320
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def is_valid_email(raw: str) -> bool:
    value = raw.strip()
    return len(value) <= EMAIL_MAX and _EMAIL.fullmatch(value) is not None


LINK_MAX = 300
# An Instagram handle (@kalki.studio) or a website (kalkistudio.in, https://...).
_HANDLE = re.compile(r"@?(?!.*\.\.)[a-z0-9._]{1,30}", re.IGNORECASE)
_WEBSITE = re.compile(r"(https?://)?([a-z0-9-]+\.)+[a-z]{2,}(/\S*)?", re.IGNORECASE)


def is_valid_link(raw: str) -> bool:
    value = raw.strip()
    if not value or len(value) > LINK_MAX:
        return False
    return _HANDLE.fullmatch(value) is not None or _WEBSITE.fullmatch(value) is not None


_PIN = re.compile(r"[1-9][0-9]{5}")


def normalise_pin(raw: str) -> str:
    return re.sub(r"\s", "", raw)


def is_valid_pin(raw: str) -> bool:
    return _PIN.fullmatch(normalise_pin(raw)) is not None


# Four letters for the bank, a zero, then six letters or digits for the branch (RBI format).
_IFSC = re.compile(r"[A-Z]{4}0[A-Z0-9]{6}")


def normalise_ifsc(raw: str) -> str:
    return re.sub(r"\s", "", raw).upper()


def is_valid_ifsc(raw: str) -> bool:
    return _IFSC.fullmatch(normalise_ifsc(raw)) is not None


# Indian bank account numbers are 9 to 18 digits.
_ACCOUNT = re.compile(r"[0-9]{9,18}")


def normalise_account_number(raw: str) -> str:
    return re.sub(r"[\s-]", "", raw)


def is_valid_account_number(raw: str) -> bool:
    return _ACCOUNT.fullmatch(normalise_account_number(raw)) is not None


def account_last4(raw: str) -> str:
    return normalise_account_number(raw)[-4:]


# name@handle, like kalki.studio@okhdfcbank. UPI IDs are not case-sensitive; we keep lower case.
_UPI = re.compile(r"[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}")
MASK = "•••"


def normalise_upi_id(raw: str) -> str:
    return raw.strip().lower()


def is_valid_upi_id(raw: str) -> bool:
    return _UPI.fullmatch(normalise_upi_id(raw)) is not None


def mask_upi_id(raw: str) -> str:
    """ "kalki.studio@okhdfcbank" -> "ka•••@okhdfcbank": enough to recognise, not to reuse."""
    value = normalise_upi_id(raw)
    name, at, handle = value.rpartition("@")
    if not at:
        return MASK
    return f"{name[: 2 if len(name) > 2 else 1]}{MASK}@{handle}"


# 2-digit state code, the 10-character PAN, entity number, Z, check character.
_GSTIN = re.compile(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]")
_BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def normalise_gstin(raw: str) -> str:
    return re.sub(r"\s", "", raw).upper()


def gstin_check_char(first14: str) -> str:
    """The 15th character of a GSTIN, from the first 14 (GSTN's mod-36 check)."""
    total = 0
    for index, char in enumerate(first14[:14]):
        value = _BASE36.index(char) * (1 if index % 2 == 0 else 2)
        total += value // 36 + value % 36
    return _BASE36[(36 - total % 36) % 36]


def is_valid_gstin(raw: str) -> bool:
    """State codes 01-38, 97 (other territory) or 99 (centre), the shape, and the check."""
    value = normalise_gstin(raw)
    if _GSTIN.fullmatch(value) is None:
        return False
    state = int(value[:2])
    if not (1 <= state <= 38 or state in (97, 99)):
        return False
    return gstin_check_char(value[:14]) == value[14]
