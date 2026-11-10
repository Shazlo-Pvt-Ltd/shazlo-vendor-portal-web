"""The brand profile endpoints: edit the draft, submit it for review, read the published version."""

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from factories import saved_asset, saved_profile
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    AssetKind,
    AssetStatus,
    BrandProfile,
    Review,
    ReviewEvent,
    Vendor,
)

PATH = "/v1/vendor/brand-profile"

CONTENT: dict[str, Any] = {
    "brand_name": "Atelier Rao",
    "tagline": "Block prints, made slowly",
    "about": "A small studio in Jaipur.",
    "logo_asset_id": None,
    "banner_asset_id": None,
    "website_url": "https://atelier.example",
    "instagram_handle": "atelier.rao",
    "categories": ["kurtas", "dupattas"],
    "price_min_paise": 99_900,
    "price_max_paise": 999_900,
}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, tenant: Tenant, path: str = "") -> httpx.Response:
    return await tenants.api.http.get(PATH + path, headers=bearer(tenant.owner_token))


async def put(
    tenants: Tenants, tenant: Tenant, body: dict[str, Any], token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.put(PATH, json=body, headers=bearer(token or tenant.owner_token))


async def submit(tenants: Tenants, tenant: Tenant, token: str | None = None) -> httpx.Response:
    return await tenants.api.http.post(
        PATH + "/submit", headers=bearer(token or tenant.owner_token)
    )


async def rows(session: AsyncSession, model: Any, vendor: Vendor, *order: Any) -> list[Any]:
    result: Any = await session.scalars(
        select(model)
        .where(model.vendor_id == vendor.id)
        .order_by(*order)
        .execution_options(populate_existing=True)
    )
    return list(result)


async def published(session: AsyncSession, vendor: Vendor, **changes: Any) -> BrandProfile:
    now = datetime.now(UTC)
    values: dict[str, Any] = {
        "state": "published",
        "brand_name": "Live name",
        "categories": ["kurtas"],
        "submitted_at": now,
        "published_at": now,
    }
    return await saved_profile(session, vendor, **{**values, **changes})


# --- The draft ---------------------------------------------------------------------------


async def test_the_first_draft_starts_from_the_signup_details(tenants: Tenants) -> None:
    response = await get(tenants, tenants.a)
    assert response.status_code == 200
    body = response.json()
    assert response.headers["cache-control"] == "no-store"
    assert (body["state"], body["version"]) == ("draft", 1)
    assert body["brand_name"] == tenants.a.vendor.name
    assert body["price_min_paise"] == 10_000
    assert body["price_max_paise"] == 90_000
    assert body["categories"] == []
    assert body["in_review_version"] is None
    assert body["published_at"] is None and body["submitted_at"] is None


async def test_reading_the_draft_twice_gives_the_same_draft(
    tenants: Tenants, session: AsyncSession
) -> None:
    first = (await get(tenants, tenants.a)).json()
    second = (await get(tenants, tenants.a)).json()
    assert first["id"] == second["id"]
    assert len(await rows(session, BrandProfile, tenants.a.vendor)) == 1


async def test_saving_replaces_the_content_and_the_next_read_shows_it(tenants: Tenants) -> None:
    saved = await put(tenants, tenants.a, CONTENT)
    assert saved.status_code == 200
    body = saved.json()
    for field, value in CONTENT.items():
        assert body[field] == value
    assert body["state"] == "draft"
    assert (await get(tenants, tenants.a)).json() == {**body, "in_review_version": None}


async def test_a_field_left_out_is_cleared(tenants: Tenants) -> None:
    await put(tenants, tenants.a, CONTENT)
    minimal = {"brand_name": "Only a name", "price_min_paise": 0, "price_max_paise": 0}
    body = (await put(tenants, tenants.a, minimal)).json()
    assert body["tagline"] is None and body["about"] is None
    assert body["website_url"] is None and body["instagram_handle"] is None
    assert body["categories"] == []


async def test_text_is_trimmed_and_a_pasted_handle_loses_its_at_sign(tenants: Tenants) -> None:
    body = (
        await put(
            tenants,
            tenants.a,
            {
                **CONTENT,
                "brand_name": "  Atelier Rao  ",
                "tagline": "   ",
                "instagram_handle": " @atelier.rao ",
                "categories": [" kurtas ", "dupattas"],
            },
        )
    ).json()
    assert body["brand_name"] == "Atelier Rao"
    assert body["tagline"] is None
    assert body["instagram_handle"] == "atelier.rao"
    assert body["categories"] == ["kurtas", "dupattas"]


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"brand_name": "   "}, "brand_name"),
        ({"brand_name": "x" * 121}, "brand_name"),
        ({"tagline": "x" * 161}, "tagline"),
        ({"about": "x" * 4001}, "about"),
        ({"website_url": "http://atelier.example"}, "website_url"),
        ({"website_url": "https://atelier example"}, "website_url"),
        ({"instagram_handle": "has space"}, "instagram_handle"),
        ({"instagram_handle": "x" * 31}, "instagram_handle"),
        ({"categories": ["kurtas", "kurtas"]}, "categories"),
        ({"categories": ["kurtas", "  "]}, "categories"),
        ({"categories": ["x" * 81]}, "categories"),
        ({"categories": [f"c{i}" for i in range(21)]}, "categories"),
        ({"price_min_paise": -1}, "price_min_paise"),
        ({"price_min_paise": 5, "price_max_paise": 4}, None),
        ({"logo_asset_id": "not-a-uuid"}, "logo_asset_id"),
    ],
)
async def test_content_the_published_contract_would_refuse_is_a_422(
    tenants: Tenants, change: dict[str, Any], field: str | None
) -> None:
    response = await put(tenants, tenants.a, {**CONTENT, **change})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    if field:
        assert field in {part for e in response.json()["error"]["details"] for part in e["loc"]}


