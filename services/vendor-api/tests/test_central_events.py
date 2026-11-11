"""The event builders (ADR 0003): full-state payloads that match the contract.

Most tests build the rows in memory (nothing is saved), so they run without a database; the
loaders at the end read real rows and need one.
"""

import json
import uuid
from copy import deepcopy
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from factories import (
    make_asset,
    make_image,
    make_profile,
    make_revision,
    make_revision_variant,
    make_user,
    make_vendor,
)
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import ProductVariant, VendorStatus
from vendor_api.services.central_contract import MAX_BODY_BYTES, InvalidEvent, contract
from vendor_api.services.central_events import (
    BrandSnapshot,
    EventBuildError,
    EventTooLarge,
    ProductSnapshot,
    brand_profile_published,
    brand_profile_unpublished,
    iso,
    load_brand_snapshot,
    load_product_snapshot,
    product_published,
    product_unpublished,
    vendor_status_changed,
    vendor_status_version,
)

EXAMPLES = Path(__file__).resolve().parents[3] / "docs" / "adr" / "0003-contract" / "examples"
VENDOR_ID = uuid.UUID("3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10")
PRODUCT_ID = uuid.UUID("9b6e2d7a-41f3-4c58-8d0a-6e1f3b7c2a55")
T = datetime(2026, 10, 23, 10, 15, tzinfo=UTC)
FORBIDDEN = {
    "stock",
    "stock_quantity",
    "inventory",
    "quantity",
    "phone",
    "contact_phone",
    "contact_name",
    "email",
    "contact_email",
    "owner_name",
    "address",
    "password",
    "status_changed_by",
}


def example(name: str) -> dict[str, Any]:
    event: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))
    return event


def when(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def ids(**fixed: str) -> dict[str, Any]:
    return {"event_id": uuid.UUID(fixed["event_id"]), "occurred_at": when(fixed["occurred_at"])}


# --- rows, in memory ------------------------------------------------------------


def a_vendor() -> Any:
    vendor = make_vendor(slug="indigo-lane", email="owner@indigo-lane.test")
    vendor.id = VENDOR_ID
    vendor.phone, vendor.contact_name = "+919999999999", "Asha Owner"
    return vendor


def a_brand(**changes: Any) -> BrandSnapshot:
    vendor = a_vendor()
    owner = make_user(vendor)
    owner.id = uuid.uuid4()
    logo = make_asset(vendor, owner, "vendors/indigo-lane/logo", kind="brand_logo")
    logo.url = "https://res.cloudinary.com/shazlo/image/upload/v1/vendors/indigo-lane/logo.png"
    banner = make_asset(vendor, owner, "vendors/indigo-lane/banner", kind="brand_banner")
    banner.url = "https://res.cloudinary.com/shazlo/image/upload/v1/vendors/indigo-lane/banner.jpg"
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "version": 3,
        "state": "published",
        "brand_name": "Indigo Lane",
        "tagline": "Handloom everyday wear from Ahmedabad",
        "about": "A small label making hand-block printed kurtis and co-ords.",
        "website_url": "https://indigolane.example",
        "instagram_handle": "indigo.lane",
        "categories": ["Kurtis", "Co-ords"],
        "price_min_paise": 79_900,
        "price_max_paise": 299_900,
        "published_at": T,
    }
    profile = make_profile(vendor, **{**values, **changes})
    return BrandSnapshot(vendor, profile, logo, banner)


