"""The admin review queue: one list of everything waiting for a reviewer, over HTTP (#294).

Products, brand pages and vendor applications come from three tables, so the list is built in
the database (a union) and sorted, filtered and paged there. Rows are built straight in the
tables with the factories: the endpoint only reads.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from factories import (
    saved_asset,
    saved_image,
    saved_review,
    saved_vendor,
    submittable_revision,
)
from review_builders import (
    at,
    decision,
    product_review,
    profile,
    profile_review,
    submitted_product,
    two_revisions,
)
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import Product, ProductRevision, Review

QUEUE = "/v1/admin/queue"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, query: str = "", token: str | None = None) -> httpx.Response:
    return await tenants.api.http.get(QUEUE + query, headers=bearer(token or tenants.admin_token))


async def page(tenants: Tenants, query: str = "") -> dict[str, Any]:
    response = await get(tenants, query)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(autouse=True)
async def approved_tenants(tenants: Tenants, session: AsyncSession) -> None:
    """Reviews come from approved vendors; a pending vendor would show up as an application."""
    for tenant in (tenants.a, tenants.b):
        tenant.vendor.status = "approved"
    await session.flush()


def titles(body: dict[str, Any]) -> list[str]:
    return [item["title"] for item in body["items"]]


async def application(session: AsyncSession, slug: str, hours: float = 0, **changes: Any) -> Any:
    """A vendor that applied and waits for a decision."""
    vendor = await saved_vendor(
        session,
        slug=slug,
        email=f"{slug}@apply.test",
        name=changes.pop("name", slug.title()),
        status="pending",
        **changes,
    )
    vendor.created_at = at(hours) if hours else vendor.created_at
    await session.flush()
    return vendor


async def waiting_product(
    session: AsyncSession,
    tenant: Tenant,
    sku: str,
    *,
    hours: float | None = None,
    when: float | None = None,
    title: str | None = None,
    extra_photo: bool = False,
) -> tuple[Product, ProductRevision, Review]:
    """A product revision (one variant, a photo) submitted for review.

    A submitted revision cannot be edited, so its title and photos are set before the
    submission. The review's time is `when` hours after `T0`, or `hours` ago."""
    product, revision = await submittable_revision(session, tenant.vendor, tenant.owner, sku)
    if title:
        revision.title = title
    if extra_photo:
        asset = await saved_asset(
            session,
            tenant.vendor,
            tenant.owner,
            public_id=f"shazlo/{sku}-extra",
            kind="product_image",
        )
        await saved_image(session, revision, asset, position=2)
    revision.submitted_at = at(when or 0)
    await session.flush()
    submitted = datetime.now(UTC) - timedelta(hours=hours) if hours is not None else at(when or 0)
    review = await saved_review(
        session, tenant.vendor, tenant.owner, revision=revision, submitted_at=submitted
    )
    return product, revision, review


# --- What the list holds -------------------------------------------------------


async def test_an_empty_queue_is_an_empty_page(tenants: Tenants) -> None:
    body = await page(tenants)
    assert body["items"] == []
    assert body["total"] == 0
    assert body["counts"] == {"all": 0, "product": 0, "brand_page": 0, "application": 0}
    assert body["vendors"] == []


async def test_products_brand_pages_and_applications_share_one_list_oldest_first(
    tenants: Tenants, session: AsyncSession
) -> None:
    pending_profile = await profile(session, tenants.a, 1, "pending_review", brand_name="Aarav")
    await profile_review(session, tenants.a, pending_profile, 2)
    _, revision = await submitted_product(session, tenants.b, "B-1", 1)
    await product_review(session, tenants.b, revision, 1)
    await application(session, "applicant", 3)

    body = await page(tenants)

    assert [i["kind"] for i in body["items"]] == ["product", "brand_page", "application"]
    assert body["total"] == 3
    assert body["counts"] == {"all": 3, "product": 1, "brand_page": 1, "application": 1}


