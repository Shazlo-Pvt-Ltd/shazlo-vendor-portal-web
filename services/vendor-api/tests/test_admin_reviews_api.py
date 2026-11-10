"""The reviewers' queue and the diff of one review, over HTTP.

Reviews are built straight in the database with the factories: this endpoint only reads, so what
matters is what the tables hold, not how a vendor got it there.
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import Tenants
from factories import saved_asset
from review_builders import (
    at,
    decision,
    product_review,
    profile,
    profile_review,
    submitted_product,
    two_revisions,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Review,
    ReviewEvent,
)

QUEUE = "/v1/admin/reviews"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, path: str = "", token: str | None = None) -> httpx.Response:
    return await tenants.api.http.get(QUEUE + path, headers=bearer(token or tenants.admin_token))


def ids(response: httpx.Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def changes(response: httpx.Response) -> list[tuple[str, Any, Any]]:
    assert response.status_code == 200, response.text
    return [(c["field"], c["before"], c["after"]) for c in response.json()["changes"]]


# --- Reviews to look at --------------------------------------------------------


@pytest.fixture
async def queue_world(tenants: Tenants, session: AsyncSession) -> dict[str, Review]:
    """Six reviews of two vendors in every state, submitted at known times."""
    a, b = tenants.a, tenants.b
    pending_profile = await profile(session, a, 1, "pending_review")
    published_profile = await profile(session, a, 2, "published", brand_name="Live brand")
    _, b_revision = await submitted_product(session, b, "B-1", 3)
    _, a_revision = await submitted_product(session, a, "A-1", 4)
    _, rejected_revision = await submitted_product(session, a, "A-2", 5)
    _, withdrawn_revision = await submitted_product(session, b, "B-2", 6)
    return {
        "profile_pending": await profile_review(session, a, pending_profile, 1),
        "profile_approved": await profile_review(
            session, a, published_profile, 0, **decision("approved", 0.5)
        ),
        "b_product": await product_review(session, b, b_revision, 2),
        "a_product": await product_review(session, a, a_revision, 3),
        "rejected": await product_review(
            session, a, rejected_revision, 1.5, **decision("rejected", 2.5)
        ),
        "withdrawn": await product_review(
            session, b, withdrawn_revision, 2.5, status="withdrawn", decided_at=at(3)
        ),
    }


# --- Who may call ------------------------------------------------------------------------


async def test_a_reviewer_and_a_super_admin_can_read_the_queue(tenants: Tenants) -> None:
    identity = tenants.identity
    for roles in (["vendor_reviewer"], ["super_admin"], ["super_admin", "vendor_reviewer"]):
        response = await get(tenants, token=identity.token(roles))
        assert response.status_code == 200, roles
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("roles", [[], ["other_role"], ["vendor"]])
async def test_an_admin_without_the_reviewer_role_is_refused(
    tenants: Tenants, roles: list[str]
) -> None:
    some = f"/{uuid.uuid4()}"
    for path in ("", some):
        response = await get(tenants, path, token=tenants.identity.token(roles))
        assert response.status_code == 403, (roles, path)
        assert response.json()["error"]["code"] == "forbidden"


async def test_vendor_tokens_and_no_token_never_reach_the_queue(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    http = tenants.api.http
    some = f"/{queue_world['a_product'].id}"
    for path in ("", some):
        assert (await http.get(QUEUE + path)).status_code == 401
        for token in (tenants.a.owner_token, tenants.a.staff_token, tenants.b.owner_token):
            response = await http.get(QUEUE + path, headers=bearer(token))
            assert response.status_code == 401, path
        # A token for another audience, or garbage, is no better.
        forged = tenants.identity.token(["vendor_reviewer"], audience="identity-api")
        assert (await http.get(QUEUE + path, headers=bearer(forged))).status_code == 401
        assert (await http.get(QUEUE + path, headers=bearer("not.a.token"))).status_code == 401


async def test_the_queue_is_read_only(tenants: Tenants) -> None:
    for method in ("post", "put", "patch", "delete"):
        response = await tenants.api.http.request(
            method, QUEUE, headers=bearer(tenants.admin_token), json={}
        )
        assert response.status_code == 405


# --- The queue ---------------------------------------------------------------------------


async def test_the_queue_shows_pending_reviews_oldest_first(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    response = await get(tenants)
    assert ids(response) == [
        str(queue_world[name].id) for name in ("profile_pending", "b_product", "a_product")
    ]
    assert response.json()["total"] == 3
    assert {i["status"] for i in response.json()["items"]} == {"pending"}


async def test_a_reviewer_sees_every_vendors_submissions(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    vendors = {item["vendor"]["id"] for item in (await get(tenants, "?status=all")).json()["items"]}
    assert vendors == {str(tenants.a.vendor.id), str(tenants.b.vendor.id)}


async def test_each_item_says_who_what_and_when(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    items = {i["id"]: i for i in (await get(tenants, "?status=all")).json()["items"]}
    brand = items[str(queue_world["profile_pending"].id)]
    assert brand["subject"] == "brand_profile"
    assert brand["vendor"] == {
        "id": str(tenants.a.vendor.id),
        "name": "Brand A",
        "slug": "brand-a",
        "status": "pending",
    }
    assert (brand["version"], brand["title"]) == (1, "Acme")
    assert (brand["product_id"], brand["sku"]) == (None, None)
    assert brand["submitted_by"] == str(tenants.a.owner.id)
    assert brand["submitted_by_email"] == tenants.a.owner.email
    assert brand["submitted_at"].startswith("2026-11-01T10:00")
    assert (brand["reviewer_id"], brand["decided_at"], brand["reason"]) == (None, None, None)

    product = items[str(queue_world["b_product"].id)]
    assert product["subject"] == "product"
    assert product["vendor"]["slug"] == "brand-b"
    assert (product["sku"], product["version"], product["title"]) == ("B-1", 1, "Block-print kurta")
    assert product["product_id"]


async def test_decided_reviews_show_the_reviewer_the_time_and_the_reason(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    rejected = (await get(tenants, "?status=rejected")).json()["items"]
    assert [i["id"] for i in rejected] == [str(queue_world["rejected"].id)]
    assert rejected[0]["reason"] == "Photos are blurry"
    assert rejected[0]["reviewer_id"] and rejected[0]["decided_at"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("?status=approved", ["profile_approved"]),
        ("?status=rejected", ["rejected"]),
        ("?status=withdrawn", ["withdrawn"]),
        ("?status=pending&subject=product", ["b_product", "a_product"]),
        ("?status=pending&subject=brand_profile", ["profile_pending"]),
        ("?status=all&subject=brand_profile", ["profile_pending", "profile_approved"]),
    ],
)
async def test_the_queue_filters_by_status_and_subject(
    tenants: Tenants, queue_world: dict[str, Review], query: str, expected: list[str]
) -> None:
    got = ids(await get(tenants, query))
    assert sorted(got) == sorted(str(queue_world[name].id) for name in expected)


async def test_the_queue_filters_by_vendor(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    b_only = await get(tenants, f"?status=all&vendor_id={tenants.b.vendor.id}")
    assert sorted(ids(b_only)) == sorted(
        str(queue_world[name].id) for name in ("b_product", "withdrawn")
    )
    nobody = await get(tenants, f"?status=all&vendor_id={uuid.uuid4()}")
    assert ids(nobody) == [] and nobody.json()["total"] == 0


async def test_other_statuses_and_all_come_newest_first(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    got = ids(await get(tenants, "?status=all"))
    assert got == [
        str(queue_world[name].id)
        for name in (
            "a_product",
            "withdrawn",
            "b_product",
            "rejected",
            "profile_pending",
            "profile_approved",
        )
    ]


async def test_the_queue_is_paged_with_a_total(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    first = await get(tenants, "?limit=2")
    rest = await get(tenants, "?limit=2&offset=2")
    body = first.json()
    assert (body["total"], body["limit"], body["offset"], len(body["items"])) == (3, 2, 0, 2)
    assert len(rest.json()["items"]) == 1
    assert ids(first) + ids(rest) == ids(await get(tenants))
    assert ids(await get(tenants, "?offset=50")) == []


@pytest.mark.parametrize(
    "query",
    [
        "?status=bogus",
        "?status=ALL",
        "?subject=vendor",
        "?vendor_id=not-a-uuid",
        "?limit=0",
        "?limit=101",
        "?offset=-1",
    ],
)
async def test_bad_filters_are_a_422(tenants: Tenants, query: str) -> None:
    response = await get(tenants, query)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_an_empty_queue_is_an_empty_page(tenants: Tenants) -> None:
    body = (await get(tenants)).json()
    assert body == {"items": [], "total": 0, "limit": 25, "offset": 0}


# --- One review: a brand profile ---------------------------------------------------------


async def test_a_first_submission_lists_every_field_with_a_value_and_has_no_base(
    tenants: Tenants, session: AsyncSession
) -> None:
    version = await profile(
        session, tenants.a, 1, "pending_review", tagline="Made slowly", price_min_paise=100
    )
    review = await profile_review(session, tenants.a, version, 1)
    response = await get(tenants, f"/{review.id}")
    assert response.json()["base"] is None
    assert [field for field, _, _ in changes(response)] == [
        "brand_name",
        "tagline",
        "categories",
        "price_min_paise",
        "price_max_paise",
    ]
    assert all(before is None for _, before, _ in changes(response))
    content = response.json()["content"]
    assert (content["version"], content["content"]["brand_name"]) == (1, "Acme")


async def test_the_diff_shows_exactly_the_fields_that_changed(
    tenants: Tenants, session: AsyncSession
) -> None:
    await profile(session, tenants.a, 1, "superseded", tagline="Old", categories=["kurtas"])
    await profile(
        session,
        tenants.a,
        2,
        "published",
        tagline="Old",
        categories=["kurtas"],
        about="About us",
        website_url="https://a.example",
    )
    pending = await profile(
        session,
        tenants.a,
        3,
        "pending_review",
        tagline="New tagline",
        categories=["kurtas", "sarees"],
        about="About us",
        website_url="https://a.example",
    )
    review = await profile_review(session, tenants.a, pending, 5)
    response = await get(tenants, f"/{review.id}")
    assert changes(response) == [
        ("tagline", "Old", "New tagline"),
        ("categories", ["kurtas"], ["kurtas", "sarees"]),
    ]
    body = response.json()
    assert body["base"]["version"] == 2 and body["content"]["version"] == 3
    assert body["base"]["content"]["about"] == body["content"]["content"]["about"] == "About us"


async def test_an_unchanged_resubmission_has_an_empty_diff(
    tenants: Tenants, session: AsyncSession
) -> None:
    await profile(session, tenants.a, 1, "published")
    pending = await profile(session, tenants.a, 2, "pending_review")
    review = await profile_review(session, tenants.a, pending, 3)
    response = await get(tenants, f"/{review.id}")
    assert changes(response) == [] and response.json()["base"]["version"] == 1


async def test_a_rejected_version_in_between_is_never_the_base(
    tenants: Tenants, session: AsyncSession
) -> None:
    await profile(session, tenants.a, 1, "published", tagline="Live")
    await profile(session, tenants.a, 2, "rejected", tagline="Rejected attempt")
    pending = await profile(session, tenants.a, 3, "pending_review", tagline="Third try")
    review = await profile_review(session, tenants.a, pending, 5)
    response = await get(tenants, f"/{review.id}")
    assert response.json()["base"]["version"] == 1
    assert changes(response) == [("tagline", "Live", "Third try")]


async def test_a_decided_review_is_still_shown_against_what_it_replaced(
    tenants: Tenants, session: AsyncSession
) -> None:
    await profile(session, tenants.a, 1, "superseded", tagline="Before")
    live = await profile(session, tenants.a, 2, "published", tagline="After")
    review = await profile_review(session, tenants.a, live, 3, **decision("approved", 4))
    response = await get(tenants, f"/{review.id}")
    assert response.json()["base"]["version"] == 1
    assert changes(response) == [("tagline", "Before", "After")]
    assert response.json()["status"] == "approved"


async def test_a_new_logo_is_shown_as_the_asset_and_its_url(
    tenants: Tenants, session: AsyncSession
) -> None:
    old = await saved_asset(session, tenants.a.vendor, tenants.a.owner, public_id="a/logo-old")
    new = await saved_asset(session, tenants.a.vendor, tenants.a.owner, public_id="a/logo-new")
    await profile(session, tenants.a, 1, "published", logo_asset_id=old.id)
    pending = await profile(session, tenants.a, 2, "pending_review", logo_asset_id=new.id)
    review = await profile_review(session, tenants.a, pending, 3)
    assert changes(await get(tenants, f"/{review.id}")) == [
        (
            "logo",
            {"asset_id": str(old.id), "url": old.url},
            {"asset_id": str(new.id), "url": new.url},
        )
    ]


# --- One review: a product ---------------------------------------------------------------


async def test_a_product_review_shows_what_changed_in_the_details_variants_and_images(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, first, second = await two_revisions(session, tenants.a)
    review = await product_review(session, tenants.a, second, 3)
    response = await get(tenants, f"/{review.id}")
    got = changes(response)
    assert [field for field, _, _ in got] == [
        "title",
        "variants[KURTA-01-L]",
        "variants[KURTA-01-M].price_paise",
        "images[1]",
    ]
    assert got[0][1:] == ("Block-print kurta", "Block-print kurta (new cut)")
    assert got[1][1] is None and got[1][2]["size"] == "L"
    assert got[2][1:] == (99_900, 89_900)
    assert got[3][1]["asset_id"] != got[3][2]["asset_id"]
    body = response.json()
    assert (body["base"]["version"], body["content"]["version"]) == (1, 2)
    assert body["sku"] == "KURTA-01" and body["subject"] == "product"
    assert [v["sku"] for v in body["content"]["content"]["variants"]] == [
        "KURTA-01-L",
        "KURTA-01-M",
    ]
    assert [v["sku"] for v in body["base"]["content"]["variants"]] == ["KURTA-01-M"]


async def test_a_first_product_submission_has_no_base(
    tenants: Tenants, session: AsyncSession
) -> None:
    product, revision = await submitted_product(session, tenants.a, "NEW-1", 1)
    product.pending_revision_id = revision.id
    product.status = "pending_review"
    await session.flush()
    review = await product_review(session, tenants.a, revision, 2)
    response = await get(tenants, f"/{review.id}")
    assert response.json()["base"] is None
    assert [field for field, _, _ in changes(response)] == [
        "title",
        "category",
        "gender",
        "returnable",
        "variants[NEW-1-M]",
        "images[1]",
    ]


async def test_an_approved_revision_is_shown_against_the_one_approved_before_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    product, first, second = await two_revisions(session, tenants.a)
    await product_review(session, tenants.a, first, 1.5, **decision("approved", 1.8))
    review = await product_review(session, tenants.a, second, 3, **decision("approved", 4))
    product.live_revision_id = second.id  # the approval made it live
    await session.flush()
    response = await get(tenants, f"/{review.id}")
    assert response.json()["base"]["version"] == 1
    assert "title" in [field for field, _, _ in changes(response)]


async def test_a_revision_is_never_compared_with_a_newer_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    product, first, second = await two_revisions(session, tenants.a)
    product.live_revision_id = second.id  # revision 2 is live; revision 1 has no approval on record
    await session.flush()
    review = await product_review(session, tenants.a, first, 1)
    response = await get(tenants, f"/{review.id}")
    assert response.json()["base"] is None  # nothing older than revision 1


# --- One review: the rest of the answer --------------------------------------------------


async def test_the_audit_trail_comes_with_the_review_in_order(
    tenants: Tenants, session: AsyncSession
) -> None:
    pending = await profile(session, tenants.a, 1, "pending_review")
    review = await profile_review(session, tenants.a, pending, 1)
    reviewer = uuid.uuid4()
    session.add_all(
        [
            ReviewEvent(
                review_id=review.id,
                action="submitted",
                actor_type="vendor",
                actor_id=tenants.a.owner.id,
            ),
            ReviewEvent(
                review_id=review.id,
                action="rejected",
                actor_type="admin",
                actor_id=reviewer,
                reason="Needs a logo",
            ),
        ]
    )
    await session.flush()
    events = (await get(tenants, f"/{review.id}")).json()["events"]
    assert [(e["action"], e["actor_type"], e["reason"]) for e in events] == [
        ("submitted", "vendor", None),
        ("rejected", "admin", "Needs a logo"),
    ]
    assert events[1]["actor_id"] == str(reviewer) and events[1]["created_at"]


async def test_a_review_without_events_has_an_empty_trail(
    tenants: Tenants, session: AsyncSession
) -> None:
    pending = await profile(session, tenants.a, 1, "pending_review")
    review = await profile_review(session, tenants.a, pending, 1)
    assert (await get(tenants, f"/{review.id}")).json()["events"] == []


async def test_the_detail_carries_the_same_summary_as_the_queue(
    tenants: Tenants, queue_world: dict[str, Review]
) -> None:
    listed = {i["id"]: i for i in (await get(tenants, "?status=all")).json()["items"]}
    for review in queue_world.values():
        detail = (await get(tenants, f"/{review.id}")).json()
        summary = listed[str(review.id)]
        assert {k: detail[k] for k in summary} == summary


async def test_an_unknown_review_is_a_404_and_a_bad_id_a_422(tenants: Tenants) -> None:
    missing = await get(tenants, f"/{uuid.uuid4()}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "review_not_found"
    assert (await get(tenants, "/not-a-uuid")).status_code == 422


async def test_reading_the_queue_changes_nothing(
    tenants: Tenants, session: AsyncSession, queue_world: dict[str, Review]
) -> None:
    async def counts() -> tuple[int, int, str]:
        reviews = await session.scalar(select(func.count()).select_from(Review))
        events = await session.scalar(select(func.count()).select_from(ReviewEvent))
        states = await session.scalars(select(Review.status).order_by(Review.id))
        return reviews or 0, events or 0, ",".join(states)

    before = await counts()
    for review in queue_world.values():
        await get(tenants, f"/{review.id}")
    await get(tenants, "?status=all")
    assert await counts() == before
