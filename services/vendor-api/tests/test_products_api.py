"""The product endpoints: create, list, read, edit (with pending revisions), submit, delete."""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from factories import saved_asset, submittable_revision
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Asset,
    AssetKind,
    AssetStatus,
    Product,
    ProductImage,
    ProductRevision,
    ProductVariant,
    Review,
    ReviewEvent,
)

PATH = "/v1/vendor/products"
# The variant `approved()` gives its product: an edit that lists it keeps the same variant.
LIVE_VARIANTS = [
    {
        "sku": "LIVE-01-M",
        "size": "M",
        "color": "indigo",
        "price_paise": 99_900,
        "mrp_paise": 129_900,
    }
]
COUNTER = iter(range(10_000))


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def variant(sku: str = "KURTA-M", **changes: Any) -> dict[str, Any]:
    return {
        "sku": sku,
        "size": "M",
        "color": "indigo",
        "price_paise": 99_900,
        "mrp_paise": 129_900,
        **changes,
    }


def content(**changes: Any) -> dict[str, Any]:
    return {
        "title": "Block-print kurta",
        "description": "Hand block printed cotton.",
        "category": "kurtas",
        "gender": "women",
        "fabric": "cotton",
        "weight_grams": 350,
        "returnable": True,
        "return_window_days": 7,
        "variants": [variant()],
        "images": [],
        **changes,
    }


async def refreshed(session: AsyncSession, tenant: Tenant) -> None:
    """A request that fails rolls the shared test session back, which expires the loaded rows."""
    await session.refresh(tenant.vendor)
    await session.refresh(tenant.owner)


async def image(session: AsyncSession, tenant: Tenant, **changes: Any) -> uuid.UUID:
    """A saved and committed product image of the tenant. Committed, because a request that is
    refused rolls the shared test session back: an asset that was only flushed would vanish and
    the refusal would be about a missing asset, not the one under test."""
    await refreshed(session, tenant)
    values: dict[str, Any] = {
        "public_id": f"shazlo/{tenant.vendor.slug}/{next(COUNTER)}",
        "kind": AssetKind.PRODUCT_IMAGE,
        **changes,
    }
    asset = await saved_asset(session, tenant.vendor, tenant.owner, **values)
    await session.commit()
    return asset.id


async def create(
    tenants: Tenants,
    tenant: Tenant,
    sku: str = "KURTA-01",
    token: str | None = None,
    **changes: Any,
) -> httpx.Response:
    return await tenants.api.http.post(
        PATH,
        json={"sku": sku, **content(**changes)},
        headers=bearer(token or tenant.owner_token),
    )