async def test_only_what_is_waiting_is_listed(tenants: Tenants, session: AsyncSession) -> None:
    _, pending = await submitted_product(session, tenants.a, "A-1", 1)
    _, approved = await submitted_product(session, tenants.a, "A-2", 2)
    _, rejected = await submitted_product(session, tenants.a, "A-3", 3)
    _, withdrawn = await submitted_product(session, tenants.a, "A-4", 4)
    waiting = await product_review(session, tenants.a, pending, 1)
    await product_review(session, tenants.a, approved, 2, **decision("approved", 3))
    await product_review(session, tenants.a, rejected, 3, **decision("rejected", 4))
    await product_review(session, tenants.a, withdrawn, 4, status="withdrawn", decided_at=at(5))
    for slug, status in (("ok", "approved"), ("no", "rejected"), ("out", "suspended")):
        await saved_vendor(session, slug=slug, email=f"{slug}@x.test", status=status)

    body = await page(tenants)

    assert [i["id"] for i in body["items"]] == [str(waiting.id)]
    assert body["counts"]["all"] == 1


# --- The shape of one item -----------------------------------------------------


async def test_a_new_product_item(tenants: Tenants, session: AsyncSession) -> None:
    product, revision = await submitted_product(session, tenants.a, "KURTA-9", 5)
    review = await product_review(session, tenants.a, revision, 5)

    (item,) = (await page(tenants))["items"]

    assert item == {
        "id": str(review.id),
        "kind": "product",
        "subject_id": str(product.id),
        "title": revision.title,
        "detail": "KURTA-9",
        "vendor": {"id": str(tenants.a.vendor.id), "name": tenants.a.vendor.name},
        "submitted_at": item["submitted_at"],
        "change": "new",
        "resubmission": 0,
        "thumbnail_url": "https://res.cloudinary.test/shazlo/KURTA-9-1.png",
    }
    assert datetime.fromisoformat(item["submitted_at"]) == at(5)


async def test_a_change_to_a_live_product_is_an_edit_with_its_first_photo(
    tenants: Tenants, session: AsyncSession
) -> None:
    product, _, second = await two_revisions(session, tenants.a, "KURTA-2")
    await product_review(session, tenants.a, second, 2)

    (item,) = (await page(tenants))["items"]

    assert item["change"] == "edit"
    assert item["subject_id"] == str(product.id)
    # Revision 2's photo, not the live revision's.
    assert item["thumbnail_url"] == "https://res.cloudinary.test/shazlo/KURTA-2-2.png"


async def test_the_first_photo_is_the_one_in_position_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    await waiting_product(session, tenants.a, "A-1", when=1, extra_photo=True)

    (item,) = (await page(tenants))["items"]

    assert item["thumbnail_url"] == "https://res.cloudinary.test/shazlo/A-1-1.png"


async def test_a_first_brand_page_is_new_and_a_change_to_a_published_one_is_an_edit(
    tenants: Tenants, session: AsyncSession
) -> None:
    first = await profile(session, tenants.a, 1, "pending_review", brand_name="Aarav")
    await profile_review(session, tenants.a, first, 1)
    await profile(session, tenants.b, 1, "published", brand_name="Bela")
    edit = await profile(session, tenants.b, 2, "pending_review", brand_name="Bela")
    await profile_review(session, tenants.b, edit, 2)

    body = await page(tenants)
    by_vendor = {i["vendor"]["id"]: i for i in body["items"]}

    new_item = by_vendor[str(tenants.a.vendor.id)]
    edit_item = by_vendor[str(tenants.b.vendor.id)]
    assert (new_item["kind"], new_item["change"]) == ("brand_page", "new")
    assert (edit_item["kind"], edit_item["change"]) == ("brand_page", "edit")
    # A brand page is reviewed per vendor: its subject is the vendor.
    assert new_item["subject_id"] == str(tenants.a.vendor.id)
    assert new_item["title"] == "Aarav brand page"
    assert new_item["detail"] == "First brand page"
    assert edit_item["detail"] == "Edit to a live page"