async def test_unknown_fields_are_refused_not_ignored(tenants: Tenants) -> None:
    for extra in ({"state": "published"}, {"vendor_id": str(tenants.b.vendor.id)}):
        response = await put(tenants, tenants.a, {**CONTENT, **extra})
        assert response.status_code == 422


async def test_a_staff_member_can_edit_too(tenants: Tenants) -> None:
    response = await put(tenants, tenants.a, CONTENT, token=tenants.a.staff_token)
    assert response.status_code == 200
    assert (await get(tenants, tenants.a)).json()["brand_name"] == "Atelier Rao"


async def test_every_endpoint_needs_a_token(tenants: Tenants) -> None:
    http = tenants.api.http
    assert (await http.get(PATH)).status_code == 401
    assert (await http.put(PATH, json=CONTENT)).status_code == 401
    assert (await http.post(PATH + "/submit")).status_code == 401
    assert (await http.get(PATH + "/published")).status_code == 401
    assert (await http.get(PATH, headers=bearer(tenants.admin_token))).status_code == 401


async def test_a_suspended_vendor_cannot_use_it(tenants: Tenants, session: AsyncSession) -> None:
    await session.execute(
        update(Vendor).where(Vendor.id == tenants.a.vendor.id).values(status="suspended")
    )
    await session.commit()
    assert (await get(tenants, tenants.a)).status_code == 403
    assert (await put(tenants, tenants.a, CONTENT)).status_code == 403
    assert (await submit(tenants, tenants.a)).status_code == 403


# --- Images ------------------------------------------------------------------------------


async def test_the_draft_can_use_the_vendors_own_logo_and_banner(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor, user = tenants.a.vendor, tenants.a.owner
    logo = await saved_asset(session, vendor, user, public_id="a/logo")
    banner = await saved_asset(
        session, vendor, user, public_id="a/banner", kind=AssetKind.BRAND_BANNER
    )
    body = (
        await put(
            tenants,
            tenants.a,
            {**CONTENT, "logo_asset_id": str(logo.id), "banner_asset_id": str(banner.id)},
        )
    ).json()
    assert body["logo_asset_id"] == str(logo.id)
    assert body["logo_url"] == logo.url
    assert body["banner_url"] == banner.url


async def test_another_vendors_image_is_the_same_422_as_one_that_does_not_exist(
    tenants: Tenants, session: AsyncSession
) -> None:
    theirs = await saved_asset(session, tenants.b.vendor, tenants.b.owner, public_id="b/logo")
    foreign = await put(tenants, tenants.a, {**CONTENT, "logo_asset_id": str(theirs.id)})
    missing = await put(tenants, tenants.a, {**CONTENT, "logo_asset_id": str(uuid.uuid4())})
    assert foreign.status_code == missing.status_code == 422
    assert foreign.json()["error"]["code"] == "invalid_asset"
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": AssetKind.PRODUCT_IMAGE},  # not a logo
        {
            "status": AssetStatus.PENDING,
            "format": None,
            "bytes": None,
            "width": None,
            "height": None,
        },  # not uploaded yet
        {"status": AssetStatus.DELETED},
    ],
)
async def test_an_image_of_the_wrong_kind_or_state_is_refused(
    tenants: Tenants, session: AsyncSession, changes: dict[str, Any]
) -> None:
    asset = await saved_asset(session, tenants.a.vendor, tenants.a.owner, **changes)
    response = await put(tenants, tenants.a, {**CONTENT, "logo_asset_id": str(asset.id)})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_asset"