async def make_ready(
    tenants: Tenants, session: AsyncSession, tenant: Tenant, sku: str = "KURTA-01", **changes: Any
) -> dict[str, Any]:
    """A created product with one variant and one image: complete enough to submit."""
    asset_id = await image(session, tenant)
    response = await create(
        tenants, tenant, sku, images=[{"asset_id": str(asset_id), "alt_text": "Front"}], **changes
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def put(
    tenants: Tenants,
    tenant: Tenant,
    product_id: str | uuid.UUID,
    token: str | None = None,
    **changes: Any,
) -> httpx.Response:
    return await tenants.api.http.put(
        f"{PATH}/{product_id}", json=content(**changes), headers=bearer(token or tenant.owner_token)
    )


async def get(tenants: Tenants, tenant: Tenant, product_id: str | uuid.UUID) -> httpx.Response:
    return await tenants.api.http.get(f"{PATH}/{product_id}", headers=bearer(tenant.owner_token))


async def submit(tenants: Tenants, tenant: Tenant, product_id: str | uuid.UUID) -> httpx.Response:
    return await tenants.api.http.post(
        f"{PATH}/{product_id}/submit", headers=bearer(tenant.owner_token)
    )


async def delete(tenants: Tenants, tenant: Tenant, product_id: str | uuid.UUID) -> httpx.Response:
    return await tenants.api.http.delete(f"{PATH}/{product_id}", headers=bearer(tenant.owner_token))


async def listing(tenants: Tenants, tenant: Tenant, query: str = "") -> dict[str, Any]:
    response = await tenants.api.http.get(f"{PATH}{query}", headers=bearer(tenant.owner_token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def approved(session: AsyncSession, tenant: Tenant, sku: str = "LIVE-01") -> Product:
    """A product as an admin's approval leaves it: its one revision submitted and live."""
    await refreshed(session, tenant)
    product, revision = await submittable_revision(session, tenant.vendor, tenant.owner, sku)
    revision.submitted_at = datetime.now(UTC)
    await session.flush()
    product.live_revision_id = revision.id
    product.status = "approved"
    await session.flush()
    await session.commit()
    return product


async def reject(
    session: AsyncSession, revision_id: uuid.UUID, reason: str = "Blurry photos"
) -> None:
    """What an admin's rejection does to the review of a revision."""
    await session.execute(
        update(Review)
        .where(Review.product_revision_id == revision_id)
        .values(
            status="rejected", reviewer_id=uuid.uuid4(), decided_at=datetime.now(UTC), reason=reason
        )
    )
    await session.commit()


async def count(session: AsyncSession, model: Any, *where: Any) -> int:
    return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0


# --- Creating ----------------------------------------------------------------------------


async def test_a_new_product_is_a_draft_with_one_editable_revision(tenants: Tenants) -> None:
    response = await create(tenants, tenants.a)
    assert response.status_code == 201
    body = response.json()
    assert response.headers["location"] == f"{PATH}/{body['id']}"
    assert response.headers["cache-control"] == "no-store"
    assert (body["sku"], body["status"], body["version"]) == ("KURTA-01", "draft", 1)
    assert body["live"] is None
    working = body["working"]
    assert (working["version"], working["state"], working["title"]) == (
        1,
        "editing",
        "Block-print kurta",
    )
    assert working["submitted_at"] is None and working["review"] is None
    (item,) = working["variants"]
    assert (item["sku"], item["size"], item["price_paise"], item["is_active"]) == (
        "KURTA-M",
        "M",
        99_900,
        True,
    )


async def test_the_product_can_be_read_back(tenants: Tenants) -> None:
    created = (await create(tenants, tenants.a)).json()
    assert (await get(tenants, tenants.a, created["id"])).json() == created


async def test_images_keep_their_order_and_show_the_url(
    tenants: Tenants, session: AsyncSession
) -> None:
    first, second = await image(session, tenants.a), await image(session, tenants.a)
    body = (
        await create(
            tenants,
            tenants.a,
            images=[{"asset_id": str(second)}, {"asset_id": str(first), "alt_text": " Back "}],
        )
    ).json()
    images = body["working"]["images"]
    assert [(i["asset_id"], i["position"]) for i in images] == [(str(second), 1), (str(first), 2)]
    assert images[1]["alt_text"] == "Back"
    asset = await session.get(Asset, second)
    assert asset is not None and images[0]["url"] == asset.url


async def test_a_staff_member_can_create_too(tenants: Tenants) -> None:
    assert (await create(tenants, tenants.a, token=tenants.a.staff_token)).status_code == 201


async def test_the_sku_is_unique_per_vendor_ignoring_case(tenants: Tenants) -> None:
    assert (await create(tenants, tenants.a, "Kurta-01")).status_code == 201
    clash = await create(tenants, tenants.a, "KURTA-01", variants=[variant("OTHER-M")])
    assert clash.status_code == 409
    assert clash.json()["error"]["code"] == "sku_taken"
    # Another vendor may use the same SKU, for the product and for its variants.
    assert (await create(tenants, tenants.b, "Kurta-01")).status_code == 201


async def test_a_variant_sku_used_by_another_product_of_the_vendor_is_refused(
    tenants: Tenants, session: AsyncSession
) -> None:
    await create(tenants, tenants.a, "KURTA-01", variants=[variant("SHARED-M")])
    clash = await create(tenants, tenants.a, "KURTA-02", variants=[variant("shared-m")])
    assert clash.status_code == 409
    assert clash.json()["error"]["code"] == "sku_taken"
    assert await count(session, Product, Product.sku == "KURTA-02") == 0  # nothing half-saved


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"sku": ""}, "sku"),
        ({"sku": "has/../odd;chars"}, "sku"),
        ({"sku": "x" * 65}, "sku"),
        ({"title": "   "}, "title"),
        ({"title": "x" * 201}, "title"),
        ({"description": "x" * 4001}, "description"),
        ({"category": ""}, "category"),
        ({"gender": "kids"}, "gender"),
        ({"fabric": "x" * 81}, "fabric"),
        ({"weight_grams": 0}, "weight_grams"),
        ({"return_window_days": 31}, "return_window_days"),
        ({"returnable": True, "return_window_days": None}, None),
        ({"variants": [variant(price_paise=0)]}, "price_paise"),
        ({"variants": [variant(price_paise=500, mrp_paise=499)]}, None),
        ({"variants": [variant("A"), variant("a", size="L")]}, None),
        ({"variants": [variant("A"), variant("B")]}, None),  # same size and colour
        ({"variants": [variant(sku="bad;sku")]}, "sku"),
        ({"variants": [variant() for _ in range(2)]}, None),
        ({"variants": [variant(f"S{i}", size=str(i)) for i in range(101)]}, "variants"),
        ({"images": [{"asset_id": "nope"}]}, "asset_id"),
        ({"images": [{"asset_id": str(uuid.uuid4())} for _ in range(11)]}, "images"),
    ],
)
async def test_content_the_published_contract_would_refuse_is_a_422(
    tenants: Tenants, change: dict[str, Any], field: str | None
) -> None:
    body = {"sku": "KURTA-01", **content(), **change}
    response = await tenants.api.http.post(PATH, json=body, headers=bearer(tenants.a.owner_token))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    if field:
        assert field in {p for e in response.json()["error"]["details"] for p in e["loc"]}


