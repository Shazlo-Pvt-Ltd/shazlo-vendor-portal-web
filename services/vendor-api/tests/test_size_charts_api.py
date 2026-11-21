"""Size charts per product group (#265, spec section 7): `GET`/`PUT /v1/vendor/size-charts/{group}`.

One chart per brand and group ("used for all your shirts"): centimetres by size and measurement,
and/or a photo of the brand's own chart, which must be one of its own ready `size_chart` images.
A refused request rolls the shared test session back, so tests commit what they set up first.
"""

from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from factories import saved_asset
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import Asset, SizeChart, VendorChangeEvent

PATH = "/v1/vendor/size-charts"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, tenant: Tenant, group: str = "tops") -> httpx.Response:
    return await tenants.api.http.get(f"{PATH}/{group}", headers=bearer(tenant.owner_token))


async def put(
    tenants: Tenants, tenant: Tenant, body: Any, group: str = "tops", token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.put(
        f"{PATH}/{group}", json=body, headers=bearer(token or tenant.owner_token)
    )


async def photo(session: AsyncSession, tenant: Tenant, **changes: Any) -> Asset:
    await session.refresh(tenant.vendor)
    await session.refresh(tenant.owner)
    values: dict[str, Any] = {
        "kind": "size_chart",
        "public_id": f"shazlo/chart-{tenant.vendor.slug}",
    }
    asset = await saved_asset(session, tenant.vendor, tenant.owner, **{**values, **changes})
    await session.commit()
    return asset


async def test_nothing_saved_yet(tenants: Tenants) -> None:
    response = await get(tenants, tenants.a, "dresses")
    assert response.status_code == 200
    assert response.json() == {
        "group": "dresses",
        "measurements": {},
        "photo_asset_id": None,
        "photo_url": None,
        "updated_at": None,
    }


async def test_saving_fills_every_measurement_of_the_group_and_sorts_the_sizes(
    tenants: Tenants,
) -> None:
    body = {"measurements": {"L": {"chest": 104}, "S": {"chest": 92.5, "sleeve": None}, "M": {}}}
    response = await put(tenants, tenants.a, body)
    assert response.status_code == 200, response.json()
    saved = response.json()
    assert saved["measurements"] == {
        "S": {"chest": 92.5, "shoulder": None, "sleeve": None, "length": None},
        "L": {"chest": 104, "shoulder": None, "sleeve": None, "length": None},
    }
    assert list(saved["measurements"]) == ["S", "L"]  # size order, blank sizes dropped
    assert saved["updated_at"] is not None
    assert (await get(tenants, tenants.a)).json() == saved


async def test_waist_sizes_for_bottoms(tenants: Tenants) -> None:
    body = {"measurements": {"32": {"waist": 81, "inseam": 76}, "28": {"waist": 71}}}
    saved = (await put(tenants, tenants.a, body, "bottoms")).json()
    assert list(saved["measurements"]) == ["28", "32"]
    assert saved["measurements"]["32"] == {"waist": 81, "hip": None, "inseam": 76, "length": None}


async def test_a_chart_with_a_photo(tenants: Tenants, session: AsyncSession) -> None:
    asset = await photo(session, tenants.a)
    saved = (
        await put(tenants, tenants.a, {"measurements": {}, "photo_asset_id": str(asset.id)})
    ).json()
    assert saved["photo_asset_id"] == str(asset.id)
    assert saved["photo_url"] == asset.url


async def test_an_empty_chart_is_the_same_as_none(tenants: Tenants, session: AsyncSession) -> None:
    await put(tenants, tenants.a, {"measurements": {"M": {"chest": 100}}})
    cleared = await put(tenants, tenants.a, {"measurements": {"M": {"chest": None}}})
    assert cleared.json() == {
        "group": "tops",
        "measurements": {},
        "photo_asset_id": None,
        "photo_url": None,
        "updated_at": None,
    }
    assert await session.scalar(select(func.count()).select_from(SizeChart)) == 0


async def test_groups_are_separate(tenants: Tenants) -> None:
    await put(tenants, tenants.a, {"measurements": {"M": {"chest": 100}}}, "tops")
    assert (await get(tenants, tenants.a, "jackets")).json()["measurements"] == {}


async def test_staff_can_save_charts(tenants: Tenants) -> None:
    response = await put(
        tenants, tenants.a, {"measurements": {"M": {"chest": 100}}}, token=tenants.a.staff_token
    )
    assert response.status_code == 200


async def test_changes_are_audited(tenants: Tenants, session: AsyncSession) -> None:
    await put(tenants, tenants.a, {"measurements": {"M": {"chest": 100}}})
    await put(tenants, tenants.a, {"measurements": {}})
    events = (
        await session.scalars(
            select(VendorChangeEvent)
            .where(VendorChangeEvent.vendor_id == tenants.a.vendor.id)
            .order_by(VendorChangeEvent.id)
        )
    ).all()
    assert [(e.subject, e.action, e.detail) for e in events] == [
        ("size_chart", "saved", {"group": "tops"}),
        ("size_chart", "cleared", {"group": "tops"}),
    ]


@pytest.mark.parametrize("group", ["sarees", "TOPS", "tops%00", "x" * 50])
async def test_an_unknown_group_is_404(tenants: Tenants, group: str) -> None:
    assert (await get(tenants, tenants.a, group)).status_code == 404
    assert (await put(tenants, tenants.a, {"measurements": {}}, group)).status_code == 404


BAD: list[tuple[dict[str, Any], str]] = [
    ({"measurements": {"XXXL": {"chest": 100}}}, "measurements"),  # never echoed
    ({"measurements": {"M": {"bust": 100}}}, "measurements.M"),  # a dress measurement
    ({"measurements": {"M": {"chest": 0}}}, "measurements.M.chest"),
    ({"measurements": {"M": {"chest": -4}}}, "measurements.M.chest"),
    ({"measurements": {"M": {"chest": 300.5}}}, "measurements.M.chest"),
    ({"measurements": {"M": {"chest": 100.25}}}, "measurements.M.chest"),
    ({"measurements": {"M": {"chest": "100"}}}, "measurements.M.chest"),
    ({"measurements": {"M": {"chest": True}}}, "measurements.M.chest"),
    ({"measurements": {"32": {"chest": 100}}}, "measurements.32"),  # waist sizes are for bottoms
    ({"measurements": {"M": "100"}}, "measurements.M"),
    ({"measurements": []}, "measurements"),
]


@pytest.mark.parametrize(("body", "field"), BAD)
async def test_bad_measurements_are_a_422_naming_the_place(
    tenants: Tenants, body: dict[str, Any], field: str
) -> None:
    response = await put(tenants, tenants.a, body)
    assert response.status_code == 422, response.json()
    locs = [
        ".".join(str(p) for p in d["loc"] if p != "body")
        for d in response.json()["error"]["details"]
    ]
    assert any(loc == field or loc.startswith(field + ".") for loc in locs), locs


@pytest.mark.parametrize(
    "raw", ["1e309", "-1e309", "NaN", "Infinity", "1" + "0" * 400, "-1" + "0" * 400]
)
async def test_numbers_json_cannot_hold_are_refused(tenants: Tenants, raw: str) -> None:
    """Python's JSON parser reads 1e309 as infinity and accepts NaN; neither is a measurement
    (and neither could be stored in JSONB or sent back as JSON). A 401-digit integer stays an int
    too large to become a float, so it must be refused before any float arithmetic, not raise."""
    response = await tenants.api.http.put(
        f"{PATH}/tops",
        content='{"measurements": {"M": {"chest": ' + raw + "}}}",
        headers={**bearer(tenants.a.owner_token), "Content-Type": "application/json"},
    )
    assert response.status_code == 422


async def test_too_many_sizes_is_refused(tenants: Tenants) -> None:
    body: dict[str, Any] = {"measurements": {f"S{i}": {} for i in range(500)}}
    assert (await put(tenants, tenants.a, body)).status_code == 422


async def test_unknown_fields_are_refused(tenants: Tenants) -> None:
    response = await put(
        tenants, tenants.a, {"measurements": {}, "photo_url": "https://evil.test/x.png"}
    )
    assert response.status_code == 422


async def test_another_vendors_photo_is_refused(tenants: Tenants, session: AsyncSession) -> None:
    theirs = await photo(session, tenants.b)
    response = await put(tenants, tenants.a, {"measurements": {}, "photo_asset_id": str(theirs.id)})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "photo_asset_id"]


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "product_image"},
        {"status": "pending", "format": None, "bytes": None, "width": None, "height": None},
    ],
)
async def test_the_photo_must_be_a_ready_size_chart_image(
    tenants: Tenants, session: AsyncSession, changes: dict[str, Any]
) -> None:
    asset = await photo(session, tenants.a, **changes)
    response = await put(tenants, tenants.a, {"measurements": {}, "photo_asset_id": str(asset.id)})
    assert response.status_code == 422


async def test_each_vendor_sees_only_its_own(tenants: Tenants) -> None:
    await put(tenants, tenants.a, {"measurements": {"M": {"chest": 100}}})
    assert (await get(tenants, tenants.b)).json()["measurements"] == {}


async def test_needs_a_vendor_token(tenants: Tenants) -> None:
    assert (await tenants.api.http.get(f"{PATH}/tops")).status_code == 401
    admin = await tenants.api.http.get(f"{PATH}/tops", headers=bearer(tenants.admin_token))
    assert admin.status_code == 401
