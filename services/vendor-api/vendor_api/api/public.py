"""Public endpoints: no token. Sign-up uses them before an account exists, so each is limited
per client IP."""

from typing import cast

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from shazlo_security.rate_limit import Check

from vendor_api.api.deps import ClientIp, Limits
from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.services.ifsc_directory import IfscFormatError, lookup_ifsc

router = APIRouter(prefix="/public", tags=["public"])

IFSC_FORMAT = ApiError(422, "ifsc_format", "Enter an IFSC like HDFC0001234.")
IFSC_UNKNOWN = ApiError(404, "ifsc_unknown", "We do not know the bank for this IFSC.")


class IfscBankOut(BaseModel):
    ifsc: str
    bank: str
    # The branch needs RBI's full list, which is not bundled yet: always null for now.
    branch: str | None


@router.get("/ifsc/{code}")
async def ifsc_lookup(
    code: str, request: Request, response: Response, limits: Limits, ip: ClientIp
) -> IfscBankOut:
    """The bank behind an IFSC (from its first four letters). `422 ifsc_format` for a code that
    is not an IFSC; `404 ifsc_unknown` for a well-formed code of a bank we do not list, which a
    payout may still use. Limited per IP; nothing is looked up anywhere else."""
    settings = cast(Settings, request.app.state.settings)
    await limits.check("ifsc_lookup", [Check("ip", ip, settings.rate_limit_ifsc_lookup_ip)])
    if len(code) > 32:  # an IFSC is 11 characters; spaces are allowed, so leave some room
        raise IFSC_FORMAT
    try:
        found = lookup_ifsc(code)
    except IfscFormatError:
        raise IFSC_FORMAT from None
    if found is None:
        raise IFSC_UNKNOWN
    # The directory is static, so a browser may keep an answer for a day.
    response.headers["Cache-Control"] = "public, max-age=86400"
    return IfscBankOut(ifsc=found.ifsc, bank=found.bank, branch=found.branch)
