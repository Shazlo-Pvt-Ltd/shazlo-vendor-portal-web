import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from factories import (
    count,
    make_image,
    make_product,
    make_revision,
    make_revision_variant,
    saved_asset,
    saved_image,
    saved_product,
    saved_revision,
    saved_revision_variant,
    saved_user,
    saved_variant,
    saved_vendor,
    submittable_revision,
)
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductStatus,
    ProductVariant,
)

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)


async def vendor_and_user(session: AsyncSession, name: str = "first") -> tuple[Any, Any]:
    vendor = await saved_vendor(session, slug=name, email=f"owner@{name}.test")
    return vendor, await saved_user(session, vendor, email=f"asha@{name}.test")


async def reload[T](session: AsyncSession, model: type[T], **where: Any) -> T:
    """A row read again from the database (bulk updates do not refresh loaded objects)."""
    query = select(model).execution_options(populate_existing=True)
    for column, value in where.items():
        query = query.where(getattr(model, column) == value)
    return (await session.scalars(query)).one()


# --- SKUs --------------------------------------------------------------------------------


async def test_product_defaults(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor, "Kurta-01")
    await session.refresh(product)
    assert isinstance(product.id, uuid.UUID)
    assert product.status == ProductStatus.DRAFT
    assert product.version == 1
    assert (product.live_revision_id, product.pending_revision_id) == (None, None)
    assert product.sku == "Kurta-01"
    assert product.sku_key == "kurta-01"  # the lower-cased copy the unique constraint uses
    assert product.created_at is not None


@pytest.mark.parametrize("second", ["KURTA-01", "kurta-01", "Kurta-01", "kUrTa-01"])
async def test_a_vendor_cannot_use_a_sku_twice_in_any_letter_case(
    session: AsyncSession, second: str
) -> None:
    vendor, _ = await vendor_and_user(session)
    await saved_product(session, vendor, "KURTA-01")
    session.add(make_product(vendor, second))
    with pytest.raises(IntegrityError, match="uq_products_vendor_id_sku_key"):
        await session.flush()


async def test_two_vendors_can_use_the_same_sku(session: AsyncSession) -> None:
    first, _ = await vendor_and_user(session, "first")
    second, _ = await vendor_and_user(session, "second")
    await saved_product(session, first, "KURTA-01")
    await saved_product(session, second, "KURTA-01")
    await saved_product(session, second, "kurta-02")
    assert await count(session, Product) == 3


