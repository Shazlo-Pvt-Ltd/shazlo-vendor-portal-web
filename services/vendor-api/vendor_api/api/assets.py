import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from shazlo_security.rate_limit import Check
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import CurrentVendorUser, Limits, current_vendor_user
from vendor_api.core.settings import Settings
from vendor_api.core.validation import DatabaseText
from vendor_api.db.models import Asset, AssetKind
from vendor_api.db.session import get_session
from vendor_api.services.assets import AssetService

router = APIRouter(prefix="/vendor/assets", tags=["assets"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]


def get_assets(request: Request) -> AssetService:
    return cast(AssetService, request.app.state.assets)


Assets = Annotated[AssetService, Depends(get_assets)]


class SignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: AssetKind
    # What the browser says the file is. It is checked against the allowed types and sizes here
    # (to refuse early) and again against what Cloudinary really stored when registering.
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0, le=2**40)


class SignResponse(BaseModel):
    asset_id: uuid.UUID
    public_id: str
    # POST a multipart/form-data request here: every entry of `fields` as a form field, then the
    # file as `file`. Send nothing else: Cloudinary rejects parameters that were not signed.
    upload_url: str
    fields: dict[str, str]
    expires_at: datetime
    max_bytes: int
    allowed_content_types: list[str]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    public_id: DatabaseText = Field(min_length=1, max_length=255)


class AssetOut(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    public_id: str
    url: str
    format: str | None
    bytes: int | None
    width: int | None
    height: int | None
    created_at: datetime


def asset_out(asset: Asset) -> AssetOut:
    return AssetOut(
        id=asset.id,
        kind=asset.kind,
        status=asset.status,
        public_id=asset.public_id,
        url=asset.url,
        format=asset.format,
        bytes=asset.bytes,
        width=asset.width,
        height=asset.height,
        created_at=asset.created_at,
    )


@router.post("/sign", status_code=201)
async def sign_upload(
    body: SignRequest,
    request: Request,
    response: Response,
    db: Db,
    assets: Assets,
    limits: Limits,
    current: Current,
) -> SignResponse:
    """A signed upload for one image. The server picks the file's name (in this vendor's own
    folder) and records a `pending` asset; upload the file to `upload_url` with `fields`, then
    call `POST /v1/vendor/assets` with the `public_id` to register it. The signature is good for
    about an hour and for one upload (`overwrite=false`). Limited per user."""
    no_store(response)
    settings = cast(Settings, request.app.state.settings)
    await limits.check(
        "asset_sign", [Check("user", str(current.user.id), settings.rate_limit_asset_sign_user)]
    )
    signed = await assets.sign(
        db, current.vendor, current.user.id, body.kind, body.content_type, body.size_bytes
    )
    return SignResponse(
        asset_id=signed.asset.id,
        public_id=signed.asset.public_id,
        upload_url=signed.upload_url,
        fields=signed.fields,
        expires_at=signed.expires_at,
        max_bytes=signed.max_bytes,
        allowed_content_types=list(signed.allowed_content_types),
    )


@router.post("", status_code=201)
async def register_asset(
    body: RegisterRequest, response: Response, db: Db, assets: Assets, current: Current
) -> AssetOut:
    """Registers an uploaded image: Cloudinary is asked what it stored (never the browser), and
    the asset becomes `ready` if its real size and format are allowed. Only a `public_id` that was
    signed for this vendor can be registered (anything else is `404 asset_not_found`).
    `409 upload_not_found` until the file has been uploaded; registering twice is harmless."""
    no_store(response)
    return asset_out(await assets.register(db, current.vendor, body.public_id))
