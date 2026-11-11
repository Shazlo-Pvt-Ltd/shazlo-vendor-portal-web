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

# The name of an uploaded file, for the examples below: the vendor's folder, then a random name.
EXAMPLE_PUBLIC_ID = (
    "shazlo/vendors/7a9d4e2b-1c3f-4b5a-8d6e-9f0a1b2c3d4e/"
    + "products/9c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f"
)


class SignRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {"kind": "product_image", "content_type": "image/jpeg", "size_bytes": 482113}
            ]
        },
    )

    kind: AssetKind
    # What the browser says the file is. It is checked against the allowed types and sizes here
    # (to refuse early) and again against what Cloudinary really stored when registering.
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0, le=2**40)


class SignResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "asset_id": "3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c",
                    "public_id": EXAMPLE_PUBLIC_ID,
                    "upload_url": "https://api.cloudinary.com/v1_1/democloud/image/upload",
                    "fields": {
                        "public_id": EXAMPLE_PUBLIC_ID,
                        "timestamp": "1762851600",
                        "allowed_formats": "jpg,jpeg,png,webp",
                        "overwrite": "false",
                        "api_key": "123456789012345",
                        "signature": "0123456789abcdef" * 4,
                    },
                    "expires_at": "2026-11-11T10:00:00Z",
                    "max_bytes": 10485760,
                    "allowed_content_types": ["image/jpeg", "image/png", "image/webp"],
                }
            ]
        }
    )

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
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"examples": [{"public_id": EXAMPLE_PUBLIC_ID}]},
    )

    public_id: DatabaseText = Field(min_length=1, max_length=255)


class AssetOut(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "id": "3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c",
                    "kind": "product_image",
                    "status": "ready",
                    "public_id": EXAMPLE_PUBLIC_ID,
                    "url": "https://res.cloudinary.com/democloud/image/upload/v1/shazlo/products/9c1e.jpg",
                    "format": "jpg",
                    "bytes": 482113,
                    "width": 1200,
                    "height": 1500,
                    "created_at": "2026-11-10T09:30:00Z",
                }
            ]
        }
    )

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
