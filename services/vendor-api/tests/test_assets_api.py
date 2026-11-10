"""Signed uploads and asset registration, against a fake image host."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.settings import Settings
from vendor_api.db.models import Asset
from vendor_api.services.assets import AssetService
from vendor_api.services.cloudinary import ImageHostError, UploadedImage, sign_params

SIGN = "/v1/vendor/assets/sign"
REGISTER = "/v1/vendor/assets"
CLOUD = "democloud"
KEY = "123456789012345"
SECRET = "cloudinary-secret-value"  # noqa: S105


@dataclass
class FakeHost:
    """The image host: what has been "uploaded", what was asked, what was deleted."""

    stored: dict[str, UploadedImage] = field(default_factory=dict)
    asked: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    down: bool = False

    async def describe(self, public_id: str) -> UploadedImage | None:
        self.asked.append(public_id)
        if self.down:
            raise ImageHostError("down")
        return self.stored.get(public_id)

    async def delete(self, public_id: str) -> None:
        self.deleted.append(public_id)
        self.stored.pop(public_id, None)

    def upload(self, public_id: str, **changes: Any) -> UploadedImage:
        values: dict[str, Any] = {
            "public_id": public_id,
            "secure_url": f"https://res.cloudinary.com/{CLOUD}/image/upload/v1/{public_id}.png",
            "format": "png",
            "bytes": 48_211,
            "width": 800,
            "height": 600,
        }
        image = UploadedImage(**{**values, **changes})
        self.stored[public_id] = image
        return image


@pytest.fixture
def host() -> FakeHost:
    return FakeHost()


@pytest.fixture
def configured(settings: Settings, override: Callable[..., Settings]) -> Settings:
    return override(
        settings,
        cloudinary_cloud_name=CLOUD,
        cloudinary_api_key=KEY,
        cloudinary_api_secret=SECRET,
        upload_max_bytes=1_000_000,
    )


@pytest.fixture
def uploads(tenants: Tenants, configured: Settings, host: FakeHost) -> Tenants:
    """The two tenants, with the asset service pointed at the fake host."""
    tenants.api.app.state.assets = AssetService(configured, host)
    return tenants


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def sign_body(**changes: Any) -> dict[str, Any]:
    return {"kind": "product_image", "content_type": "image/jpeg", "size_bytes": 200_000, **changes}


async def sign(
    tenants: Tenants, tenant: Tenant, token: str | None = None, **changes: Any
) -> httpx.Response:
    return await tenants.api.http.post(
        SIGN, json=sign_body(**changes), headers=bearer(token or tenant.owner_token)
    )


async def register(
    tenants: Tenants, tenant: Tenant, public_id: str, token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.post(
        REGISTER, json={"public_id": public_id}, headers=bearer(token or tenant.owner_token)
    )


async def signed_id(tenants: Tenants, tenant: Tenant, **changes: Any) -> str:
    response = await sign(tenants, tenant, **changes)
    assert response.status_code == 201, response.text
    return str(response.json()["public_id"])


async def asset_row(session: AsyncSession, public_id: str) -> Asset:
    return (
        await session.scalars(
            select(Asset)
            .where(Asset.public_id == public_id)
            .execution_options(populate_existing=True)
        )
    ).one()


async def count_assets(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(Asset)) or 0


# --- Signing -----------------------------------------------------------------------------


async def test_a_signed_upload_names_the_file_in_the_vendors_own_folder(
    uploads: Tenants, session: AsyncSession
) -> None:
    response = await sign(uploads, uploads.a)
    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    prefix = f"shazlo/vendors/{uploads.a.vendor.id}/products/"
    assert body["public_id"].startswith(prefix)
    assert len(body["public_id"]) == len(prefix) + 32  # a random 128-bit name
    assert body["upload_url"] == f"https://api.cloudinary.com/v1_1/{CLOUD}/image/upload"
    assert body["max_bytes"] == 1_000_000
    assert body["allowed_content_types"] == ["image/jpeg", "image/png", "image/webp"]

    fields = body["fields"]
    assert fields["public_id"] == body["public_id"]
    assert fields["api_key"] == KEY
    assert fields["allowed_formats"] == "jpg,jpeg,png,webp"
    assert fields["overwrite"] == "false"
    assert "upload_preset" not in fields
    assert abs(int(fields["timestamp"]) - datetime.now(UTC).timestamp()) < 60
    expires = datetime.fromisoformat(body["expires_at"])
    assert 3500 < (expires - datetime.now(UTC)).total_seconds() <= 3600

    row = await asset_row(session, body["public_id"])
    assert (row.status, row.kind, row.provider) == ("pending", "product_image", "cloudinary")
    assert (row.vendor_id, row.created_by) == (uploads.a.vendor.id, uploads.a.owner.id)
    assert row.url == f"https://res.cloudinary.com/{CLOUD}/image/upload/{body['public_id']}"
    assert (row.format, row.bytes, row.width, row.height) == (None, None, None, None)
    assert str(row.id) == body["asset_id"]


async def test_the_signature_covers_exactly_the_fields_sent_and_the_secret_stays_here(
    uploads: Tenants,
) -> None:
    response = await sign(uploads, uploads.a)
    fields = dict(response.json()["fields"])
    signature = fields.pop("signature")
    fields.pop("api_key")  # the key is sent but is not part of the signed text
    assert signature == sign_params(fields, SECRET)
    assert SECRET not in response.text


@pytest.mark.parametrize(
    ("kind", "folder"),
    [("brand_logo", "brand"), ("brand_banner", "brand"), ("product_image", "products")],
)
async def test_each_kind_goes_to_its_folder(uploads: Tenants, kind: str, folder: str) -> None:
    public_id = await signed_id(uploads, uploads.a, kind=kind)
    assert public_id.startswith(f"shazlo/vendors/{uploads.a.vendor.id}/{folder}/")


async def test_every_signature_is_for_a_new_name(uploads: Tenants, session: AsyncSession) -> None:
    names = {await signed_id(uploads, uploads.a) for _ in range(3)}
    assert len(names) == 3
    assert await count_assets(session) == 3


async def test_a_vendor_never_gets_another_vendors_folder(uploads: Tenants) -> None:
    a = await signed_id(uploads, uploads.a)
    b = await signed_id(uploads, uploads.b)
    assert str(uploads.b.vendor.id) not in a and str(uploads.a.vendor.id) not in b
    assert f"/vendors/{uploads.b.vendor.id}/" in b


async def test_the_client_cannot_choose_the_name_the_folder_or_the_owner(
    uploads: Tenants, session: AsyncSession
) -> None:
    for extra in (
        {"public_id": f"shazlo/vendors/{uploads.b.vendor.id}/products/mine"},
        {"folder": "elsewhere"},
        {"vendor_id": str(uploads.b.vendor.id)},
        {"overwrite": True},
    ):
        response = await sign(uploads, uploads.a, **extra)
        assert response.status_code == 422
    assert await count_assets(session) == 0


async def test_a_signed_upload_names_the_upload_preset_when_one_is_set(
    uploads: Tenants, configured: Settings, host: FakeHost, override: Callable[..., Settings]
) -> None:
    with_preset = override(configured, cloudinary_upload_preset="vendor-images")
    uploads.api.app.state.assets = AssetService(with_preset, host)
    fields = (await sign(uploads, uploads.a)).json()["fields"]
    assert fields["upload_preset"] == "vendor-images"
    signed = {k: v for k, v in fields.items() if k not in {"signature", "api_key"}}
    assert fields["signature"] == sign_params(signed, SECRET)


@pytest.mark.parametrize(
    "changes",
    [
        {"content_type": "image/gif"},
        {"content_type": "image/svg+xml"},
        {"content_type": "application/pdf"},
        {"content_type": "text/html"},
        {"kind": "avatar"},
        {"size_bytes": 0},
        {"size_bytes": -5},
        {"size_bytes": "big"},
    ],
)
async def test_a_file_that_is_not_an_allowed_image_is_refused(
    uploads: Tenants, session: AsyncSession, changes: dict[str, Any]
) -> None:
    response = await sign(uploads, uploads.a, **changes)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert await count_assets(session) == 0


async def test_a_file_over_the_size_limit_is_refused_before_anything_is_stored(
    uploads: Tenants, session: AsyncSession
) -> None:
    response = await sign(uploads, uploads.a, size_bytes=1_000_001)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "image_too_large"
    assert await count_assets(session) == 0
    assert (await sign(uploads, uploads.a, size_bytes=1_000_000)).status_code == 201


async def test_a_staff_member_can_sign_too(uploads: Tenants) -> None:
    assert (await sign(uploads, uploads.a, token=uploads.a.staff_token)).status_code == 201


async def test_signing_is_limited_per_user(
    uploads: Tenants, configured: Settings, override: Callable[..., Settings]
) -> None:
    uploads.api.app.state.settings = override(
        uploads.api.app.state.settings, rate_limit_asset_sign_user="2/60"
    )
    assert (await sign(uploads, uploads.a)).status_code == 201
    assert (await sign(uploads, uploads.a)).status_code == 201
    limited = await sign(uploads, uploads.a)
    assert limited.status_code == 429
    assert "retry-after" in limited.headers
    # Another user is counted on their own.
    assert (await sign(uploads, uploads.a, token=uploads.a.staff_token)).status_code == 201


async def test_uploads_that_are_not_set_up_answer_503(tenants: Tenants) -> None:
    response = await sign(tenants, tenants.a)  # `tenants` has no Cloudinary credentials
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "uploads_not_configured"
    registered = await register(tenants, tenants.a, "shazlo/anything")
    assert registered.status_code == 503


async def test_the_endpoints_need_a_vendor_token(uploads: Tenants) -> None:
    http = uploads.api.http
    assert (await http.post(SIGN, json=sign_body())).status_code == 401
    assert (await http.post(REGISTER, json={"public_id": "x"})).status_code == 401
    admin = bearer(uploads.admin_token)
    assert (await http.post(SIGN, json=sign_body(), headers=admin)).status_code == 401
    assert (await http.post(REGISTER, json={"public_id": "x"}, headers=admin)).status_code == 401


# --- Registering -------------------------------------------------------------------------


async def test_registering_takes_the_real_metadata_from_the_image_host(
    uploads: Tenants, host: FakeHost, session: AsyncSession
) -> None:
    public_id = await signed_id(uploads, uploads.a)
    image = host.upload(public_id, bytes=51_000, width=1200, height=900, format="webp")

    response = await register(uploads, uploads.a, public_id)
    assert response.status_code == 201
    body = response.json()
    assert (body["status"], body["kind"], body["public_id"]) == (
        "ready",
        "product_image",
        public_id,
    )
    assert (body["format"], body["bytes"], body["width"], body["height"]) == (
        "webp",
        51_000,
        1200,
        900,
    )
    assert body["url"] == image.secure_url

    row = await asset_row(session, public_id)
    assert (row.status, row.format, row.bytes, row.width, row.height) == (
        "ready",
        "webp",
        51_000,
        1200,
        900,
    )
    assert row.url == image.secure_url


async def test_the_client_cannot_claim_the_size_or_dimensions_of_its_file(
    uploads: Tenants, host: FakeHost
) -> None:
    public_id = await signed_id(uploads, uploads.a)
    host.upload(public_id)
    response = await uploads.api.http.post(
        REGISTER,
        json={"public_id": public_id, "bytes": 1, "width": 10, "height": 10, "status": "ready"},
        headers=bearer(uploads.a.owner_token),
    )
    assert response.status_code == 422


async def test_registering_again_changes_nothing_and_does_not_ask_the_host_again(
    uploads: Tenants, host: FakeHost
) -> None:
    public_id = await signed_id(uploads, uploads.a)
    host.upload(public_id)
    first = await register(uploads, uploads.a, public_id)
    host.stored[public_id] = UploadedImage(public_id, "https://other.example/x.png", "png", 1, 1, 1)
    second = await register(uploads, uploads.a, public_id)
    assert second.status_code == 201
    assert second.json() == first.json()
    assert host.asked == [public_id]


async def test_registering_before_the_upload_is_a_409_and_can_be_retried(
    uploads: Tenants, host: FakeHost, session: AsyncSession
) -> None:
    public_id = await signed_id(uploads, uploads.a)
    early = await register(uploads, uploads.a, public_id)
    assert early.status_code == 409
    assert early.json()["error"]["code"] == "upload_not_found"
    assert (await asset_row(session, public_id)).status == "pending"

    host.upload(public_id)
    assert (await register(uploads, uploads.a, public_id)).status_code == 201


async def test_only_a_name_signed_for_this_vendor_can_be_registered(
    uploads: Tenants, host: FakeHost, session: AsyncSession
) -> None:
    theirs = await signed_id(uploads, uploads.b)
    host.upload(theirs)
    stolen = await register(uploads, uploads.a, theirs)
    nobody = await register(uploads, uploads.a, f"shazlo/vendors/{uploads.a.vendor.id}/products/x")
    assert stolen.status_code == nobody.status_code == 404
    assert stolen.json()["error"]["code"] == "asset_not_found"
    assert stolen.json()["error"]["message"] == nobody.json()["error"]["message"]
    assert host.asked == []  # the host is not even asked
    assert (await asset_row(session, theirs)).status == "pending"


async def test_a_name_in_the_vendors_folder_that_was_never_signed_is_refused(
    uploads: Tenants, host: FakeHost
) -> None:
    forged = f"shazlo/vendors/{uploads.a.vendor.id}/products/{uuid.uuid4().hex}"
    host.upload(forged)  # somebody did put a file there, but this service never issued the name
    response = await register(uploads, uploads.a, forged)
    assert response.status_code == 404
    assert host.asked == []


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"bytes": 1_000_001}, "image_too_large"),
        ({"bytes": 0}, "image_too_large"),
        ({"format": "gif"}, "unsupported_image_type"),
        ({"format": "svg"}, "unsupported_image_type"),
        ({"width": 0}, "invalid_upload"),
        ({"height": 0}, "invalid_upload"),
        ({"secure_url": "http://res.cloudinary.com/x.png"}, "invalid_upload"),
        ({"public_id": "shazlo/something/else"}, "invalid_upload"),
    ],
)
async def test_a_file_that_breaks_the_rules_is_removed_and_the_asset_is_dead(
    uploads: Tenants,
    host: FakeHost,
    session: AsyncSession,
    changes: dict[str, Any],
    code: str,
) -> None:
    public_id = await signed_id(uploads, uploads.a)
    host.upload(public_id, **changes)
    response = await register(uploads, uploads.a, public_id)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert host.deleted == [public_id]
    row = await asset_row(session, public_id)
    assert row.status == "deleted"
    # It cannot be registered again, and nothing was copied onto the row.
    assert (await register(uploads, uploads.a, public_id)).status_code == 404
    assert (row.format, row.bytes, row.width, row.height) == (None, None, None, None)


async def test_an_image_host_that_is_down_is_a_502_and_the_asset_stays_pending(
    uploads: Tenants, host: FakeHost, session: AsyncSession
) -> None:
    public_id = await signed_id(uploads, uploads.a)
    host.upload(public_id)
    host.down = True
    response = await register(uploads, uploads.a, public_id)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "image_host_unavailable"
    assert host.deleted == []
    assert (await asset_row(session, public_id)).status == "pending"

    host.down = False
    assert (await register(uploads, uploads.a, public_id)).status_code == 201


async def test_a_registered_image_is_what_the_other_endpoints_accept(
    uploads: Tenants, host: FakeHost, session: AsyncSession
) -> None:
    """`ready` + the right kind + the vendor's own: the conditions the brand profile and the
    products check before they use an image."""
    pending = await signed_id(uploads, uploads.a, kind="brand_logo")
    ready = await signed_id(uploads, uploads.a, kind="brand_logo")
    host.upload(ready)
    await register(uploads, uploads.a, ready)
    row_pending, row_ready = await asset_row(session, pending), await asset_row(session, ready)
    assert (row_pending.status, row_ready.status) == ("pending", "ready")
    assert row_ready.kind == "brand_logo" and row_ready.vendor_id == uploads.a.vendor.id