def a_product(**changes: Any) -> ProductSnapshot:
    vendor = a_vendor()
    owner = make_user(vendor)
    owner.id = uuid.uuid4()
    from factories import make_product

    product = make_product(vendor, "IL-KRT-001", id=PRODUCT_ID, version=2, status="approved")
    content: dict[str, Any] = {
        "id": uuid.uuid4(),
        "title": "Block print cotton kurti",
        "description": "Hand-block printed cotton kurti with a relaxed fit.",
        "category": "Kurtis",
        "subcategory": "Straight",
        "gender": "women",
        "fabric": "Cotton",
        "weight_grams": 350,
        "returnable": True,
        "return_window_days": 7,
    }
    revision = make_revision(product, owner, 2, **{**content, **changes})
    product.live_revision_id = revision.id
    variants = []
    for variant_id, sku, size in (
        ("7a2b9e14-3c5d-4f60-b8e1-9d4a6c0f2e83", "IL-KRT-001-L", "L"),
        ("5d1a7c30-8e42-4b9f-a6d3-0c2e8f4b9a71", "IL-KRT-001-M", "M"),
    ):  # deliberately not in SKU order: the builder sorts
        variant = ProductVariant(
            id=uuid.UUID(variant_id),
            product_id=PRODUCT_ID,
            vendor_id=VENDOR_ID,
            sku=sku,
            size=size,
            color="Indigo",
        )
        variant.sku_key = sku.lower()  # a database-computed column
        variant.created_at = T + timedelta(minutes=0 if size == "M" else 1)  # M was made first
        offer = make_revision_variant(
            revision, variant, price_paise=129_900, mrp_paise=159_900, is_active=True
        )
        variants.append((variant, offer))
    images = []
    for position, name, alt in ((3, "detail", None), (1, "front", "Front"), (2, "back", "Back")):
        asset = make_asset(
            vendor, owner, f"vendors/indigo-lane/krt-001-{name}", kind="product_image"
        )
        asset.url = f"https://res.cloudinary.com/shazlo/image/upload/v1/vendors/indigo-lane/krt-001-{name}.jpg"
        images.append((make_image(revision, asset, position, alt_text=alt, id=uuid.uuid4()), asset))
    return ProductSnapshot(product, revision, variants, images)


# --- the contract's examples are reproduced from fixtures -------------------------------------


def test_the_brand_profile_published_example_is_reproduced() -> None:
    expected = example("brand_profile.published")
    built = brand_profile_published(
        a_brand(published_at=when("2026-10-23T10:15:00Z")), **ids(**expected)
    )
    assert built.envelope() == expected


def test_the_product_published_example_is_reproduced() -> None:
    expected = example("product.published")
    snapshot = a_product()
    built = product_published(
        snapshot, published_at=when("2026-10-23T11:30:00Z"), **ids(**expected)
    )
    assert built.envelope() == expected


def test_the_brand_profile_unpublished_example_is_reproduced() -> None:
    expected = example("brand_profile.unpublished")
    built = brand_profile_unpublished(
        VENDOR_ID,
        version=4,
        last_published_version=3,
        reason="vendor_suspended",
        unpublished_at=when("2026-10-24T08:00:00Z"),
        **ids(**expected),
    )
    assert built.envelope() == expected


def test_the_product_unpublished_example_is_reproduced() -> None:
    expected = example("product.unpublished")
    payload = expected["payload"]
    built = product_unpublished(
        uuid.UUID(payload["product_id"]),
        uuid.UUID(payload["vendor_id"]),
        version=expected["version"],
        last_published_version=expected["version"] - 1,
        reason=payload["reason"],
        unpublished_at=when(payload["unpublished_at"]),
        **ids(**expected),
    )
    assert built.envelope() == expected


def test_the_vendor_status_changed_example_is_reproduced() -> None:
    expected = example("vendor.status_changed")
    payload = expected["payload"]
    built = vendor_status_changed(
        uuid.UUID(payload["vendor_id"]),
        status=payload["status"],
        reason=payload["reason"],
        changed_at=when(payload["changed_at"]),
        version=expected["version"],
        **ids(**expected),
    )
    assert built.envelope() == expected


def test_the_example_bytes_of_the_readme_are_reproduced() -> None:
    # The test vector's body (371 bytes) is exactly what the builder serialises.
    expected = example("brand_profile.unpublished")
    built = brand_profile_unpublished(
        VENDOR_ID,
        version=4,
        last_published_version=3,
        reason="vendor_suspended",
        unpublished_at=when("2026-10-24T08:00:00Z"),
        **ids(**expected),
    )
    assert len(built.body()) == 371
    assert json.loads(built.body()) == expected