async def test_a_brand_page_shows_its_banner_else_its_logo(
    tenants: Tenants, session: AsyncSession
) -> None:
    logo = await saved_asset(
        session, tenants.a.vendor, tenants.a.owner, public_id="shazlo/logo-a", kind="brand_logo"
    )
    banner = await saved_asset(
        session, tenants.b.vendor, tenants.b.owner, public_id="shazlo/banner-b", kind="brand_banner"
    )
    only_logo = await profile(session, tenants.a, 1, "pending_review", logo_asset_id=logo.id)
    both = await profile(
        session, tenants.b, 1, "pending_review", logo_asset_id=None, banner_asset_id=banner.id
    )
    await profile_review(session, tenants.a, only_logo, 1)
    await profile_review(session, tenants.b, both, 2)

    items = (await page(tenants))["items"]

    assert [i["thumbnail_url"] for i in items] == [
        "https://res.cloudinary.test/shazlo/logo-a.png",
        "https://res.cloudinary.test/shazlo/banner-b.png",
    ]


async def test_an_application_item(tenants: Tenants, session: AsyncSession) -> None:
    vendor = await application(session, "kala", 1, name="Kala House", product_type="kurtas")

    (item,) = (await page(tenants))["items"]

    assert item["id"] == str(vendor.id)
    assert item["kind"] == "application"
    assert item["subject_id"] == str(vendor.id)
    assert item["title"] == "Kala House"
    assert item["detail"] == "Vendor application · kurtas"
    assert item["vendor"] == {"id": str(vendor.id), "name": "Kala House"}
    assert item["change"] == "application"
    assert item["resubmission"] == 0
    assert item["thumbnail_url"] is None
    assert datetime.fromisoformat(item["submitted_at"]) == vendor.created_at


async def test_resubmission_counts_the_times_it_was_sent_back_before(
    tenants: Tenants, session: AsyncSession
) -> None:
    product, first, second = await two_revisions(session, tenants.a, "A-1")
    await product_review(session, tenants.a, first, 0.2, **decision("rejected", 0.4))
    await product_review(session, tenants.a, first, 0.6, **decision("rejected", 0.8))
    # Another product's rejection is not this product's.
    _, other = await submitted_product(session, tenants.b, "B-1", 0.1)
    await product_review(session, tenants.b, other, 0.1, **decision("rejected", 0.3))
    await product_review(session, tenants.a, second, 2)

    (item,) = (await page(tenants))["items"]

    assert item["resubmission"] == 2


async def test_a_brand_page_counts_its_own_vendors_rejections(
    tenants: Tenants, session: AsyncSession
) -> None:
    rejected = await profile(session, tenants.a, 1, "rejected")
    await profile_review(session, tenants.a, rejected, 1, **decision("rejected", 1.5))
    again = await profile(session, tenants.a, 2, "pending_review")
    await profile_review(session, tenants.a, again, 3)
    fresh = await profile(session, tenants.b, 1, "pending_review")
    await profile_review(session, tenants.b, fresh, 4)

    by_vendor = {i["vendor"]["id"]: i for i in (await page(tenants))["items"]}

    assert by_vendor[str(tenants.a.vendor.id)]["resubmission"] == 1
    assert by_vendor[str(tenants.b.vendor.id)]["resubmission"] == 0


# --- Filters and order ---------------------------------------------------------


@pytest.fixture
async def mixed(tenants: Tenants, session: AsyncSession) -> dict[str, str]:
    """Four items: A's product (oldest), B's brand page, B's product, an application (newest)."""
    _, _, a_review = await waiting_product(
        session, tenants.a, "A-SHIRT", when=1, title="Linen shirt"
    )
    brand = await profile(session, tenants.b, 1, "pending_review", brand_name="Bela Studio")
    b_brand = await profile_review(session, tenants.b, brand, 2)
    _, _, b_review = await waiting_product(
        session, tenants.b, "B-KURTA", when=3, title="Block-print kurta"
    )
    apply = await application(session, "newcomer", 4, name="Newcomer Textiles")
    return {
        "a_product": str(a_review.id),
        "b_brand": str(b_brand.id),
        "b_product": str(b_review.id),
        "application": str(apply.id),
    }


async def test_kind_narrows_the_list_but_not_the_tab_counts(
    tenants: Tenants, mixed: dict[str, str]
) -> None:
    body = await page(tenants, "?kind=product")

    assert [i["id"] for i in body["items"]] == [mixed["a_product"], mixed["b_product"]]
    assert body["total"] == 2
    assert body["counts"] == {"all": 4, "product": 2, "brand_page": 1, "application": 1}