# --- The published version ---------------------------------------------------------------


async def test_there_is_no_published_profile_until_one_is_approved(tenants: Tenants) -> None:
    response = await get(tenants, tenants.a, "/published")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "no_published_profile"


async def test_the_published_version_is_read_as_approved(
    tenants: Tenants, session: AsyncSession
) -> None:
    live = await published(session, tenants.a.vendor)
    body = (await get(tenants, tenants.a, "/published")).json()
    assert (body["id"], body["state"], body["brand_name"]) == (
        str(live.id),
        "published",
        "Live name",
    )
    assert body["published_at"] is not None


async def test_editing_the_draft_never_changes_the_published_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    live = await published(session, tenants.a.vendor)
    before = (await get(tenants, tenants.a, "/published")).json()
    await put(tenants, tenants.a, {**CONTENT, "brand_name": "Work in progress"})
    await submit(tenants, tenants.a)
    assert (await get(tenants, tenants.a, "/published")).json() == before
    await session.refresh(live)
    assert (live.state, live.brand_name) == ("published", "Live name")


async def test_the_next_draft_starts_from_the_latest_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    await published(session, tenants.a.vendor, brand_name="Live name", categories=["sarees"])
    body = (await get(tenants, tenants.a)).json()
    assert (body["state"], body["version"]) == ("draft", 2)
    assert (body["brand_name"], body["categories"]) == ("Live name", ["sarees"])
    assert body["published_at"] is None and body["submitted_at"] is None


async def test_a_rejected_version_is_the_start_of_the_next_draft(
    tenants: Tenants, session: AsyncSession
) -> None:
    await saved_profile(
        session,
        tenants.a.vendor,
        state="rejected",
        brand_name="Needs work",
        categories=["kurtas"],
        submitted_at=datetime.now(UTC),
    )
    body = (await get(tenants, tenants.a)).json()
    assert (body["version"], body["brand_name"]) == (2, "Needs work")
    assert (await submit(tenants, tenants.a)).status_code == 200


# --- Submitting --------------------------------------------------------------------------


async def test_submitting_puts_the_draft_in_review_and_records_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, CONTENT)
    response = await submit(tenants, tenants.a, token=tenants.a.staff_token)
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "pending_review"
    assert body["submitted_at"] is not None

    (profile,) = await rows(session, BrandProfile, tenants.a.vendor)
    (review,) = await rows(session, Review, tenants.a.vendor)
    assert (review.subject, review.status) == ("brand_profile", "pending")
    assert review.brand_profile_id == profile.id == uuid.UUID(body["id"])
    assert review.submitted_by == tenants.a.staff.id
    assert review.reviewer_id is None and review.decided_at is None
    (event,) = (await session.scalars(select(ReviewEvent))).all()
    assert (event.review_id, event.action, event.actor_type, event.actor_id) == (
        review.id,
        "submitted",
        "vendor",
        tenants.a.staff.id,
    )