# --- full state, valid against the schemas ----------------------------------------------------


def test_the_brand_page_carries_the_whole_page() -> None:
    event = brand_profile_published(a_brand()).envelope()
    contract().validate(event)
    assert event["aggregate"] == {"type": "brand_profile", "id": str(VENDOR_ID)}
    assert event["version"] == 3
    assert event["payload"]["slug"] == "indigo-lane"
    assert event["payload"]["price_range"] == {"min_paise": 79_900, "max_paise": 299_900}


def test_a_brand_page_without_images_or_extras_leaves_them_out() -> None:
    snapshot = a_brand(tagline=None, about=None, website_url=None, instagram_handle=None)
    bare = BrandSnapshot(snapshot.vendor, snapshot.profile, None, None)
    payload = brand_profile_published(bare).payload
    for left_out in (
        "tagline",
        "about",
        "logo_url",
        "banner_url",
        "website_url",
        "instagram_handle",
    ):
        assert left_out not in payload
    contract().validate(brand_profile_published(bare).envelope())


def test_the_product_carries_variants_and_images_in_order() -> None:
    payload = product_published(a_product(), published_at=T).payload
    # In the order the vendor created them (M first), whatever order the rows were read in.
    assert [v["sku"] for v in payload["variants"]] == ["IL-KRT-001-M", "IL-KRT-001-L"]
    assert [i["position"] for i in payload["images"]] == [1, 2, 3]
    assert "alt" not in payload["images"][2]
    assert all(isinstance(v["price_paise"], int) for v in payload["variants"])


def test_a_variant_that_is_not_offered_is_left_out() -> None:
    snapshot = a_product()
    snapshot.variants[0][1].is_active = False
    payload = product_published(snapshot, published_at=T).payload
    assert [v["sku"] for v in payload["variants"]] == ["IL-KRT-001-M"]


def test_an_empty_size_or_colour_is_left_out() -> None:
    snapshot = a_product()
    snapshot.variants[0][0].size = ""
    snapshot.variants[0][0].color = ""
    variants = product_published(snapshot, published_at=T).payload["variants"]
    first = next(v for v in variants if v["sku"] == "IL-KRT-001-L")
    assert "size" not in first and "color" not in first


def test_a_product_with_nothing_offered_is_refused() -> None:
    snapshot = a_product()
    for _, offer in snapshot.variants:
        offer.is_active = False
    with pytest.raises(InvalidEvent):  # the contract wants at least one variant
        product_published(snapshot, published_at=T)


def test_a_product_that_may_not_be_returned_has_no_window() -> None:
    snapshot = a_product(returnable=False, return_window_days=None)
    payload = product_published(snapshot, published_at=T).payload
    assert payload["returnable"] is False
    assert "return_window_days" not in payload


def test_there_are_no_other_vendors_variants_or_assets() -> None:
    snapshot = a_product()
    snapshot.images[0][1].vendor_id = uuid.uuid4()
    with pytest.raises(EventBuildError, match="ready file of the vendor"):
        product_published(snapshot, published_at=T)


def test_an_image_that_is_not_ready_is_refused() -> None:
    snapshot = a_product()
    snapshot.images[0][1].status = "pending"
    with pytest.raises(EventBuildError, match="ready file"):
        product_published(snapshot, published_at=T)
    brand = a_brand()
    assert brand.logo is not None
    brand.logo.status = "pending"
    with pytest.raises(EventBuildError, match="ready file"):
        brand_profile_published(brand)


# --- only what is really published can be published -------------------------------------------


def test_only_the_published_profile_is_published() -> None:
    for state in ("draft", "pending_review", "superseded", "rejected"):
        with pytest.raises(EventBuildError, match="published profile"):
            brand_profile_published(a_brand(state=state))


def test_only_the_live_revision_of_an_approved_product_is_published() -> None:
    snapshot = a_product()
    snapshot.product.live_revision_id = uuid.uuid4()
    with pytest.raises(EventBuildError, match="live revision"):
        product_published(snapshot, published_at=T)
    snapshot = a_product()
    snapshot.product.status = "archived"
    with pytest.raises(EventBuildError, match="approved"):
        product_published(snapshot, published_at=T)