async def test_an_archived_product_keeps_its_sku_reserved(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    old = await saved_product(session, vendor, "KURTA-01")
    await session.execute(
        update(Product).where(Product.id == old.id).values(status=ProductStatus.ARCHIVED)
    )
    session.add(make_product(vendor, "kurta-01"))
    with pytest.raises(IntegrityError, match="uq_products_vendor_id_sku_key"):
        await session.flush()


@pytest.mark.parametrize("sku", ["", " KURTA", "KURTA ", "   "])
async def test_an_unclean_sku_is_refused(session: AsyncSession, sku: str) -> None:
    vendor, _ = await vendor_and_user(session)
    session.add(make_product(vendor, sku))
    with pytest.raises(IntegrityError, match="ck_products_sku_clean"):
        await session.flush()


async def test_a_sku_is_limited_to_64_characters(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    await saved_product(session, vendor, "A" * 64)
    session.add(make_product(vendor, "B" * 65))
    with pytest.raises(DBAPIError, match="too long"):
        await session.flush()


async def test_variant_skus_follow_the_same_rules(session: AsyncSession) -> None:
    first, _ = await vendor_and_user(session, "first")
    second, _ = await vendor_and_user(session, "second")
    one = await saved_product(session, first, "ONE")
    two = await saved_product(session, first, "TWO")
    other = await saved_product(session, second, "ONE")
    await saved_variant(session, one, "SKU-M", size="M")
    # Another vendor may use it.
    await saved_variant(session, other, "sku-m", size="M")
    # The same vendor may not, even on another product and in another letter case.
    with pytest.raises(IntegrityError, match="uq_product_variants_vendor_id_sku_key"):
        await saved_variant(session, two, "Sku-M", size="L")


@pytest.mark.parametrize("sku", ["", " M", "M "])
async def test_an_unclean_variant_sku_is_refused(session: AsyncSession, sku: str) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    with pytest.raises(IntegrityError, match="ck_product_variants_sku_clean"):
        await saved_variant(session, product, sku)


# --- Product state -----------------------------------------------------------------------


async def test_an_unknown_status_is_refused(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    session.add(make_product(vendor, status="live"))
    with pytest.raises(IntegrityError, match="ck_products_status_values"):
        await session.flush()


async def test_an_approved_product_needs_a_live_revision(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    session.add(make_product(vendor, status=ProductStatus.APPROVED))
    with pytest.raises(IntegrityError, match="ck_products_approved_has_live"):
        await session.flush()


@pytest.mark.parametrize("status", ["draft", "pending_review", "rejected"])
async def test_a_product_never_approved_has_no_live_revision(
    session: AsyncSession, status: str
) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    # Something pending, so `pending_review` passes ck_products_pending_review_has_pending.
    pending = await saved_revision(session, product, user, 2)
    with pytest.raises(IntegrityError, match="ck_products_unapproved_has_no_live"):
        await session.execute(
            update(Product)
            .where(Product.id == product.id)
            .values(status=status, live_revision_id=revision.id, pending_revision_id=pending.id)
        )


async def test_the_live_and_the_pending_revision_must_differ(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    with pytest.raises(IntegrityError, match="ck_products_live_and_pending_differ"):
        await session.execute(
            update(Product)
            .where(Product.id == product.id)
            .values(
                status=ProductStatus.APPROVED,
                live_revision_id=revision.id,
                pending_revision_id=revision.id,
            )
        )


@pytest.mark.parametrize("link", ["live", "pending"])
async def test_a_product_cannot_point_at_another_products_revision(
    session: AsyncSession, link: str
) -> None:
    vendor, user = await vendor_and_user(session)
    one, _ = await submittable_revision(session, vendor, user, "ONE")
    _, other_revision = await submittable_revision(session, vendor, user, "TWO")
    values: dict[str, Any] = {f"{link}_revision_id": other_revision.id}
    if link == "live":
        values["status"] = ProductStatus.APPROVED
    with pytest.raises(IntegrityError, match=f"fk_products_{link}_revision_id_product_revisions"):
        await session.execute(update(Product).where(Product.id == one.id).values(**values))


async def test_a_product_version_goes_up_and_never_down(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    for version in (1, 2, 5, 5):  # staying equal is an ordinary update
        await session.execute(
            update(Product).where(Product.id == product.id).values(version=version)
        )
    with pytest.raises(IntegrityError, match="version cannot go down"):
        await session.execute(update(Product).where(Product.id == product.id).values(version=4))


async def test_a_product_version_starts_at_one(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    session.add(make_product(vendor, version=0))
    with pytest.raises(IntegrityError, match="ck_products_version_positive"):
        await session.flush()


async def test_other_product_updates_do_not_touch_the_version_rule(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    product.pending_revision_id = revision.id  # a product in review has a revision in review
    product.status = ProductStatus.PENDING_REVIEW
    await session.flush()
    assert (await reload(session, Product, id=product.id)).version == 1


# --- Revision content --------------------------------------------------------------------


async def test_revision_defaults(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    await session.refresh(revision)
    assert isinstance(revision.id, uuid.UUID)
    assert revision.returnable is False
    assert (revision.return_window_days, revision.submitted_at) == (None, None)
    assert (revision.description, revision.subcategory, revision.fabric) == (None, None, None)
    assert revision.weight_grams is None
    assert revision.created_at is not None


@pytest.mark.parametrize(
    ("field", "limit"),
    [
        ("title", 200),
        ("description", 4000),
        ("category", 100),
        ("subcategory", 100),
        ("fabric", 80),
    ],
)
async def test_text_limits_are_the_contracts(session: AsyncSession, field: str, limit: int) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    at_limit: dict[str, Any] = {field: "a" * limit}
    over: dict[str, Any] = {field: "a" * (limit + 1)}
    await saved_revision(session, product, user, 1, **at_limit)
    session.add(make_revision(product, user, 2, **over))
    with pytest.raises(DBAPIError, match="too long"):
        await session.flush()


@pytest.mark.parametrize(
    ("field", "constraint"), [("title", "title_not_blank"), ("category", "category_not_blank")]
)
async def test_blank_required_text_is_refused(
    session: AsyncSession, field: str, constraint: str
) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    blank: dict[str, Any] = {field: "   "}
    session.add(make_revision(product, user, **blank))
    with pytest.raises(IntegrityError, match=f"ck_product_revisions_{constraint}"):
        await session.flush()


@pytest.mark.parametrize("gender", ["women", "men", "unisex"])
async def test_the_contracts_genders_are_accepted(session: AsyncSession, gender: str) -> None:
    vendor, user = await vendor_and_user(session)
    await saved_revision(session, await saved_product(session, vendor), user, gender=gender)


@pytest.mark.parametrize("gender", ["", "Women", "kids", "other"])
async def test_other_genders_are_refused(session: AsyncSession, gender: str) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    session.add(make_revision(product, user, gender=gender))
    with pytest.raises(IntegrityError, match="ck_product_revisions_gender_values"):
        await session.flush()


@pytest.mark.parametrize("weight", [0, -5])
async def test_the_weight_must_be_positive(session: AsyncSession, weight: int) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    session.add(make_revision(product, user, weight_grams=weight))
    with pytest.raises(IntegrityError, match="ck_product_revisions_weight_positive"):
        await session.flush()


@pytest.mark.parametrize("days", [0, 7, 30])
async def test_a_returnable_product_with_a_window_is_accepted(
    session: AsyncSession, days: int
) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    await saved_revision(session, product, user, returnable=True, return_window_days=days)


async def test_a_returnable_product_needs_a_return_window(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    session.add(make_revision(product, user, returnable=True, return_window_days=None))
    with pytest.raises(IntegrityError, match="ck_product_revisions_return_window_required"):
        await session.flush()


@pytest.mark.parametrize("days", [-1, 31, 365])
async def test_the_return_window_is_zero_to_thirty_days(session: AsyncSession, days: int) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    session.add(make_revision(product, user, returnable=True, return_window_days=days))
    with pytest.raises(IntegrityError, match="ck_product_revisions_return_window_range"):
        await session.flush()


async def test_a_product_that_is_not_returnable_needs_no_window(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    await saved_revision(session, product, user, returnable=False)


# --- Revision versions and ownership -----------------------------------------------------


async def test_revision_versions_increase_per_product(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    one = await saved_product(session, vendor, "ONE")
    two = await saved_product(session, vendor, "TWO")
    await saved_revision(session, one, user, 1)
    await saved_revision(session, one, user, 2)
    await saved_revision(session, one, user, 5)  # gaps are fine
    await saved_revision(session, two, user, 1)  # another product counts on its own
    assert await count(session, ProductRevision) == 4


@pytest.mark.parametrize("version", [1, 2, 3])
async def test_a_revision_version_cannot_repeat_or_go_back(
    session: AsyncSession, version: int
) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    await saved_revision(session, product, user, 3)
    session.add(make_revision(product, user, version))
    with pytest.raises(IntegrityError, match="version must be higher"):
        await session.flush()


async def test_a_revision_version_starts_at_one_and_never_changes(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    session.add(make_revision(product, user, 0))
    with pytest.raises(IntegrityError, match="ck_product_revisions_version_positive"):
        await session.flush()
    await session.rollback()


async def test_a_saved_revision_version_cannot_be_changed(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user, 2)
    with pytest.raises(IntegrityError, match="version cannot change"):
        await session.execute(
            update(ProductRevision).where(ProductRevision.id == revision.id).values(version=3)
        )


async def test_a_revision_must_carry_its_products_vendor(session: AsyncSession) -> None:
    first, user = await vendor_and_user(session, "first")
    second, _ = await vendor_and_user(session, "second")
    product = await saved_product(session, first)
    session.add(make_revision(product, user, vendor_id=second.id))
    with pytest.raises(IntegrityError, match="fk_product_revisions_product_id_products"):
        await session.flush()


async def test_a_product_with_revisions_cannot_be_deleted(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product, _ = await submittable_revision(session, vendor, user)
    with pytest.raises(IntegrityError, match="violates foreign key"):
        await session.execute(text("DELETE FROM products WHERE id = :id"), {"id": product.id})


# --- Variants and their prices -----------------------------------------------------------


async def test_a_variant_identity_is_unique_per_size_and_colour(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    await saved_variant(session, product, "V-1", size="M", color="indigo")
    await saved_variant(session, product, "V-2", size="L", color="indigo")  # other size
    await saved_variant(session, product, "V-3", size="M", color="red")  # other colour
    with pytest.raises(IntegrityError, match="uq_product_variants_product_id_size_color"):
        await saved_variant(session, product, "V-4", size="M", color="indigo")


async def test_a_product_without_sizes_has_one_variant_at_most(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    plain = await saved_variant(session, product, "V-1", size="", color="")
    assert (plain.size, plain.color) == ("", "")
    with pytest.raises(IntegrityError, match="uq_product_variants_product_id_size_color"):
        await saved_variant(session, product, "V-2", size="", color="")


async def test_size_and_colour_default_to_empty(session: AsyncSession) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    variant = ProductVariant(product_id=product.id, vendor_id=product.vendor_id, sku="V-1")
    session.add(variant)
    await session.flush()
    await session.refresh(variant)
    assert (variant.size, variant.color) == ("", "")


async def test_variant_size_and_colour_are_limited_to_32_characters(
    session: AsyncSession,
) -> None:
    vendor, _ = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    await saved_variant(session, product, "V-1", size="x" * 32, color="y" * 32)
    with pytest.raises(DBAPIError, match="too long"):
        await saved_variant(session, product, "V-2", size="x" * 33, color="")


async def test_a_variant_must_carry_its_products_vendor(session: AsyncSession) -> None:
    first, _ = await vendor_and_user(session, "first")
    second, _ = await vendor_and_user(session, "second")
    product = await saved_product(session, first)
    with pytest.raises(IntegrityError, match="fk_product_variants_product_id_products"):
        await saved_variant(session, product, "V-1", vendor_id=second.id)


async def test_the_same_variant_can_have_a_different_price_in_each_revision(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    product, live = await submittable_revision(session, vendor, user)
    pending = await saved_revision(session, product, user, 2)
    variant = await session.scalar(select(ProductVariant))
    assert variant is not None
    await saved_revision_variant(session, pending, variant, price_paise=109_900, mrp_paise=139_900)
    prices = {
        row.revision_id: row.price_paise
        for row in await session.scalars(select(ProductRevisionVariant))
    }
    assert prices == {live.id: 99_900, pending.id: 109_900}


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"price_paise": 0, "mrp_paise": 100}, "price_positive"),
        ({"price_paise": -5, "mrp_paise": 100}, "price_positive"),
        ({"price_paise": 1000, "mrp_paise": 999}, "mrp_at_least_price"),
    ],
)
async def test_price_and_mrp_rules(
    session: AsyncSession, changes: dict[str, int], constraint: str
) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    variant = await saved_variant(session, product)
    session.add(make_revision_variant(revision, variant, **changes))
    with pytest.raises(IntegrityError, match=f"ck_product_revision_variants_{constraint}"):
        await session.flush()


async def test_a_price_may_equal_the_mrp(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    variant = await saved_variant(session, product)
    await saved_revision_variant(session, revision, variant, price_paise=1000, mrp_paise=1000)


async def test_a_revision_variant_defaults_to_active(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    variant = await saved_variant(session, product)
    row = await saved_revision_variant(session, revision, variant)
    await session.refresh(row)
    assert row.is_active is True


async def test_a_revision_cannot_list_another_products_variant(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    one = await saved_product(session, vendor, "ONE")
    two = await saved_product(session, vendor, "TWO")
    revision = await saved_revision(session, one, user)
    foreign = await saved_variant(session, two, "TWO-M")
    session.add(make_revision_variant(revision, foreign))
    with pytest.raises(
        IntegrityError, match="fk_product_revision_variants_variant_id_product_variants"
    ):
        await session.flush()


async def test_a_variant_cannot_be_listed_twice_in_a_revision(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    variant = await saved_variant(session, product)
    await saved_revision_variant(session, revision, variant)
    session.add(make_revision_variant(revision, variant))
    with pytest.raises(IntegrityError, match="pk_product_revision_variants"):
        await session.flush()


async def test_a_variant_in_use_cannot_be_deleted(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    _, _ = await submittable_revision(session, vendor, user)
    variant = await session.scalar(select(ProductVariant))
    assert variant is not None
    with pytest.raises(IntegrityError, match="fk_product_revision_variants_variant_id"):
        await session.execute(
            text("DELETE FROM product_variants WHERE id = :id"), {"id": variant.id}
        )


# --- Images ------------------------------------------------------------------------------


async def test_images_are_ordered_and_limited_to_ten(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    for position in range(1, 11):
        asset = await saved_asset(
            session, vendor, user, public_id=f"shazlo/p-{position}", kind="product_image"
        )
        await saved_image(session, revision, asset, position)
    extra = await saved_asset(session, vendor, user, public_id="shazlo/p-11", kind="product_image")
    session.add(make_image(revision, extra, 11))
    with pytest.raises(IntegrityError, match="ck_product_images_position_range"):
        await session.flush()


@pytest.mark.parametrize("position", [0, -1, 11])
async def test_a_position_outside_one_to_ten_is_refused(
    session: AsyncSession, position: int
) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    asset = await saved_asset(session, vendor, user, kind="product_image")
    session.add(make_image(revision, asset, position))
    with pytest.raises(IntegrityError, match="ck_product_images_position_range"):
        await session.flush()


async def test_a_position_is_unique_per_revision_but_not_across(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    one = await saved_revision(session, product, user, 1)
    two = await saved_revision(session, product, user, 2)
    first = await saved_asset(session, vendor, user, public_id="shazlo/a", kind="product_image")
    second = await saved_asset(session, vendor, user, public_id="shazlo/b", kind="product_image")
    await saved_image(session, one, first, 1)
    await saved_image(session, two, first, 1)  # the same asset may be in the next revision
    session.add(make_image(one, second, 1))
    with pytest.raises(IntegrityError, match="uq_product_images_revision_id_position"):
        await session.flush()


async def test_alt_text_is_limited_to_200_characters(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    asset = await saved_asset(session, vendor, user, kind="product_image")
    await saved_image(session, revision, asset, 1, alt_text="a" * 200)
    other = await saved_asset(session, vendor, user, public_id="shazlo/b", kind="product_image")
    session.add(make_image(revision, other, 2, alt_text="a" * 201))
    with pytest.raises(DBAPIError, match="too long"):
        await session.flush()


async def test_a_product_cannot_use_another_vendors_asset(session: AsyncSession) -> None:
    first, user = await vendor_and_user(session, "first")
    second, second_user = await vendor_and_user(session, "second")
    product = await saved_product(session, first)
    revision = await saved_revision(session, product, user)
    foreign = await saved_asset(session, second, second_user, kind="product_image")
    # The image row says the revision's vendor: the asset is not theirs.
    session.add(make_image(revision, foreign, 1))
    with pytest.raises(IntegrityError, match="fk_product_images_asset_id_assets"):
        await session.flush()


async def test_an_image_cannot_claim_a_different_vendor_than_its_revision(
    session: AsyncSession,
) -> None:
    first, user = await vendor_and_user(session, "first")
    second, second_user = await vendor_and_user(session, "second")
    product = await saved_product(session, first)
    revision = await saved_revision(session, product, user)
    foreign = await saved_asset(session, second, second_user, kind="product_image")
    # Claiming the asset's vendor passes the asset check but not the revision's.
    session.add(make_image(revision, foreign, 1, vendor_id=second.id))
    with pytest.raises(IntegrityError, match="fk_product_images_revision_id_product_revisions"):
        await session.flush()


async def test_an_asset_in_use_by_an_image_cannot_be_deleted(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    await submittable_revision(session, vendor, user)
    image = await session.scalar(select(ProductImage))
    assert image is not None
    with pytest.raises(IntegrityError, match="fk_product_images_asset_id_assets"):
        await session.execute(text("DELETE FROM assets WHERE id = :id"), {"id": image.asset_id})


async def test_deleting_a_revision_removes_its_variants_and_images(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    _, revision = await submittable_revision(session, vendor, user)
    await session.execute(text("DELETE FROM product_revisions WHERE id = :id"), {"id": revision.id})
    assert await count(session, ProductRevisionVariant) == 0
    assert await count(session, ProductImage) == 0
    assert await count(session, ProductVariant) == 1  # the variant itself lives on


# --- Submitting --------------------------------------------------------------------------


async def test_a_revision_with_a_variant_and_an_image_can_be_submitted(
    session: AsyncSession,
) -> None:
    vendor, user = await vendor_and_user(session)
    _, revision = await submittable_revision(session, vendor, user)
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == revision.id).values(submitted_at=NOW)
    )
    assert (await reload(session, ProductRevision, id=revision.id)).submitted_at == NOW


async def test_a_revision_without_a_variant_cannot_be_submitted(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    asset = await saved_asset(session, vendor, user, kind="product_image")
    await saved_image(session, revision, asset)
    with pytest.raises(IntegrityError, match="at least one active variant"):
        await session.execute(
            update(ProductRevision)
            .where(ProductRevision.id == revision.id)
            .values(submitted_at=NOW)
        )


async def test_only_inactive_variants_do_not_count(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product, revision = await submittable_revision(session, vendor, user)
    await session.execute(update(ProductRevisionVariant).values(is_active=False))
    with pytest.raises(IntegrityError, match="at least one active variant"):
        await session.execute(
            update(ProductRevision)
            .where(ProductRevision.id == revision.id)
            .values(submitted_at=NOW)
        )


async def test_a_revision_without_an_image_cannot_be_submitted(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    revision = await saved_revision(session, product, user)
    variant = await saved_variant(session, product)
    await saved_revision_variant(session, revision, variant)
    with pytest.raises(IntegrityError, match="at least one image"):
        await session.execute(
            update(ProductRevision)
            .where(ProductRevision.id == revision.id)
            .values(submitted_at=NOW)
        )


async def test_a_revision_cannot_be_inserted_already_submitted(session: AsyncSession) -> None:
    vendor, user = await vendor_and_user(session)
    product = await saved_product(session, vendor)
    session.add(make_revision(product, user, submitted_at=NOW))
    with pytest.raises(IntegrityError, match="at least one active variant"):
        await session.flush()


async def test_editing_a_submitted_revision_is_refused(session: AsyncSession) -> None:
    # Was "not blocked by the submit rule": migration 0006 now freezes a submitted revision,
    # so the edit fails on that rule instead (more cases in test_integrity_hardening.py).
    vendor, user = await vendor_and_user(session)
    _, revision = await submittable_revision(session, vendor, user)
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == revision.id).values(submitted_at=NOW)
    )
    with pytest.raises(IntegrityError, match="a submitted product revision cannot be changed"):
        await session.execute(
            update(ProductRevision)
            .where(ProductRevision.id == revision.id)
            .values(submitted_at=datetime(2026, 11, 9, tzinfo=UTC), title="Renamed")
        )


# --- A live revision and a pending one together ------------------------------------------


async def test_the_schema_holds_a_live_revision_and_a_pending_one_at_once(
    session: AsyncSession,
) -> None:
    """The flow Phase 3 needs: approve a product, then edit it without touching what is live."""
    vendor, user = await vendor_and_user(session)
    product, first = await submittable_revision(session, vendor, user)

    # Submit and approve revision 1.
    await session.execute(
        update(Product).where(Product.id == product.id).values(pending_revision_id=first.id)
    )
    await session.execute(
        update(ProductRevision).where(ProductRevision.id == first.id).values(submitted_at=NOW)
    )
    await session.execute(
        update(Product)
        .where(Product.id == product.id)
        .values(
            status=ProductStatus.APPROVED,
            live_revision_id=first.id,
            pending_revision_id=None,
            version=2,
        )
    )

    # Edit it: a second revision with a new title and price; the first one stays as it was.
    second = await saved_revision(session, product, user, 2, title="Block-print kurta, new")
    variant = await session.scalar(select(ProductVariant))
    assert variant is not None
    await saved_revision_variant(session, second, variant, price_paise=109_900, mrp_paise=139_900)
    await session.execute(
        update(Product).where(Product.id == product.id).values(pending_revision_id=second.id)
    )

    stored = await reload(session, Product, id=product.id)
    assert stored.status == ProductStatus.APPROVED
    assert stored.live_revision_id == first.id
    assert stored.pending_revision_id == second.id
    live = await reload(session, ProductRevision, id=first.id)
    assert live.title == "Block-print kurta"
    prices = {
        row.revision_id: row.price_paise
        for row in await session.scalars(select(ProductRevisionVariant))
    }
    assert prices == {first.id: 99_900, second.id: 109_900}
