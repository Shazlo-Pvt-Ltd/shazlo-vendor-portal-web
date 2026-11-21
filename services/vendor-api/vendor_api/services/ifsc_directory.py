"""The bank behind an IFSC, from its first four letters (the bank code RBI assigns).

Offline on purpose: no call leaves the service, so the public lookup cannot be used to reach
another host and keeps working when a directory service is down. The list covers the banks most
sellers use; a code that is well formed but not listed is `None` ("we do not know the bank"),
which never stops a seller saving a payout. Branch names need RBI's full list (about 170,000
rows), which is not bundled, so `branch` is always None for now.
"""

from dataclasses import dataclass

from vendor_api.services.indian_formats import is_valid_ifsc, normalise_ifsc

BANKS: dict[str, str] = {
    # Public sector banks
    "SBIN": "State Bank of India",
    "PUNB": "Punjab National Bank",
    "BARB": "Bank of Baroda",
    "CNRB": "Canara Bank",
    "UBIN": "Union Bank of India",
    "BKID": "Bank of India",
    "IDIB": "Indian Bank",
    "CBIN": "Central Bank of India",
    "IOBA": "Indian Overseas Bank",
    "UCBA": "UCO Bank",
    "MAHB": "Bank of Maharashtra",
    "PSIB": "Punjab & Sind Bank",
    # Private sector banks
    "HDFC": "HDFC Bank",
    "ICIC": "ICICI Bank",
    "UTIB": "Axis Bank",
    "KKBK": "Kotak Mahindra Bank",
    "YESB": "Yes Bank",
    "INDB": "IndusInd Bank",
    "IDFB": "IDFC FIRST Bank",
    "IBKL": "IDBI Bank",
    "FDRL": "Federal Bank",
    "SIBL": "South Indian Bank",
    "KVBL": "Karur Vysya Bank",
    "CIUB": "City Union Bank",
    "TMBL": "Tamilnad Mercantile Bank",
    "KARB": "Karnataka Bank",
    "RATN": "RBL Bank",
    "DCBL": "DCB Bank",
    "DLXB": "Dhanlaxmi Bank",
    "JAKA": "Jammu & Kashmir Bank",
    "CSBK": "CSB Bank",
    "BDBL": "Bandhan Bank",
    # Small finance and payments banks
    "AUBL": "AU Small Finance Bank",
    "ESFB": "Equitas Small Finance Bank",
    "UJVN": "Ujjivan Small Finance Bank",
    "AIRP": "Airtel Payments Bank",
    "PYTM": "Paytm Payments Bank",
    "IPOS": "India Post Payments Bank",
    "FINO": "Fino Payments Bank",
    # Foreign banks
    "HSBC": "HSBC",
    "SCBL": "Standard Chartered Bank",
    "CITI": "Citibank",
    "DBSS": "DBS Bank India",
    "DEUT": "Deutsche Bank",
}


class IfscFormatError(ValueError):
    """Not an IFSC at all (four letters, a zero, six letters or digits)."""


@dataclass(frozen=True)
class IfscBank:
    ifsc: str
    bank: str
    branch: str | None


def lookup_ifsc(raw: str) -> IfscBank | None:
    """The bank for a well-formed IFSC, or None when its bank code is not listed.

    Raises `IfscFormatError` for a badly formed code; the message never repeats the input.
    """
    if not is_valid_ifsc(raw):
        raise IfscFormatError("not an IFSC")
    ifsc = normalise_ifsc(raw)
    bank = BANKS.get(ifsc[:4])
    return IfscBank(ifsc=ifsc, bank=bank, branch=None) if bank else None