def test_a_profile_of_another_vendor_is_refused() -> None:
    snapshot = a_brand()
    snapshot.profile.vendor_id = uuid.uuid4()
    with pytest.raises(EventBuildError, match="another vendor"):
        brand_profile_published(snapshot)


def test_something_never_published_cannot_be_unpublished() -> None:
    with pytest.raises(EventBuildError, match="never published"):
        brand_profile_unpublished(
            VENDOR_ID, version=1, last_published_version=None, reason="withdrawn", unpublished_at=T
        )
    with pytest.raises(EventBuildError, match="never published"):
        product_unpublished(
            PRODUCT_ID,
            VENDOR_ID,
            version=1,
            last_published_version=None,
            reason="withdrawn",
            unpublished_at=T,
        )


@pytest.mark.parametrize("version", [2, 1])
def test_an_unpublished_event_needs_a_higher_version(version: int) -> None:
    with pytest.raises(EventBuildError, match="above the published one"):
        product_unpublished(
            PRODUCT_ID,
            VENDOR_ID,
            version=version,
            last_published_version=2,
            reason="archived",
            unpublished_at=T,
        )


def test_every_unpublish_reason_of_the_contract_is_accepted() -> None:
    for reason in ("withdrawn", "vendor_suspended", "rejected_after_publish"):
        brand_profile_unpublished(
            VENDOR_ID, version=4, last_published_version=3, reason=reason, unpublished_at=T
        )
    for reason in (
        "withdrawn",
        "archived",
        "back_in_review",
        "vendor_suspended",
        "rejected_after_publish",
    ):
        product_unpublished(
            PRODUCT_ID,
            VENDOR_ID,
            version=3,
            last_published_version=2,
            reason=reason,
            unpublished_at=T,
        )


def test_an_unknown_unpublish_reason_is_refused() -> None:
    with pytest.raises(EventBuildError, match="unpublished for one of"):
        product_unpublished(
            PRODUCT_ID,
            VENDOR_ID,
            version=3,
            last_published_version=2,
            reason="archived_by_ghost",
            unpublished_at=T,
        )
    with pytest.raises(EventBuildError, match="unpublished for one of"):
        brand_profile_unpublished(
            VENDOR_ID, version=4, last_published_version=3, reason="archived", unpublished_at=T
        )


# --- vendor status ------------------------------------------------------------


@pytest.mark.parametrize("status", ["approved", "rejected", "suspended"])
def test_a_vendor_status_is_reported(status: str) -> None:
    event = vendor_status_changed(
        VENDOR_ID, status=status, reason=None, changed_at=T, version=2
    ).envelope()
    contract().validate(event)
    assert event["aggregate"] == {"type": "vendor", "id": str(VENDOR_ID)}
    assert "reason" not in event["payload"]


def test_a_vendor_is_never_reported_as_pending() -> None:
    with pytest.raises(EventBuildError, match="not sent"):
        vendor_status_changed(
            VENDOR_ID, status=VendorStatus.PENDING, reason=None, changed_at=T, version=1
        )


def test_a_long_reason_is_cut_to_the_contracts_limit() -> None:
    built = vendor_status_changed(
        VENDOR_ID, status="suspended", reason="x" * 900, changed_at=T, version=2
    )
    reason = built.payload["reason"]
    assert len(reason) == 500 and reason.endswith("…")


def test_a_blank_reason_is_left_out() -> None:
    built = vendor_status_changed(
        VENDOR_ID, status="suspended", reason="  ", changed_at=T, version=2
    )
    assert "reason" not in built.payload


def test_the_vendors_contact_details_never_appear() -> None:
    built = vendor_status_changed(
        VENDOR_ID, status="approved", reason="ok", changed_at=T, version=2
    )
    assert "+919999999999" not in built.body().decode()


# --- stable, bounded, never contact data or stock ---------------------------------------------