async def test_vendor_narrows_the_list(tenants: Tenants, mixed: dict[str, str]) -> None:
    body = await page(tenants, f"?vendor={tenants.b.vendor.id}")

    assert [i["id"] for i in body["items"]] == [mixed["b_brand"], mixed["b_product"]]


async def test_q_matches_the_title_the_detail_and_the_vendor_name_ignoring_case(
    tenants: Tenants, mixed: dict[str, str]
) -> None:
    by_title = await page(tenants, "?q=LINEN")
    by_sku = await page(tenants, "?q=b-kurta")
    by_vendor = await page(tenants, f"?q={tenants.a.vendor.name.upper()}")
    by_application = await page(tenants, "?q=newcomer")

    assert [i["id"] for i in by_title["items"]] == [mixed["a_product"]]
    assert [i["id"] for i in by_sku["items"]] == [mixed["b_product"]]
    assert mixed["a_product"] in [i["id"] for i in by_vendor["items"]]
    assert [i["id"] for i in by_application["items"]] == [mixed["application"]]


async def test_q_treats_wildcards_as_text(tenants: Tenants, mixed: dict[str, str]) -> None:
    for text in ("%25", "_", "%25%25", "a%5C"):
        assert (await page(tenants, f"?q={text}"))["items"] == []


async def test_vendors_lists_who_has_something_waiting_whatever_the_filters(
    tenants: Tenants, mixed: dict[str, str]
) -> None:
    body = await page(tenants, "?kind=application")

    names = [v["name"] for v in body["vendors"]]
    assert names == sorted(names, key=str.lower)
    assert len(body["vendors"]) == 3
    assert {v["id"] for v in body["vendors"]} >= {
        str(tenants.a.vendor.id),
        str(tenants.b.vendor.id),
    }


async def test_submitted_buckets(tenants: Tenants, session: AsyncSession) -> None:
    reviews: dict[str, Review] = {}
    for label, hours in (("fresh", 2), ("yesterday", 30), ("old", 100)):
        *_, reviews[label] = await waiting_product(session, tenants.a, label.upper(), hours=hours)

    async def listed(bucket: str) -> list[str]:
        return [i["id"] for i in (await page(tenants, f"?submitted={bucket}"))["items"]]

    assert await listed("today") == [str(reviews["fresh"].id)]
    assert await listed("24h") == [str(reviews["yesterday"].id)]
    assert await listed("older") == [str(reviews["old"].id)]


async def test_resubmissions_only(tenants: Tenants, session: AsyncSession) -> None:
    _, first, second = await two_revisions(session, tenants.a, "A-1")
    await product_review(session, tenants.a, first, 0.2, **decision("rejected", 0.4))
    sent_back = await product_review(session, tenants.a, second, 2)
    _, fresh = await submitted_product(session, tenants.b, "B-1", 3)
    await product_review(session, tenants.b, fresh, 3)

    only = await page(tenants, "?resubmissions=true")
    everything = await page(tenants, "?resubmissions=false")

    assert [i["id"] for i in only["items"]] == [str(sent_back.id)]
    assert only["counts"]["all"] == 2
    assert everything["total"] == 2


async def test_newest_first_reverses_the_oldest_first_default(
    tenants: Tenants, mixed: dict[str, str]
) -> None:
    oldest = (await page(tenants))["items"]
    newest = (await page(tenants, "?sort=newest"))["items"]
    explicit = (await page(tenants, "?sort=oldest"))["items"]

    assert [i["id"] for i in oldest] == [
        mixed["a_product"],
        mixed["b_brand"],
        mixed["b_product"],
        mixed["application"],
    ]
    assert newest == oldest[::-1]
    assert explicit == oldest


async def test_items_submitted_together_keep_a_stable_order(
    tenants: Tenants, session: AsyncSession
) -> None:
    for sku in ("T-1", "T-2", "T-3", "T-4", "T-5"):
        _, revision = await submitted_product(session, tenants.a, sku, 1)
        await product_review(session, tenants.a, revision, 1)

    seen: list[str] = []
    for offset in range(5):
        body = await page(tenants, f"?limit=1&offset={offset}")
        seen += [i["id"] for i in body["items"]]

    assert len(set(seen)) == 5
    full = [i["id"] for i in (await page(tenants))["items"]]
    assert seen == full