async def test_the_submitted_version_is_frozen_and_the_next_edit_opens_a_new_draft(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, CONTENT)
    submitted = (await submit(tenants, tenants.a)).json()
    edited = (await put(tenants, tenants.a, {**CONTENT, "brand_name": "Second thoughts"})).json()
    assert edited["id"] != submitted["id"]
    assert (edited["version"], edited["state"]) == (2, "draft")
    assert edited["in_review_version"] == 1

    first, second = await rows(session, BrandProfile, tenants.a.vendor, BrandProfile.version)
    assert (first.state, first.brand_name) == ("pending_review", "Atelier Rao")
    assert (second.state, second.brand_name) == ("draft", "Second thoughts")


async def test_a_second_submission_waits_for_the_first_review(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, CONTENT)
    await submit(tenants, tenants.a)
    await put(tenants, tenants.a, {**CONTENT, "brand_name": "Second thoughts"})
    response = await submit(tenants, tenants.a)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "review_pending"

    states = [
        p.state for p in await rows(session, BrandProfile, tenants.a.vendor, BrandProfile.version)
    ]
    assert states == ["pending_review", "draft"]
    assert await session.scalar(select(func.count()).select_from(Review)) == 1


async def test_submitting_twice_does_not_create_a_second_review(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, CONTENT)
    assert (await submit(tenants, tenants.a)).status_code == 200
    again = await submit(tenants, tenants.a)
    assert again.status_code == 409
    assert await session.scalar(select(func.count()).select_from(Review)) == 1


async def test_nothing_to_submit_without_a_draft(tenants: Tenants) -> None:
    response = await submit(tenants, tenants.a)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "nothing_to_submit"


async def test_a_draft_without_a_category_cannot_be_submitted(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, {**CONTENT, "categories": []})
    response = await submit(tenants, tenants.a)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "profile_incomplete"
    (profile,) = await rows(session, BrandProfile, tenants.a.vendor)
    assert profile.state == "draft" and profile.submitted_at is None
    assert await session.scalar(select(func.count()).select_from(Review)) == 0


async def test_an_image_deleted_since_saving_blocks_the_submission(
    tenants: Tenants, session: AsyncSession
) -> None:
    logo = await saved_asset(session, tenants.a.vendor, tenants.a.owner, public_id="a/logo")
    await put(tenants, tenants.a, {**CONTENT, "logo_asset_id": str(logo.id)})
    logo.status = AssetStatus.DELETED
    await session.commit()
    response = await submit(tenants, tenants.a)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_asset"
    assert await session.scalar(select(func.count()).select_from(Review)) == 0


async def test_a_pending_vendor_can_edit_and_submit(tenants: Tenants) -> None:
    assert tenants.a.vendor.status == "pending"
    await put(tenants, tenants.a, CONTENT)
    assert (await submit(tenants, tenants.a)).status_code == 200


# --- One vendor never sees another's ----------------------------------------------------


async def test_each_vendor_has_its_own_draft_and_published_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, {**CONTENT, "brand_name": "Only A knows this"})
    await published(session, tenants.a.vendor, brand_name="A is live")

    b_draft = await get(tenants, tenants.b)
    assert b_draft.status_code == 200
    assert "Only A knows this" not in b_draft.text
    assert b_draft.json()["brand_name"] == tenants.b.vendor.name
    assert (await get(tenants, tenants.b, "/published")).status_code == 404

    a_draft = (await get(tenants, tenants.a)).json()
    assert a_draft["id"] != b_draft.json()["id"]
    assert (await get(tenants, tenants.b, "/published")).text.count("A is live") == 0


async def test_one_vendor_cannot_submit_another_vendors_draft(
    tenants: Tenants, session: AsyncSession
) -> None:
    await put(tenants, tenants.a, CONTENT)
    response = await submit(tenants, tenants.b)  # B has no draft of its own
    assert response.status_code == 409
    (profile,) = await rows(session, BrandProfile, tenants.a.vendor)
    assert profile.state == "draft"


async def test_the_vendor_id_in_the_request_is_ignored(
    tenants: Tenants, session: AsyncSession
) -> None:
    response = await tenants.api.http.put(
        f"{PATH}?vendor_id={tenants.b.vendor.id}",
        json=CONTENT,
        headers={**bearer(tenants.a.owner_token), "X-Vendor-Id": str(tenants.b.vendor.id)},
    )
    assert response.status_code == 200
    assert len(await rows(session, BrandProfile, tenants.a.vendor)) == 1
    assert await rows(session, BrandProfile, tenants.b.vendor) == []
