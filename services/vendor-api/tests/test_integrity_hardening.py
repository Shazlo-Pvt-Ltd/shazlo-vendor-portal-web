"""Migration 0006: submitted content and decided reviews are history the database protects.

Each guarantee has the write that must fail and the legitimate writes that must still work.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from factories import (
    count,
    make_image,
    make_product,
    make_revision_variant,
    saved_asset,
    saved_image,
    saved_product,
    saved_profile,
    saved_review,
    saved_revision,
    saved_revision_variant,
    saved_user,
    saved_variant,
    saved_vendor,
    submittable_revision,
)
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    ActorType,
    BrandProfile,
    BrandProfileState,
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductStatus,
    ProductVariant,
    Review,
    VendorStatus,
    VendorStatusEvent,
)

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
LATER = datetime(2099, 1, 1, tzinfo=UTC)
ADMIN = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

SUBMITTED: dict[str, Any] = {
    "state": BrandProfileState.PENDING_REVIEW,
    "categories": ["dresses"],
    "submitted_at": NOW,
}
PUBLISHED: dict[str, Any] = {**SUBMITTED, "state": BrandProfileState.PUBLISHED, "published_at": NOW}
# Every state after draft, as the row is inserted.
FROZEN_STATES: dict[str, dict[str, Any]] = {
    "pending_review": SUBMITTED,
    "rejected": {**SUBMITTED, "state": BrandProfileState.REJECTED},
    "published": PUBLISHED,
    "superseded": {**PUBLISHED, "state": BrandProfileState.SUPERSEDED},
}


async def vendor_and_user(session: AsyncSession, name: str = "first") -> tuple[Any, Any]:
    vendor = await saved_vendor(session, slug=name, email=f"owner@{name}.test")
    return vendor, await saved_user(session, vendor, email=f"asha@{name}.test")


async def set_profile(session: AsyncSession, profile: BrandProfile, **values: Any) -> None:
    await session.execute(update(BrandProfile).where(BrandProfile.id == profile.id).values(values))


async def reload[T](session: AsyncSession, model: type[T], **where: Any) -> T:
    query = select(model).execution_options(populate_existing=True)
    for column, value in where.items():
        query = query.where(getattr(model, column) == value)
    return (await session.scalars(query)).one()


# --- vendor_status_events: no TRUNCATE ---------------------------------------------------


async def test_vendor_status_events_cannot_be_truncated(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(
        VendorStatusEvent(
            vendor_id=vendor.id, to_status=VendorStatus.PENDING, actor_type=ActorType.SYSTEM
        )
    )
    await session.flush()
    with pytest.raises(IntegrityError, match="vendor_status_events is append-only"):
        await session.execute(text("TRUNCATE vendor_status_events"))


# --- brand_profiles: content frozen after draft ------------------------------------------


async def test_a_draft_can_be_edited_and_submitted_in_one_update(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor)
    await set_profile(session, profile, tagline="Edited", **SUBMITTED)
    stored = await reload(session, BrandProfile, id=profile.id)
    assert (stored.state, stored.tagline) == ("pending_review", "Edited")


@pytest.mark.parametrize("state", ["draft", *FROZEN_STATES])
async def test_a_profile_never_moves_to_another_vendor(session: AsyncSession, state: str) -> None:
    vendor = await saved_vendor(session)
    other = await saved_vendor(session, slug="other", email="owner@other.test")
    profile = await saved_profile(session, vendor, **FROZEN_STATES.get(state, {}))
    with pytest.raises(IntegrityError, match="cannot move to another vendor"):
        await set_profile(session, profile, vendor_id=other.id)


@pytest.mark.parametrize(
    "column",
    [
        "brand_name",
        "tagline",
        "about",
        "logo_asset_id",
        "banner_asset_id",
        "website_url",
        "instagram_handle",
        "categories",
        "price_min_paise",
        "price_max_paise",
        "submitted_at",
        "updated_by",
        "created_at",
    ],
)
async def test_submitted_profile_content_is_frozen(session: AsyncSession, column: str) -> None:
    vendor, user = await vendor_and_user(session)
    asset = await saved_asset(session, vendor, user)
    profile = await saved_profile(session, vendor, **SUBMITTED)
    new_values: dict[str, Any] = {
        "brand_name": "Other",
        "tagline": "New",
        "about": "New",
        "logo_asset_id": asset.id,
        "banner_asset_id": asset.id,
        "website_url": "https://acme.test",
        "instagram_handle": "acme_new",
        "categories": ["sarees"],
        "price_min_paise": 1,
        "price_max_paise": 999_999,
        "submitted_at": LATER,
        "updated_by": user.id,
        "created_at": LATER,
    }
    with pytest.raises(IntegrityError, match="a submitted brand profile cannot be edited"):
        await set_profile(session, profile, **{column: new_values[column]})


@pytest.mark.parametrize("state", list(FROZEN_STATES))
async def test_content_is_frozen_in_every_state_after_draft(
    session: AsyncSession, state: str
) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, **FROZEN_STATES[state])
    with pytest.raises(IntegrityError, match=f"cannot be edited \\(state {state}\\)"):
        await set_profile(session, profile, tagline="Sneaky")


async def test_editing_through_the_orm_is_refused_too(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, **PUBLISHED)
    profile.brand_name = "Renamed"
    with pytest.raises(IntegrityError, match="a submitted brand profile cannot be edited"):
        await session.flush()


@pytest.mark.parametrize(
    ("start", "end", "extra"),
    [
        ("pending_review", "published", {"published_at": NOW}),
        ("pending_review", "rejected", {}),
        ("published", "superseded", {}),
    ],
)
async def test_the_documented_state_changes_still_work(
    session: AsyncSession, start: str, end: str, extra: dict[str, Any]
) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, **FROZEN_STATES[start])
    await set_profile(session, profile, state=end, **extra)
    assert (await reload(session, BrandProfile, id=profile.id)).state == end


@pytest.mark.parametrize(
    ("start", "end", "extra"),
    [
        ("pending_review", "draft", {}),
        ("rejected", "draft", {}),
        ("rejected", "pending_review", {}),
        ("rejected", "published", {"published_at": NOW}),
        ("published", "draft", {"published_at": None}),
        ("published", "pending_review", {"published_at": None}),
        ("superseded", "published", {}),
    ],
)
async def test_other_state_changes_are_refused(
    session: AsyncSession, start: str, end: str, extra: dict[str, Any]
) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, **FROZEN_STATES[start])
    with pytest.raises(IntegrityError, match=f"cannot go from {start} to {end}"):
        await set_profile(session, profile, state=end, **extra)


async def test_published_at_is_set_once(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, **PUBLISHED)
    with pytest.raises(IntegrityError, match="published_at cannot change once set"):
        await set_profile(session, profile, published_at=LATER)


async def test_touching_only_updated_at_is_allowed(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, **PUBLISHED)
    await set_profile(session, profile, updated_at=LATER)


# --- product revisions: frozen once submitted --------------------------------------------


async def submitted_revision(session: AsyncSession) -> tuple[Any, Any, Product, ProductRevision]:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == revision.id).values(submitted_at=NOW)
    )
    return vendor, user, product, revision


@pytest.mark.parametrize(
    "values",
    [{"title": "Renamed"}, {"submitted_at": None}, {"submitted_at": LATER}, {"returnable": True,
     "return_window_days": 7}],
    ids=["title", "unsubmit", "resubmit", "returnable"],
)  # fmt: skip
async def test_a_submitted_revision_cannot_be_changed(
    session: AsyncSession, values: dict[str, Any]
) -> None:
    _, _, _, revision = await submitted_revision(session)
    with pytest.raises(IntegrityError, match="a submitted product revision cannot be changed"):
        await session.execute(
            update(ProductRevision).where(ProductRevision.id == revision.id).values(values)
        )


async def test_a_submitted_revision_cannot_be_deleted(session: AsyncSession) -> None:
    _, _, _, revision = await submitted_revision(session)
    with pytest.raises(IntegrityError, match="a submitted product revision cannot be deleted"):
        await session.execute(
            text("DELETE FROM product_revisions WHERE id = :id"), {"id": revision.id}
        )


async def test_a_draft_revision_can_be_edited(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    _, revision = await submittable_revision(session, vendor, user)
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == revision.id).values(title="Renamed")
    )
    assert (await reload(session, ProductRevision, id=revision.id)).title == "Renamed"


async def test_a_never_submitted_draft_product_can_be_deleted_whole(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    # The revision's variant prices and images cascade; then the product's own rows go.
    await session.execute(text("DELETE FROM product_revisions WHERE id = :id"), {"id": revision.id})
    await session.execute(
        text("DELETE FROM product_variants WHERE product_id = :id"), {"id": product.id}
    )
    await session.execute(text("DELETE FROM products WHERE id = :id"), {"id": product.id})
    assert await count(session, Product) == 0
    assert await count(session, ProductImage) == 0


@pytest.mark.parametrize("column", ["product_id", "vendor_id"])
async def test_a_revision_never_moves_even_as_a_draft(session: AsyncSession, column: str) -> None:
    vendor, user = await vendor_and_user(session)
    other_vendor, _ = await vendor_and_user(session, "second")
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    other = await saved_product(session, vendor, "OTHER-01")
    target = other.id if column == "product_id" else other_vendor.id
    with pytest.raises(IntegrityError, match="cannot move to another product or vendor"):
        await session.execute(
            update(ProductRevision)
            .where(ProductRevision.id == revision.id)
            .values({column: target})
        )


# --- variant prices and images of a submitted revision -----------------------------------


async def test_a_variant_price_cannot_be_added_to_a_submitted_revision(
    session: AsyncSession,
) -> None:
    _, _, product, revision = await submitted_revision(session)
    variant = await saved_variant(session, product, "KURTA-01-L", size="L")
    session.add(make_revision_variant(revision, variant))
    with pytest.raises(
        IntegrityError, match="product_revision_variants of a submitted product revision"
    ):
        await session.flush()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE product_revision_variants SET price_paise = 1 WHERE revision_id = :id",
        "UPDATE product_revision_variants SET is_active = false WHERE revision_id = :id",
        "DELETE FROM product_revision_variants WHERE revision_id = :id",
    ],
    ids=["price", "deactivate", "delete"],
)
async def test_a_submitted_revisions_variant_prices_are_frozen(
    session: AsyncSession, statement: str
) -> None:
    _, _, _, revision = await submitted_revision(session)
    with pytest.raises(
        IntegrityError, match="product_revision_variants of a submitted product revision"
    ):
        await session.execute(text(statement), {"id": revision.id})


async def test_an_image_cannot_be_added_to_a_submitted_revision(session: AsyncSession) -> None:
    vendor, user, _, revision = await submitted_revision(session)
    asset = await saved_asset(
        session, vendor, user, public_id="shazlo/KURTA-01-2", kind="product_image"
    )
    session.add(make_image(revision, asset, 2))
    with pytest.raises(IntegrityError, match="product_images of a submitted product revision"):
        await session.flush()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE product_images SET alt_text = 'new' WHERE revision_id = :id",
        "UPDATE product_images SET position = 2 WHERE revision_id = :id",
        "DELETE FROM product_images WHERE revision_id = :id",
    ],
    ids=["alt-text", "position", "delete"],
)
async def test_a_submitted_revisions_images_are_frozen(
    session: AsyncSession, statement: str
) -> None:
    _, _, _, revision = await submitted_revision(session)
    with pytest.raises(IntegrityError, match="product_images of a submitted product revision"):
        await session.execute(text(statement), {"id": revision.id})


async def test_an_image_cannot_be_moved_out_of_a_submitted_revision(
    session: AsyncSession,
) -> None:
    _, user, product, revision = await submitted_revision(session)
    draft = await saved_revision(session, product, user, 2)
    with pytest.raises(IntegrityError, match="product_images of a submitted product revision"):
        await session.execute(
            update(ProductImage)
            .where(ProductImage.revision_id == revision.id)
            .values(revision_id=draft.id)
        )


async def test_a_draft_revisions_prices_and_images_stay_editable(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    variant = await saved_variant(session, product, "KURTA-01-L", size="L")
    await saved_revision_variant(session, revision, variant)
    asset = await saved_asset(
        session, vendor, user, public_id="shazlo/KURTA-01-2", kind="product_image"
    )
    await saved_image(session, revision, asset, 2)
    await session.execute(
        update(ProductRevisionVariant)
        .where(ProductRevisionVariant.variant_id == variant.id)
        .values(price_paise=1, mrp_paise=1)
    )
    await session.execute(
        text("DELETE FROM product_images WHERE revision_id = :id AND position = 2"),
        {"id": revision.id},
    )
    # ...and the revision can still be submitted afterwards.
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == revision.id).values(submitted_at=NOW)
    )


async def test_a_new_revision_of_an_approved_product_is_editable(session: AsyncSession) -> None:
    """The submitted revision 1 is frozen, but editing the product means a new draft revision."""
    _, user, product, _ = await submitted_revision(session)
    second = await saved_revision(session, product, user, 2)
    variant = await session.scalar(select(ProductVariant))
    assert variant is not None
    await saved_revision_variant(session, second, variant, price_paise=109_900, mrp_paise=139_900)
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == second.id).values(title="New title")
    )


# --- products: pending_review has something pending --------------------------------------


async def test_a_product_in_review_needs_a_pending_revision(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    session.add(make_product(vendor, status=ProductStatus.PENDING_REVIEW))
    with pytest.raises(IntegrityError, match="ck_products_pending_review_has_pending"):
        await session.flush()


async def test_clearing_the_pending_revision_of_a_product_in_review_is_refused(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    await session.execute(
        update(Product)
        .where(Product.id == product.id)
        .values(status=ProductStatus.PENDING_REVIEW, pending_revision_id=revision.id)
    )
    with pytest.raises(IntegrityError, match="ck_products_pending_review_has_pending"):
        await session.execute(
            update(Product).where(Product.id == product.id).values(pending_revision_id=None)
        )


# --- reviews: decided ones are frozen, none are deleted ----------------------------------


async def pending_review(session: AsyncSession) -> tuple[Any, Any, BrandProfile, Review]:
    vendor, user = await vendor_and_user(session)
    profile = await saved_profile(session, vendor, **SUBMITTED)
    return vendor, user, profile, await saved_review(session, vendor, user, profile=profile)


async def decide(session: AsyncSession, review: Review, **values: Any) -> None:
    await session.execute(update(Review).where(Review.id == review.id).values(values))


DECISIONS: dict[str, dict[str, Any]] = {
    "approved": {"status": "approved", "reviewer_id": ADMIN, "decided_at": LATER},
    "rejected": {"status": "rejected", "reviewer_id": ADMIN, "decided_at": LATER, "reason": "no"},
    "withdrawn": {"status": "withdrawn", "decided_at": LATER},
}


@pytest.mark.parametrize("outcome", list(DECISIONS))
async def test_a_pending_review_can_be_decided(session: AsyncSession, outcome: str) -> None:
    _, _, _, review = await pending_review(session)
    await decide(session, review, **DECISIONS[outcome])
    assert (await reload(session, Review, id=review.id)).status == outcome


async def test_a_pending_review_may_change_its_decision_columns(session: AsyncSession) -> None:
    _, _, _, review = await pending_review(session)
    await decide(session, review, reason="draft note")


@pytest.mark.parametrize("outcome", list(DECISIONS))
@pytest.mark.parametrize(
    "change",
    [
        {"reason": "rewritten"},
        {"status": "rejected", "reviewer_id": ADMIN, "decided_at": LATER, "reason": "changed"},
        {"status": "pending", "reviewer_id": None, "decided_at": None, "reason": None},
        {"decided_at": datetime(2098, 1, 1, tzinfo=UTC)},
    ],
    ids=["reason", "flip", "reopen", "decided-at"],
)
async def test_a_decided_review_is_frozen(
    session: AsyncSession, outcome: str, change: dict[str, Any]
) -> None:
    _, _, _, review = await pending_review(session)
    await decide(session, review, **DECISIONS[outcome])
    with pytest.raises(
        IntegrityError, match=f"decided review cannot be changed \\(status {outcome}"
    ):
        await decide(session, review, **change)


@pytest.mark.parametrize(
    "column", ["vendor_id", "brand_profile_id", "subject", "submitted_by", "submitted_at"]
)
async def test_what_was_reviewed_never_changes(session: AsyncSession, column: str) -> None:
    vendor, user, _, review = await pending_review(session)
    other_vendor, _ = await vendor_and_user(session, "second")
    other_user = await saved_user(session, vendor, email="ravi@first.test")
    other_profile = await saved_profile(session, vendor, version=2, **SUBMITTED)
    _, revision = await submittable_revision(session, vendor, user)
    changes: dict[str, dict[str, Any]] = {
        "vendor_id": {"vendor_id": other_vendor.id},
        "brand_profile_id": {"brand_profile_id": other_profile.id},
        "subject": {
            "subject": "product",
            "brand_profile_id": None,
            "product_revision_id": revision.id,
        },
        "submitted_by": {"submitted_by": other_user.id},
        "submitted_at": {"submitted_at": NOW},
    }
    with pytest.raises(IntegrityError, match="subject and submission cannot change"):
        await decide(session, review, **changes[column])


@pytest.mark.parametrize("outcome", ["pending", *DECISIONS])
async def test_a_review_cannot_be_deleted(session: AsyncSession, outcome: str) -> None:
    _, _, _, review = await pending_review(session)
    if outcome != "pending":
        await decide(session, review, **DECISIONS[outcome])
    with pytest.raises(IntegrityError, match="reviews cannot be deleted"):
        await session.execute(text("DELETE FROM reviews WHERE id = :id"), {"id": review.id})


async def test_reviews_cannot_be_truncated(session: AsyncSession) -> None:
    await pending_review(session)
    # A plain TRUNCATE is already refused for the review_events foreign key; naming both
    # tables gets past that, and the reviews trigger (first in the list) refuses it.
    with pytest.raises(IntegrityError, match="reviews cannot be deleted"):
        await session.execute(text("TRUNCATE reviews, review_events"))


async def test_the_review_subject_indexes_cover_every_review(session: AsyncSession) -> None:
    rows = await session.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'reviews'")
    )
    definitions = {str(row[0]): str(row[1]) for row in rows}
    for column in ("brand_profile_id", "product_revision_id"):
        definition = definitions[f"ix_reviews_{column}"]
        assert f"btree ({column})" in definition
        assert "WHERE" not in definition  # a full index, unlike the partial unique ones
