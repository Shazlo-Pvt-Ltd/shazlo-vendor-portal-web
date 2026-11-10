"""Cloudinary: signing an upload, and asking what Cloudinary actually received.

The browser uploads straight to Cloudinary with a signature made here (ADR 0005), so the API never
handles file bytes. Nothing the browser says about the file is trusted: after the upload the
service asks Cloudinary (Admin API, with the secret) for the file's real size, format and
dimensions.
"""

import hashlib
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

import httpx

logger = logging.getLogger("vendor_api.cloudinary")

# Uploads go to `<API_HOST>/v1_1/<cloud>/image/upload`; the Admin API lives on the same host.
API_HOST = "https://api.cloudinary.com"
# Delivery URLs of an uploaded file start like this.
DELIVERY_HOST = "https://res.cloudinary.com"
# Cloudinary refuses a signed upload whose timestamp is older than an hour.
SIGNATURE_LIFETIME_SECONDS = 3600


class ImageHostError(Exception):
    """The image host could not be asked (down, refused our credentials, or answered nonsense)."""


@dataclass(frozen=True)
class UploadedImage:
    """What the host reports about a stored file."""

    public_id: str
    secure_url: str
    format: str
    bytes: int
    width: int
    height: int


class ImageHost(Protocol):
    """What the service needs from the image host. Tests use a fake; production uses Cloudinary."""

    async def describe(self, public_id: str) -> UploadedImage | None:
        """The stored file, or None if nothing was uploaded under this id."""

    async def delete(self, public_id: str) -> None:
        """Removes the file. Best effort: a failure is logged, never raised."""


def sign_params(params: Mapping[str, str], api_secret: str) -> str:
    """Cloudinary's request signature: the parameters sorted by name and joined as `k=v&k=v`,
    with the API secret appended, hashed with SHA-256 (supported by Cloudinary).

    Only parameters that are signed here may be sent by the browser, and Cloudinary rejects an
    upload whose parameters differ from the ones signed, so the browser cannot change the file's
    name, folder or format list.
    """
    to_sign = "&".join(f"{name}={value}" for name, value in sorted(params.items()))
    return hashlib.sha256((to_sign + api_secret).encode()).hexdigest()


def upload_url(cloud_name: str) -> str:
    return f"{API_HOST}/v1_1/{cloud_name}/image/upload"


def delivery_url(cloud_name: str, public_id: str) -> str:
    return f"{DELIVERY_HOST}/{cloud_name}/image/upload/{public_id}"


class CloudinaryClient:
    """The Admin API calls, over one shared `httpx.AsyncClient` (created with the app)."""

    def __init__(
        self, cloud_name: str, api_key: str, api_secret: str, http: httpx.AsyncClient
    ) -> None:
        self._base = f"{API_HOST}/v1_1/{cloud_name}"
        self._auth = (api_key, api_secret)
        self._http = http

    async def describe(self, public_id: str) -> UploadedImage | None:
        url = f"{self._base}/resources/image/upload/{quote(public_id, safe='/')}"
        try:
            response = await self._http.get(url, auth=self._auth)
        except httpx.HTTPError as error:
            raise ImageHostError("could not reach the image host") from error
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            # 401/403 means our credentials are wrong: an operator problem, not the vendor's.
            logger.error("cloudinary describe answered %s", response.status_code)
            raise ImageHostError(f"the image host answered {response.status_code}")
        try:
            return _parse(response.json())
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            raise ImageHostError("the image host sent an unreadable answer") from error

    async def delete(self, public_id: str) -> None:
        try:
            response = await self._http.request(
                "DELETE",
                f"{self._base}/resources/image/upload",
                params={"public_ids[]": public_id},
                auth=self._auth,
            )
            if response.status_code != 200:
                logger.warning("cloudinary delete answered %s", response.status_code)
        except httpx.HTTPError:
            logger.warning("cloudinary delete failed", exc_info=True)


def _parse(body: Any) -> UploadedImage:
    if (
        not isinstance(body, dict)
        or body.get("resource_type") != "image"
        or body.get("type") != "upload"
    ):
        raise ValueError("not an uploaded image")
    return UploadedImage(
        public_id=str(body["public_id"]),
        secure_url=str(body["secure_url"]),
        format=str(body["format"]).lower(),
        bytes=int(body["bytes"]),
        width=int(body["width"]),
        height=int(body["height"]),
    )
