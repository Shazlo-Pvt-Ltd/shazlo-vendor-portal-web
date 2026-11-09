from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from vendor_api.api.auth import UserProfile, VendorSummary, no_store, user_profile, vendor_summary
from vendor_api.api.deps import CurrentVendorUser, current_vendor_user

router = APIRouter(prefix="/vendor", tags=["vendor"])


class Me(BaseModel):
    user: UserProfile
    vendor: VendorSummary


@router.get("/me")
async def me(
    response: Response, current: Annotated[CurrentVendorUser, Depends(current_vendor_user)]
) -> Me:
    """The signed-in vendor user, their role and their vendor. No password hash, no tokens."""
    no_store(response)
    return Me(user=user_profile(current.user), vendor=vendor_summary(current.vendor))