async def test_unknown_fields_are_refused(tenants: Tenants) -> None:
    for extra in ({"status": "approved"}, {"vendor_id": str(tenants.b.vendor.id)}, {"version": 9}):
        response = await create(tenants, tenants.a, **extra)
        assert response.status_code == 422


async def test_the_sku_cannot_be_changed_by_an_edit(tenants: Tenants) -> None:
    created = (await create(tenants, tenants.a)).json()
    response = await put(tenants, tenants.a, created["id"], sku="NEW-SKU")
    assert response.status_code == 422


async def test_a_return_window_means_nothing_for_a_product_that_cannot_be_returned(
    tenants: Tenants,
) -> None:
    body = (await create(tenants, tenants.a, returnable=False, return_window_days=7)).json()
    assert body["working"]["returnable"] is False
    assert body["working"]["return_window_days"] is None


# --- Images and variants -----------------------------------------------------------------


async def test_another_vendors_image_is_the_same_422_as_one_that_does_not_exist(
    tenants: Tenants, session: AsyncSession
) -> None:
    theirs = await image(session, tenants.b)
    foreign = await create(tenants, tenants.a, images=[{"asset_id": str(theirs)}])
    missing = await create(tenants, tenants.a, images=[{"asset_id": str(uuid.uuid4())}])
    assert foreign.status_code == missing.status_code == 422
    assert foreign.json()["error"]["code"] == "invalid_asset"
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]
    assert await count(session, Product) == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": AssetKind.BRAND_LOGO},
        {
            "status": AssetStatus.PENDING,
            "format": None,
            "bytes": None,
            "width": None,
            "height": None,
        },
        {"status": AssetStatus.DELETED},
    ],
)
async def test_an_image_of_the_wrong_kind_or_state_is_refused(
    tenants: Tenants, session: AsyncSession, changes: dict[str, Any]
) -> None:
    asset_id = await image(session, tenants.a, **changes)
    response = await create(tenants, tenants.a, images=[{"asset_id": str(asset_id)}])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_asset"


