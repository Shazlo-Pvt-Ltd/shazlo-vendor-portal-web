"""`GET /v1/vendor/submissions` and the `review` of a brand profile version.

Reviews are built straight in the database (see `review_builders.py`); the requests then read
them back the way the portal does. A refused request rolls the shared test session back, so each
test commits what it sets up first.
"""

import json
from typing import Any

import httpx
from conftest import Tenant, Tenants
from review_builders import (
    decision,
    product_review,
    profile,
    profile_review,
    submitted_product,
)
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import Vendor

PATH = "/v1/vendor/submissions"
BRAND = "/v1/vendor/brand-profile"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def listing(
    tenants: Tenants, tenant: Tenant, query: str = "", token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.get(PATH + query, headers=bearer(token or tenant.owner_token))


async def build(session: AsyncSession, tenants: Tenants) -> dict[str, Any]:
    """Vendor A: brand v1 approved, brand v2 rejected with a reason, a product in review."""
    a = tenants.a
    approved = await profile(session, a, 1, "published")
    rejected = await profile(session, a, 2, "rejected")
    await profile_review(session, a, approved, 1, **decision("approved", 2))
    rejected_review = await profile_review(
        session, a, rejected, 3, **decision("rejected", 4, reason="The banner is blurry")
    )
    product, revision = await submitted_product(session, a, "KURTA-01", 5)
    await product_review(session, a, revision, 5)
    await session.commit()
    return {
        "approved": approved,
        "rejected": rejected,
        "rejected_review": rejected_review,
        "product": product,
    }


async def test_one_call_lists_everything_submitted_newest_first(
    tenants: Tenants, session: AsyncSession
) -> None:
    built = await build(session, tenants)

    response = await listing(tenants, tenants.a)

    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["limit"], body["offset"]) == (3, 25, 0)
    assert [(i["subject"], i["version"], i["status"]) for i in body["items"]] == [
        ("product", 1, "pending"),
        ("brand_profile", 2, "rejected"),
        ("brand_profile", 1, "approved"),
    ]
    product, rejected, approved = body["items"]
    assert product["id"] == str(built["product"].id)
    assert product["sku"] == "KURTA-01" and product["title"]
    assert product["decided_at"] is None and product["reason"] is None
    assert rejected["id"] == str(built["rejected"].id)
    assert rejected["reason"] == "The banner is blurry"
    assert rejected["sku"] is None and rejected["title"] is None
    assert approved["decided_at"] is not None


async def test_filters_by_status_and_subject(tenants: Tenants, session: AsyncSession) -> None:
    await build(session, tenants)

    async def shown(query: str) -> list[tuple[str, int]]:
        response = await listing(tenants, tenants.a, query)
        assert response.status_code == 200
        return [(i["subject"], i["version"]) for i in response.json()["items"]]

    assert await shown("?status=rejected") == [("brand_profile", 2)]
    assert await shown("?status=pending") == [("product", 1)]
    assert await shown("?status=withdrawn") == []
    assert len(await shown("?status=all")) == 3
    assert await shown("?subject=brand_profile") == [("brand_profile", 2), ("brand_profile", 1)]
    assert await shown("?subject=product&status=pending") == [("product", 1)]
    assert await shown("?subject=product&status=approved") == []


async def test_pages_with_a_total(tenants: Tenants, session: AsyncSession) -> None:
    await build(session, tenants)

    first = (await listing(tenants, tenants.a, "?limit=2")).json()
    second = (await listing(tenants, tenants.a, "?limit=2&offset=2")).json()

    assert first["total"] == second["total"] == 3
    assert (first["limit"], first["offset"]) == (2, 0)
    assert (second["limit"], second["offset"]) == (2, 2)
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    seen = [i["version"] for i in first["items"] + second["items"]]
    assert seen == [1, 2, 1]