def test_the_same_state_gives_the_same_bytes() -> None:
    fixed: dict[str, Any] = {"event_id": uuid.UUID(int=1), "occurred_at": T}
    first = brand_profile_published(a_brand(), **fixed).body()
    assert brand_profile_published(a_brand(), **fixed).body() == first
    a, b = a_product(), a_product()
    assert (
        product_published(a, published_at=T, **fixed).body()
        == product_published(b, published_at=T, **fixed).body()
    )


def test_building_twice_differs_only_in_the_event_id_and_time() -> None:
    first = brand_profile_published(a_brand()).envelope()
    second = brand_profile_published(a_brand()).envelope()
    assert first["event_id"] != second["event_id"]
    for envelope in (first, second):
        envelope.pop("event_id")
        envelope.pop("occurred_at")
    assert first == second


def test_the_order_rows_are_given_in_does_not_matter() -> None:
    forward, backward = a_product(), a_product()
    backward_snapshot = ProductSnapshot(
        backward.product,
        backward.revision,
        list(reversed(backward.variants)),
        list(reversed(backward.images)),
    )
    fixed: dict[str, Any] = {"event_id": uuid.UUID(int=2), "occurred_at": T}
    assert (
        product_published(forward, published_at=T, **fixed).body()
        == product_published(backward_snapshot, published_at=T, **fixed).body()
    )