async def test_a_variant_keeps_its_identity_across_edits(tenants: Tenants) -> None:
    created = (await create(tenants, tenants.a)).json()
    before = created["working"]["variants"][0]["id"]
    edited = (
        await put(tenants, tenants.a, created["id"], variants=[variant(price_paise=89_900)])
    ).json()
    (item,) = edited["working"]["variants"]
    assert (item["id"], item["price_paise"]) == (before, 89_900)
    # The same SKU in other letter case is the same variant.
    again = (await put(tenants, tenants.a, created["id"], variants=[variant("kurta-m")])).json()
    assert again["working"]["variants"][0]["id"] == before


async def test_a_variants_size_and_colour_cannot_change(tenants: Tenants) -> None:
    created = (await create(tenants, tenants.a)).json()
    response = await put(tenants, tenants.a, created["id"], variants=[variant(size="XL")])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "variant_identity_changed"
    unchanged = (await get(tenants, tenants.a, created["id"])).json()
    assert unchanged["working"]["variants"][0]["size"] == "M"


async def test_a_new_sku_with_an_existing_size_and_colour_is_a_409(tenants: Tenants) -> None:
    created = (await create(tenants, tenants.a)).json()
    response = await put(tenants, tenants.a, created["id"], variants=[variant("KURTA-M2")])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "variant_conflict"


# --- Editing a draft ---------------------------------------------------------------------