async def test_a_vendor_never_sees_another_vendors_reviews(
    tenants: Tenants, session: AsyncSession
) -> None:
    await build(session, tenants)
    other = await profile(session, tenants.b, 1, "rejected")
    await profile_review(
        session, tenants.b, other, 6, **decision("rejected", 7, reason="Not for B's eyes")
    )
    await session.commit()

    mine = (await listing(tenants, tenants.b)).json()
    theirs = (await listing(tenants, tenants.a)).json()

    assert mine["total"] == 1 and mine["items"][0]["reason"] == "Not for B's eyes"
    assert theirs["total"] == 3
    assert "Not for B's eyes" not in json.dumps(theirs)
    assert str(other.id) not in json.dumps(theirs)


async def test_no_reviewer_appears_anywhere(tenants: Tenants, session: AsyncSession) -> None:
    built = await build(session, tenants)
    reviewer = str(built["rejected_review"].reviewer_id)
    assert reviewer != "None"

    listed = (await listing(tenants, tenants.a)).text
    draft = (await tenants.api.http.get(BRAND, headers=bearer(tenants.a.owner_token))).text
    published = (
        await tenants.api.http.get(BRAND + "/published", headers=bearer(tenants.a.owner_token))
    ).text

    for text in (listed, draft, published):
        assert reviewer not in text
        assert "reviewer" not in text


async def test_staff_and_a_pending_vendor_can_read_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    await build(session, tenants)

    as_staff = await listing(tenants, tenants.a, token=tenants.a.staff_token)

    assert as_staff.status_code == 200 and as_staff.json()["total"] == 3
    # The test vendors have not been approved by an admin yet.
    vendor = await session.get(Vendor, tenants.a.vendor.id)
    assert vendor is not None and vendor.status == "pending"


async def test_a_rejected_or_suspended_vendor_cannot_read_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    for status in ("rejected", "suspended"):
        await session.execute(
            update(Vendor).where(Vendor.id == tenants.a.vendor.id).values(status=status)
        )
        await session.commit()

        response = await listing(tenants, tenants.a)

        assert (response.status_code, response.json()["error"]["code"]) == (
            403,
            "vendor_not_allowed",
        )


async def test_it_needs_a_token(tenants: Tenants) -> None:
    response = await tenants.api.http.get(PATH)

    assert response.status_code == 401


async def test_bad_queries_are_refused(tenants: Tenants) -> None:
    for query in ("?limit=0", "?limit=101", "?offset=-1", "?status=bogus", "?subject=bogus"):
        assert (await listing(tenants, tenants.a, query)).status_code == 422


async def test_a_brand_version_carries_the_review_of_that_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    built = await build(session, tenants)

    published = (
        await tenants.api.http.get(BRAND + "/published", headers=bearer(tenants.a.owner_token))
    ).json()
    # The draft is made from the latest version; it has not been submitted, so no review yet.
    draft = (await tenants.api.http.get(BRAND, headers=bearer(tenants.a.owner_token))).json()

    assert published["id"] == str(built["approved"].id)
    assert published["review"]["status"] == "approved"
    assert published["review"]["reason"] is None
    assert set(published["review"]) == {"status", "reason", "decided_at", "submitted_at"}
    assert draft["review"] is None


async def test_submitting_returns_the_new_pending_review(
    tenants: Tenants, session: AsyncSession
) -> None:
    """The submit response is the version just sent: its review is pending, with no reason."""
    await profile(session, tenants.a, 1, "published", brand_name="Live")
    await session.commit()
    saved = await tenants.api.http.put(
        BRAND,
        json={
            "brand_name": "Atelier Rao",
            "categories": ["kurtas"],
            "price_min_paise": 100,
            "price_max_paise": 200,
        },
        headers=bearer(tenants.a.owner_token),
    )
    assert saved.status_code == 200

    sent = await tenants.api.http.post(BRAND + "/submit", headers=bearer(tenants.a.owner_token))

    assert sent.status_code == 200
    assert sent.json()["review"]["status"] == "pending"
    assert sent.json()["review"]["reason"] is None
    listed = (await listing(tenants, tenants.a, "?status=pending")).json()
    assert [(i["subject"], i["version"]) for i in listed["items"]] == [("brand_profile", 2)]