# --- Paging --------------------------------------------------------------------


async def test_paging_walks_every_item_once_and_total_is_the_filtered_count(
    tenants: Tenants, session: AsyncSession
) -> None:
    for number in range(7):
        _, revision = await submitted_product(session, tenants.a, f"P-{number}", number)
        await product_review(session, tenants.a, revision, number)

    first = await page(tenants, "?limit=3")
    second = await page(tenants, "?limit=3&offset=3")
    last = await page(tenants, "?limit=3&offset=6")
    past_end = await page(tenants, "?limit=3&offset=60")

    assert (first["total"], first["limit"], first["offset"]) == (7, 3, 0)
    assert [len(p["items"]) for p in (first, second, last, past_end)] == [3, 3, 1, 0]
    ids = [i["id"] for p in (first, second, last) for i in p["items"]]
    assert len(set(ids)) == 7
    assert past_end["total"] == 7
    assert past_end["counts"]["all"] == 7


async def test_the_default_page_is_fifty(tenants: Tenants) -> None:
    body = await page(tenants)
    assert (body["limit"], body["offset"]) == (50, 0)


async def test_a_thousand_waiting_items_page_and_count(
    tenants: Tenants, session: AsyncSession
) -> None:
    for number in range(1000):
        await application(session, f"bulk-{number}", number)
    session.expire_all()

    body = await page(tenants, "?limit=100&offset=950")

    assert body["total"] == 1000
    assert body["counts"]["application"] == 1000
    assert len(body["items"]) == 50
    assert len(body["vendors"]) == 1000


# --- Bad requests and who may ask ----------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        "?kind=order",
        "?submitted=yesterday",
        "?sort=random",
        "?resubmissions=maybe",
        "?vendor=not-a-uuid",
        "?limit=0",
        "?limit=101",
        "?offset=-1",
        "?offset=100001",
        "?q=" + "x" * 201,
    ],
)
async def test_a_bad_filter_is_a_422(tenants: Tenants, query: str) -> None:
    assert (await get(tenants, query)).status_code == 422


async def test_unknown_filters_are_ignored(tenants: Tenants, mixed: dict[str, str]) -> None:
    assert (await page(tenants, "?colour=red"))["total"] == 4


async def test_the_queue_needs_a_token(tenants: Tenants) -> None:
    response = await tenants.api.http.get(QUEUE)
    assert response.status_code == 401
    assert response.json()["error"]["code"]


async def test_a_vendor_token_is_refused(tenants: Tenants) -> None:
    response = await get(tenants, token=tenants.a.owner_token)
    assert response.status_code in {401, 403}


async def test_a_token_without_the_reviewer_role_is_a_403(tenants: Tenants) -> None:
    token = tenants.identity.token(["vendor_viewer"])
    assert (await get(tenants, token=token)).status_code == 403


async def test_a_super_admin_may_read_the_queue(tenants: Tenants) -> None:
    token = tenants.identity.token(["super_admin"])
    assert (await get(tenants, token=token)).status_code == 200


async def test_the_answer_is_not_cached(tenants: Tenants) -> None:
    response = await get(tenants)
    assert "no-store" in response.headers["cache-control"]


# --- Things that change while the list is open ---------------------------------


async def test_a_review_decided_meanwhile_leaves_the_next_read(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, revision = await submitted_product(session, tenants.a, "A-1", 1)
    review = await product_review(session, tenants.a, revision, 1)
    assert (await page(tenants))["total"] == 1

    review.status = "approved"
    review.reviewer_id = uuid.uuid4()
    review.decided_at = at(2)
    await session.flush()

    body = await page(tenants)
    assert body["total"] == 0
    assert body["counts"]["all"] == 0


async def test_a_vendor_suspended_mid_review_still_lists_its_waiting_product(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, revision = await submitted_product(session, tenants.a, "A-1", 1)
    await product_review(session, tenants.a, revision, 1)
    tenants.a.vendor.status = "suspended"
    await session.flush()

    (item,) = (await page(tenants))["items"]

    # The review is still waiting and still a decision for a reviewer: the vendor's status
    # shows on the vendor page, not as a hole in the queue.
    assert item["vendor"]["id"] == str(tenants.a.vendor.id)