async def test_editing_a_draft_changes_it_in_place_and_replaces_the_lists(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    old = created["working"]
    edited = (
        await put(
            tenants,
            tenants.a,
            created["id"],
            title="Renamed",
            variants=[variant("KURTA-L", size="L")],
            images=[],
        )
    ).json()
    working = edited["working"]
    assert (working["id"], working["version"], working["title"]) == (old["id"], 1, "Renamed")
    assert [v["sku"] for v in working["variants"]] == ["KURTA-L"]
    assert working["images"] == []
    assert edited["status"] == "draft"
    assert await count(session, ProductRevision) == 1


async def test_a_staff_member_can_edit(tenants: Tenants) -> None:
    created = (await create(tenants, tenants.a)).json()
    response = await put(
        tenants, tenants.a, created["id"], token=tenants.a.staff_token, title="By staff"
    )
    assert response.status_code == 200
    assert response.json()["working"]["title"] == "By staff"


# --- Editing an approved product ---------------------------------------------------------


async def test_editing_an_approved_product_makes_a_pending_revision_and_keeps_the_live_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    before = (await get(tenants, tenants.a, product.id)).json()
    assert before["status"] == "approved" and before["working"] is None
    live_before = before["live"]

    edited = (
        await put(tenants, tenants.a, product.id, variants=LIVE_VARIANTS, title="New title")
    ).json()
    assert edited["status"] == "approved"
    assert edited["live"] == live_before  # shoppers still see the old content
    working = edited["working"]
    assert (working["version"], working["state"], working["title"]) == (2, "editing", "New title")
    assert working["id"] != live_before["id"]

    row = await session.get(Product, product.id, populate_existing=True)
    assert row is not None
    assert row.live_revision_id == uuid.UUID(live_before["id"])
    assert row.pending_revision_id == uuid.UUID(working["id"])
    live_row = await session.get(ProductRevision, row.live_revision_id, populate_existing=True)
    assert live_row is not None and live_row.title == "Block-print kurta"


async def test_more_edits_change_the_same_pending_revision(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    first = (await put(tenants, tenants.a, product.id, variants=LIVE_VARIANTS, title="One")).json()
    second = (await put(tenants, tenants.a, product.id, variants=LIVE_VARIANTS, title="Two")).json()
    assert second["working"]["id"] == first["working"]["id"]
    assert second["working"]["version"] == 2
    assert await count(session, ProductRevision, ProductRevision.product_id == product.id) == 2
    assert second["live"]["title"] == "Block-print kurta"


async def test_submitting_a_pending_revision_leaves_an_approved_product_approved(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    asset_id = await image(session, tenants.a)
    await put(
        tenants, tenants.a, product.id, variants=LIVE_VARIANTS, images=[{"asset_id": str(asset_id)}]
    )
    body = (await submit(tenants, tenants.a, product.id)).json()
    assert body["status"] == "approved"
    assert body["working"]["state"] == "in_review"
    assert body["live"]["title"] == "Block-print kurta"


# --- Submitting --------------------------------------------------------------------------


async def test_submitting_puts_the_product_in_review_and_records_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    response = await submit(tenants, tenants.a, created["id"])
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending_review"
    assert body["working"]["state"] == "in_review"
    assert body["working"]["submitted_at"] is not None
    assert body["working"]["review"]["status"] == "pending"

    review = (await session.scalars(select(Review))).one()
    assert (review.subject, review.status) == ("product", "pending")
    assert review.product_revision_id == uuid.UUID(body["working"]["id"])
    assert review.submitted_by == tenants.a.owner.id
    event = (await session.scalars(select(ReviewEvent))).one()
    assert (event.review_id, event.action, event.actor_type) == (review.id, "submitted", "vendor")


async def test_a_product_in_review_cannot_be_edited_submitted_again_or_deleted(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    await submit(tenants, tenants.a, created["id"])
    for response in (
        await put(tenants, tenants.a, created["id"], title="Too late"),
        await submit(tenants, tenants.a, created["id"]),
        await delete(tenants, tenants.a, created["id"]),
    ):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "product_in_review"
    assert await count(session, Review) == 1
    assert (await get(tenants, tenants.a, created["id"])).json()["working"][
        "title"
    ] == "Block-print kurta"


async def test_a_product_needs_an_image_and_an_active_variant_to_be_submitted(
    tenants: Tenants, session: AsyncSession
) -> None:
    no_image = (await create(tenants, tenants.a, "NO-IMAGE")).json()
    response = await submit(tenants, tenants.a, no_image["id"])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "product_incomplete"
    assert "image" in response.json()["error"]["message"]

    asset_id = await image(session, tenants.a)
    inactive = (
        await create(
            tenants,
            tenants.a,
            "INACTIVE",
            variants=[variant("INACTIVE-M", is_active=False)],
            images=[{"asset_id": str(asset_id)}],
        )
    ).json()
    response = await submit(tenants, tenants.a, inactive["id"])
    assert response.status_code == 422
    assert "variant" in response.json()["error"]["message"]
    assert await count(session, Review) == 0
    assert (await get(tenants, tenants.a, inactive["id"])).json()["status"] == "draft"


async def test_nothing_to_submit_when_an_approved_product_has_no_pending_edit(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    response = await submit(tenants, tenants.a, product.id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "nothing_to_submit"


async def test_an_image_deleted_since_it_was_added_blocks_the_submission(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    asset_id = uuid.UUID(created["working"]["images"][0]["asset_id"])
    await session.execute(update(Asset).where(Asset.id == asset_id).values(status="deleted"))
    await session.commit()
    response = await submit(tenants, tenants.a, created["id"])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_asset"
    assert await count(session, Review) == 0


async def test_a_rejected_product_is_reworked_in_a_new_revision(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    await submit(tenants, tenants.a, created["id"])
    revision_id = uuid.UUID(created["working"]["id"])
    await reject(session, revision_id)
    await session.execute(
        update(Product).where(Product.id == uuid.UUID(created["id"])).values(status="rejected")
    )
    await session.commit()

    shown = (await get(tenants, tenants.a, created["id"])).json()
    assert shown["status"] == "rejected"
    assert shown["working"]["state"] == "rejected"
    assert shown["working"]["review"]["reason"] == "Blurry photos"

    # A PUT replaces everything, so the image is listed again (the same asset may be reused).
    again = [{"asset_id": created["working"]["images"][0]["asset_id"]}]
    reworked = (
        await put(tenants, tenants.a, created["id"], title="Better photos", images=again)
    ).json()
    assert reworked["status"] == "draft"
    assert (reworked["working"]["version"], reworked["working"]["state"]) == (2, "editing")
    assert reworked["working"]["id"] != str(revision_id)
    assert (await submit(tenants, tenants.a, created["id"])).status_code == 200


# --- Deleting and archiving --------------------------------------------------------------


async def test_a_draft_that_was_never_submitted_is_deleted_for_good(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    assert (await delete(tenants, tenants.a, created["id"])).status_code == 204
    assert (await get(tenants, tenants.a, created["id"])).status_code == 404
    assert await count(session, Product) == 0
    assert await count(session, ProductRevision) == 0
    assert await count(session, ProductVariant) == 0
    assert await count(session, ProductImage) == 0
    assert (await create(tenants, tenants.a)).status_code == 201  # the SKU is free again


async def test_a_product_that_was_submitted_is_archived_and_keeps_its_sku(
    tenants: Tenants, session: AsyncSession
) -> None:
    created = await make_ready(tenants, session, tenants.a)
    await submit(tenants, tenants.a, created["id"])
    await reject(session, uuid.UUID(created["working"]["id"]))
    await session.execute(
        update(Product).where(Product.id == uuid.UUID(created["id"])).values(status="rejected")
    )
    await session.commit()

    assert (await delete(tenants, tenants.a, created["id"])).status_code == 204
    archived = (await get(tenants, tenants.a, created["id"])).json()
    assert archived["status"] == "archived"
    assert (await create(tenants, tenants.a)).json()["error"]["code"] == "sku_taken"
    for response in (
        await put(tenants, tenants.a, created["id"]),
        await submit(tenants, tenants.a, created["id"]),
    ):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "product_archived"
    assert (
        await delete(tenants, tenants.a, created["id"])
    ).status_code == 204  # nothing more to do


async def test_archiving_an_approved_product_takes_it_off_sale_and_raises_its_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    await put(
        tenants, tenants.a, product.id, variants=LIVE_VARIANTS, title="Unsubmitted edit"
    )  # a pending revision

    assert (await delete(tenants, tenants.a, product.id)).status_code == 204
    body = (await get(tenants, tenants.a, product.id)).json()
    assert (body["status"], body["version"]) == ("archived", 2)
    assert body["live"]["title"] == "Block-print kurta"  # the history stays
    # The unsubmitted edit is gone; the live (submitted) revision is kept.
    assert await count(session, ProductRevision, ProductRevision.product_id == product.id) == 1
    assert body["working"] is None


# --- Listing -----------------------------------------------------------------------------


async def test_the_list_is_paged_with_a_total(tenants: Tenants) -> None:
    for number in range(3):
        await create(tenants, tenants.a, f"SKU-{number}", variants=[variant(f"SKU-{number}-M")])
    first = await listing(tenants, tenants.a, "?limit=2")
    assert (first["total"], first["limit"], first["offset"], len(first["items"])) == (3, 2, 0, 2)
    rest = await listing(tenants, tenants.a, "?limit=2&offset=2")
    assert len(rest["items"]) == 1
    seen = [item["sku"] for item in first["items"] + rest["items"]]
    assert sorted(seen) == ["SKU-0", "SKU-1", "SKU-2"]


@pytest.mark.parametrize("query", ["?limit=0", "?limit=101", "?offset=-1", "?status=bogus"])
async def test_bad_paging_or_filter_values_are_a_422(tenants: Tenants, query: str) -> None:
    response = await tenants.api.http.get(PATH + query, headers=bearer(tenants.a.owner_token))
    assert response.status_code == 422


async def test_the_list_filters_by_status_category_and_text(
    tenants: Tenants, session: AsyncSession
) -> None:
    await create(tenants, tenants.a, "KURTA-01", variants=[variant("K1-M")])
    await create(
        tenants,
        tenants.a,
        "SAREE-01",
        title="Silk saree",
        category="Sarees",
        variants=[variant("S1-M")],
    )
    await approved(session, tenants.a, "LIVE-01")

    assert {i["sku"] for i in (await listing(tenants, tenants.a))["items"]} == {
        "KURTA-01",
        "SAREE-01",
        "LIVE-01",
    }
    approved_only = await listing(tenants, tenants.a, "?status=approved")
    assert [i["sku"] for i in approved_only["items"]] == ["LIVE-01"]
    assert [i["sku"] for i in (await listing(tenants, tenants.a, "?category=sarees"))["items"]] == [
        "SAREE-01"
    ]
    assert [i["sku"] for i in (await listing(tenants, tenants.a, "?q=SILK"))["items"]] == [
        "SAREE-01"
    ]
    assert [i["sku"] for i in (await listing(tenants, tenants.a, "?q=kurta-0"))["items"]] == [
        "KURTA-01"
    ]
    assert (await listing(tenants, tenants.a, "?q=nothing-like-this"))["total"] == 0


async def test_a_wildcard_in_the_search_text_matches_nothing_extra(tenants: Tenants) -> None:
    await create(tenants, tenants.a, "KURTA-01")
    assert (await listing(tenants, tenants.a, "?q=%25"))["total"] == 0
    assert (await listing(tenants, tenants.a, "?q=_"))["total"] == 0


async def test_the_list_shows_the_latest_title_and_whether_changes_are_pending(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    (item,) = (await listing(tenants, tenants.a))["items"]
    assert (item["title"], item["has_pending_changes"]) == ("Block-print kurta", False)
    await put(tenants, tenants.a, product.id, variants=LIVE_VARIANTS, title="Edited title")
    (item,) = (await listing(tenants, tenants.a))["items"]
    assert (item["title"], item["has_pending_changes"]) == ("Edited title", True)


async def test_archived_products_are_listed_only_when_asked_for(
    tenants: Tenants, session: AsyncSession
) -> None:
    product = await approved(session, tenants.a)
    await delete(tenants, tenants.a, product.id)
    assert (await listing(tenants, tenants.a))["total"] == 0
    archived = await listing(tenants, tenants.a, "?status=archived")
    assert [i["sku"] for i in archived["items"]] == ["LIVE-01"]


# --- One vendor never sees another's -----------------------------------------------------


async def test_each_vendor_lists_only_its_own_products(tenants: Tenants) -> None:
    await create(tenants, tenants.a, "ONLY-A", title="Only A sells this")
    await create(tenants, tenants.b, "ONLY-B")
    a, b = await listing(tenants, tenants.a), await listing(tenants, tenants.b)
    assert [i["sku"] for i in a["items"]] == ["ONLY-A"]
    assert [i["sku"] for i in b["items"]] == ["ONLY-B"]
    assert "Only A sells this" not in str(b)


async def test_another_vendors_product_is_a_404_for_every_action_like_a_missing_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    theirs = await make_ready(tenants, session, tenants.b, "THEIRS")
    missing = uuid.uuid4()
    actions: dict[str, Callable[[str | uuid.UUID], Awaitable[httpx.Response]]] = {
        "get": lambda i: get(tenants, tenants.a, i),
        "put": lambda i: put(tenants, tenants.a, i),
        "submit": lambda i: submit(tenants, tenants.a, i),
        "delete": lambda i: delete(tenants, tenants.a, i),
    }
    for name, call in actions.items():
        foreign, absent = await call(theirs["id"]), await call(missing)
        assert foreign.status_code == absent.status_code == 404, name
        assert foreign.json()["error"]["code"] == "product_not_found"
        assert foreign.json()["error"]["message"] == absent.json()["error"]["message"]
    still = (await get(tenants, tenants.b, theirs["id"])).json()
    assert still == theirs  # untouched


async def test_the_vendor_id_in_the_request_is_ignored(
    tenants: Tenants, session: AsyncSession
) -> None:
    response = await tenants.api.http.post(
        f"{PATH}?vendor_id={tenants.b.vendor.id}",
        json={"sku": "KURTA-01", **content()},
        headers={**bearer(tenants.a.owner_token), "X-Vendor-Id": str(tenants.b.vendor.id)},
    )
    assert response.status_code == 201
    (product,) = (await session.scalars(select(Product))).all()
    assert product.vendor_id == tenants.a.vendor.id


async def test_every_endpoint_needs_a_vendor_token(tenants: Tenants) -> None:
    http, some = tenants.api.http, uuid.uuid4()
    calls = [
        http.get(PATH),
        http.post(PATH, json={}),
        http.get(f"{PATH}/{some}"),
        http.put(f"{PATH}/{some}", json={}),
        http.post(f"{PATH}/{some}/submit"),
        http.delete(f"{PATH}/{some}"),
    ]
    for call in calls:
        assert (await call).status_code == 401
    assert (await http.get(PATH, headers=bearer(tenants.admin_token))).status_code == 401