def scan(value: Any, path: str = "") -> list[str]:
    """The path of every key in the event that names stock or contact data."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in FORBIDDEN:
                found.append(f"{path}.{key}")
            found += scan(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += scan(item, f"{path}[{index}]")
    return found


def every_event() -> list[Any]:
    fixed: dict[str, Any] = {"occurred_at": T}
    return [
        brand_profile_published(a_brand(), **fixed),
        brand_profile_unpublished(
            VENDOR_ID,
            version=4,
            last_published_version=3,
            reason="withdrawn",
            unpublished_at=T,
            **fixed,
        ),
        product_published(a_product(), published_at=T, **fixed),
        product_unpublished(
            PRODUCT_ID,
            VENDOR_ID,
            version=3,
            last_published_version=2,
            reason="archived",
            unpublished_at=T,
            **fixed,
        ),
        vendor_status_changed(
            VENDOR_ID, status="suspended", reason="Policy", changed_at=T, version=2, **fixed
        ),
    ]


def test_no_built_event_has_stock_or_contact_fields() -> None:
    events = every_event()
    assert len(events) == 5
    for event in events:
        assert scan(event.envelope()) == [], event.event_type
        text = event.body().decode()
        for secret in ("+919999999999", "Asha Owner", "owner@indigo-lane.test"):
            assert secret not in text


def test_the_scan_itself_finds_what_it_looks_for() -> None:
    assert scan({"payload": {"variants": [{"stock": 3}]}}) == [".payload.variants[0].stock"]


def test_no_built_event_validates_if_a_forbidden_field_is_added() -> None:
    for event in every_event():
        envelope = deepcopy(event.envelope())
        envelope["payload"]["stock"] = 5
        assert contract().problems(envelope), event.event_type


def test_an_event_over_256_kb_is_refused() -> None:
    snapshot = a_brand(about="a" * 4000)
    huge = deepcopy(snapshot)
    huge.profile.categories = [f"category-{n:05d}-" + "x" * 60 for n in range(4000)]
    with pytest.raises(EventTooLarge, match=str(MAX_BODY_BYTES)):
        brand_profile_published(huge)


def test_times_are_utc_whole_seconds() -> None:
    ist = timezone(timedelta(hours=5, minutes=30))
    assert iso(datetime(2026, 10, 23, 15, 45, 0, 999_999, tzinfo=ist)) == "2026-10-23T10:15:00Z"
    with pytest.raises(EventBuildError, match="time zone"):
        iso(datetime(2026, 10, 23, 10, 15))


def test_every_builders_type_is_one_the_contract_has() -> None:
    assert sorted(e.event_type for e in every_event()) == contract().event_types


# --- reading the state (needs a database) -----------------------------------------------------


async def test_a_published_brand_page_is_read_and_built(session: AsyncSession) -> None:
    from factories import saved_asset, saved_profile, saved_user, saved_vendor

    vendor = await saved_vendor(session, slug="indigo-lane", email="o@indigo.test")
    owner = await saved_user(session, vendor)
    logo = await saved_asset(session, vendor, owner, public_id="shazlo/il-logo")
    await saved_profile(
        session,
        vendor,
        version=1,
        state="superseded",
        published_at=T,
        submitted_at=T,
        categories=["Kurtis"],
    )
    await saved_profile(
        session,
        vendor,
        version=2,
        state="published",
        published_at=T,
        submitted_at=T,
        categories=["Kurtis", "Co-ords"],
        logo_asset_id=logo.id,
    )
    snapshot = await load_brand_snapshot(session, vendor.id)
    built = brand_profile_published(snapshot)
    assert built.version == 2
    assert built.payload["categories"] == ["Kurtis", "Co-ords"]
    assert built.payload["logo_url"] == logo.url


async def test_a_vendor_without_a_published_page_has_nothing_to_build(
    session: AsyncSession,
) -> None:
    from factories import saved_profile, saved_vendor

    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, state="draft")
    with pytest.raises(EventBuildError, match="no published brand page"):
        await load_brand_snapshot(session, vendor.id)


async def test_a_live_product_is_read_and_built(session: AsyncSession) -> None:
    from factories import (
        saved_asset,
        saved_image,
        saved_product,
        saved_revision,
        saved_revision_variant,
        saved_user,
        saved_variant,
        saved_vendor,
    )

    vendor = await saved_vendor(session)
    owner = await saved_user(session, vendor)
    product = await saved_product(session, vendor, "KURTA-01")
    first = await saved_revision(session, product, owner, version=1)
    variant_m = await saved_variant(session, product, "KURTA-01-M", size="M")
    variant_l = await saved_variant(session, product, "KURTA-01-L", size="L")
    await saved_revision_variant(session, first, variant_m)
    await saved_revision_variant(session, first, variant_l, is_active=False)
    for position, name in ((2, "b"), (1, "a")):
        asset = await saved_asset(
            session, vendor, owner, public_id=f"shazlo/k-{name}", kind="product_image"
        )
        await saved_image(session, first, asset, position=position)
    product.live_revision_id = first.id
    product.status = "approved"
    await session.flush()

    built = product_published(await load_product_snapshot(session, product.id), published_at=T)
    assert [v["sku"] for v in built.payload["variants"]] == ["KURTA-01-M"]
    assert [i["position"] for i in built.payload["images"]] == [1, 2]
    assert built.version == product.version
    again = product_published(
        await load_product_snapshot(session, product.id),
        published_at=T,
        event_id=built.event_id,
        occurred_at=built.occurred_at,
    )
    assert again.body() == built.body()


async def test_a_product_with_no_live_revision_has_nothing_to_build(session: AsyncSession) -> None:
    from factories import saved_product, saved_vendor

    vendor = await saved_vendor(session)
    product = await saved_product(session, vendor)
    with pytest.raises(EventBuildError, match="no live revision"):
        await load_product_snapshot(session, product.id)


async def test_the_status_version_counts_the_vendors_changes(session: AsyncSession) -> None:
    from factories import saved_vendor
    from sqlalchemy import select

    from vendor_api.db.models import VendorStatusEvent

    vendor = await saved_vendor(session)
    for from_status, to_status in (
        (None, "pending"),
        ("pending", "approved"),
        ("approved", "suspended"),
    ):
        session.add(
            VendorStatusEvent(
                vendor_id=vendor.id,
                from_status=from_status,
                to_status=to_status,
                actor_type="system",
            )
        )
    await session.flush()
    rows = (
        await session.scalars(
            select(VendorStatusEvent)
            .where(VendorStatusEvent.vendor_id == vendor.id)
            .order_by(VendorStatusEvent.id)
        )
    ).all()
    versions = [await vendor_status_version(session, vendor.id, row.id) for row in rows]
    assert versions == [1, 2, 3]
