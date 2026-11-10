import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import Asset, AssetKind, AssetProvider, AssetStatus, Vendor
from vendor_api.db.scoped import scoped_select
from vendor_api.services.cloudinary import (
    SIGNATURE_LIFETIME_SECONDS,
    ImageHost,
    ImageHostError,
    UploadedImage,
    delivery_url,
    sign_params,
    upload_url,
)

Clock = Callable[[], datetime]

# What a vendor may upload: the content types the browser declares, and the formats Cloudinary
# reports back (`jpg` is how it names a JPEG).
ALLOWED_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")
ALLOWED_FORMATS = ("jpg", "jpeg", "png", "webp")
# The sub-folder of a vendor's folder each kind of image goes to.
FOLDERS = {
    AssetKind.BRAND_LOGO: "brand",
    AssetKind.BRAND_BANNER: "brand",
    AssetKind.PRODUCT_IMAGE: "products",
}

UPLOADS_NOT_CONFIGURED = ApiError(
    503, "uploads_not_configured", "Image uploads are not set up on this server"
)
IMAGE_HOST_UNAVAILABLE = ApiError(
    502, "image_host_unavailable", "The image service did not answer. Try again in a moment"
)
ASSET_NOT_FOUND = ApiError(404, "asset_not_found", "Asset not found")
UPLOAD_NOT_FOUND = ApiError(
    409, "upload_not_found", "Nothing has been uploaded for this asset yet. Upload the file first"
)


@dataclass(frozen=True)
class SignedUpload:
    """Everything the browser needs for one upload: POST a multipart form to `upload_url` with
    every entry of `fields` and the file as `file`."""

    asset: Asset
    upload_url: str
    fields: dict[str, str]
    expires_at: datetime
    max_bytes: int
    allowed_content_types: tuple[str, ...]


class AssetService:
    """Signed direct uploads to Cloudinary, and the record of each uploaded image.

    **Sign** picks the file's name itself (`<root>/vendors/<vendor id>/<brand|products>/<random>`),
    signs it together with the allowed formats and `overwrite=false`, and writes a `pending` asset
    row. The browser can upload only that one name, so it cannot choose another vendor's folder
    or replace another file; and only a name the service issued to this vendor can be registered.

    **Register** asks Cloudinary what it stored (never the browser) and keeps the asset only if
    the real size and format are within the limits; otherwise the file is removed and the asset is
    marked `deleted`. A registered asset is `ready`, the state the brand profile and products
    require. Commits its own changes.
    """

    def __init__(
        self,
        settings: Settings,
        host: ImageHost | None,
        clock: Clock = lambda: datetime.now(UTC),
    ) -> None:
        self._settings = settings
        self._host = host
        self._clock = clock

    def _credentials(self) -> tuple[str, str, str]:
        settings = self._settings
        secret = settings.cloudinary_api_secret
        if not (settings.cloudinary_cloud_name and settings.cloudinary_api_key and secret):
            raise UPLOADS_NOT_CONFIGURED
        return (
            settings.cloudinary_cloud_name,
            settings.cloudinary_api_key,
            secret.get_secret_value(),
        )

    async def sign(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        kind: AssetKind,
        content_type: str,
        size_bytes: int,
    ) -> SignedUpload:
        cloud_name, api_key, api_secret = self._credentials()
        max_bytes = self._settings.upload_max_bytes
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ApiError(
                422,
                "unsupported_image_type",
                "Upload a JPEG, PNG or WebP image (" + ", ".join(ALLOWED_CONTENT_TYPES) + ")",
            )
        if size_bytes > max_bytes:
            raise ApiError(
                422, "image_too_large", f"The image is larger than {max_bytes // (1024 * 1024)} MB"
            )

        public_id = (
            f"{self._settings.cloudinary_root_folder}/vendors/{vendor.id}/{FOLDERS[kind]}/"
            f"{uuid.uuid4().hex}"
        )
        now = self._clock()
        # Exactly these parameters are signed, and the browser must send exactly these.
        params = {
            "public_id": public_id,
            "timestamp": str(int(now.timestamp())),
            "allowed_formats": ",".join(ALLOWED_FORMATS),
            "overwrite": "false",
        }
        if self._settings.cloudinary_upload_preset:
            params["upload_preset"] = self._settings.cloudinary_upload_preset
        signature = sign_params(params, api_secret)

        asset = Asset(
            vendor_id=vendor.id,
            kind=kind,
            provider=AssetProvider.CLOUDINARY,
            public_id=public_id,
            url=delivery_url(cloud_name, public_id),
            status=AssetStatus.PENDING,
            created_by=user_id,
        )
        db.add(asset)
        try:
            await db.flush()
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        return SignedUpload(
            asset=asset,
            upload_url=upload_url(cloud_name),
            fields={**params, "api_key": api_key, "signature": signature},
            expires_at=now + timedelta(seconds=SIGNATURE_LIFETIME_SECONDS),
            max_bytes=max_bytes,
            allowed_content_types=ALLOWED_CONTENT_TYPES,
        )

    async def register(self, db: AsyncSession, vendor: Vendor, public_id: str) -> Asset:
        """Marks an uploaded image `ready` after checking what Cloudinary really stored. Calling
        it again for a ready asset returns it unchanged."""
        self._credentials()
        host = self._host
        if host is None:
            raise UPLOADS_NOT_CONFIGURED
        try:
            asset: Asset | None = await db.scalar(
                scoped_select(Asset, vendor.id)
                .where(Asset.public_id == public_id, Asset.status != AssetStatus.DELETED)
                .execution_options(populate_existing=True)
                .with_for_update()
            )
            if asset is None:
                # Another vendor's name, a name nobody issued and a deleted asset look the same.
                raise ASSET_NOT_FOUND
            if asset.status == AssetStatus.READY:
                # Nothing changed; commit only ends the transaction (and releases the row lock).
                # A rollback would expire the asset, and reading it then needs another query.
                await db.commit()
                return asset
            try:
                uploaded = await host.describe(public_id)
            except ImageHostError as error:
                raise IMAGE_HOST_UNAVAILABLE from error
            if uploaded is None:
                raise UPLOAD_NOT_FOUND

            problem = self._problem(public_id, uploaded)
            if problem is not None:
                # Refuse the file and take it back, so it neither stays stored nor can be used.
                await host.delete(public_id)
                asset.status = AssetStatus.DELETED
                await db.flush()
                await db.commit()
                raise problem

            asset.url = uploaded.secure_url
            asset.format = uploaded.format
            asset.bytes = uploaded.bytes
            asset.width = uploaded.width
            asset.height = uploaded.height
            asset.status = AssetStatus.READY
            await db.flush()
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        return asset

    def _problem(self, public_id: str, uploaded: UploadedImage) -> ApiError | None:
        """Why the stored file must be refused, or None if it is fine."""
        if uploaded.public_id != public_id or not uploaded.secure_url.startswith("https://"):
            return ApiError(422, "invalid_upload", "The uploaded file could not be verified")
        if uploaded.format not in ALLOWED_FORMATS:
            return ApiError(422, "unsupported_image_type", "Upload a JPEG, PNG or WebP image")
        max_bytes = self._settings.upload_max_bytes
        if uploaded.bytes <= 0 or uploaded.bytes > max_bytes:
            return ApiError(
                422, "image_too_large", f"The image is larger than {max_bytes // (1024 * 1024)} MB"
            )
        if uploaded.width <= 0 or uploaded.height <= 0:
            return ApiError(422, "invalid_upload", "The uploaded file could not be verified")
        return None
