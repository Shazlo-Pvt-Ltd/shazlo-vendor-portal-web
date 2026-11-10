"""The field-level diff a reviewer sees. Pure functions: no database, no HTTP.

The promise is "the diff shows exactly the fields that changed": nothing that is the same is
listed, and nothing that differs is left out.
"""

from copy import deepcopy
from typing import Any

import pytest

from vendor_api.services.review_diff import (
    BRAND_FIELDS,
    PRODUCT_FIELDS,
    Change,
    diff_brand_profile,
    diff_fields,
    diff_product,
)


def brand(**changes: Any) -> dict[str, Any]:
    content: dict[str, Any] = {
        "brand_name": "Atelier Rao",
        "tagline": "Block prints, made slowly",
        "about": "A small studio in Jaipur.",
        "logo": {"asset_id": "logo-1", "url": "https://res.example/logo-1.png"},
        "banner": None,
        "website_url": "https://atelier.example",
        "instagram_handle": "atelier.rao",
        "categories": ["kurtas", "dupattas"],
        "price_min_paise": 99_900,
        "price_max_paise": 999_900,
    }
    return {**content, **changes}


def variant(sku: str = "KURTA-M", **changes: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "sku": sku,
        "size": "M",
        "color": "indigo",
        "price_paise": 99_900,
        "mrp_paise": 129_900,
        "is_active": True,
    }
    return {**values, **changes}


def image(position: int = 1, asset: str = "a1", alt: str | None = "Front") -> dict[str, Any]:
    return {
        "position": position,
        "asset_id": asset,
        "url": f"https://res.example/{asset}.png",
        "alt_text": alt,
    }


def product(**changes: Any) -> dict[str, Any]:
    content: dict[str, Any] = {
        "title": "Block-print kurta",
        "description": "Hand block printed.",
        "category": "kurtas",
        "subcategory": None,
        "gender": "women",
        "fabric": "cotton",
        "weight_grams": 350,
        "returnable": True,
        "return_window_days": 7,
        "variants": [variant()],
        "images": [image()],
    }
    return {**content, **changes}


def names(changes: list[Change]) -> list[str]:
    return [c.field for c in changes]


# --- Brand profile -----------------------------------------------------------------------


def test_identical_versions_have_no_changes() -> None:
    assert diff_brand_profile(brand(), brand()) == []
    assert diff_product(product(), product()) == []


def test_only_the_fields_that_changed_are_listed_with_before_and_after() -> None:
    changes = diff_brand_profile(brand(), brand(tagline="New tagline", price_max_paise=1_500_000))
    assert changes == [
        Change("tagline", "Block prints, made slowly", "New tagline"),
        Change("price_max_paise", 999_900, 1_500_000),
    ]


@pytest.mark.parametrize("name", BRAND_FIELDS)
def test_changing_any_one_brand_field_lists_exactly_that_field(name: str) -> None:
    after = deepcopy(brand())
    after[name] = (
        {"asset_id": "other", "url": "u"}
        if name in {"logo", "banner"}
        else (["kurtas"] if name == "categories" else (1 if name.endswith("paise") else "changed"))
    )
    changes = diff_brand_profile(brand(), after)
    assert names(changes) == [name]
    assert changes[0].before == brand()[name] and changes[0].after == after[name]


def test_fields_come_in_the_order_of_the_content_not_the_order_they_changed() -> None:
    changes = diff_brand_profile(
        brand(), brand(price_min_paise=1, brand_name="Z", categories=["x"])
    )
    assert names(changes) == ["brand_name", "categories", "price_min_paise"]


def test_a_first_submission_lists_every_field_that_has_a_value() -> None:
    changes = diff_brand_profile(None, brand(about=None, instagram_handle=None, categories=[]))
    assert names(changes) == [
        "brand_name",
        "tagline",
        "logo",
        "website_url",
        "price_min_paise",
        "price_max_paise",
    ]
    assert all(c.before is None for c in changes)


def test_nothing_and_an_empty_list_are_the_same_but_empty_text_is_not_nothing() -> None:
    assert diff_brand_profile(brand(categories=[]), brand(categories=None)) == []
    assert diff_brand_profile(brand(banner=None), brand(banner={})) == []
    assert names(diff_brand_profile(brand(tagline=None), brand(tagline=""))) == ["tagline"]


def test_a_removed_value_is_a_change_to_nothing() -> None:
    assert diff_brand_profile(brand(), brand(tagline=None)) == [
        Change("tagline", "Block prints, made slowly", None)
    ]


def test_a_list_that_differs_in_content_or_order_is_a_change() -> None:
    assert names(diff_brand_profile(brand(), brand(categories=["kurtas"]))) == ["categories"]
    assert names(diff_brand_profile(brand(), brand(categories=["dupattas", "kurtas"]))) == [
        "categories"
    ]


def test_fields_missing_from_both_are_ignored_and_extra_content_is_not_diffed() -> None:
    assert diff_fields({"a": 1}, {"a": 1, "b": 2}, ["a", "c"]) == []
    assert diff_brand_profile(brand(), {**brand(), "unlisted": "x"}) == []


# --- Product -----------------------------------------------------------------------------


@pytest.mark.parametrize("name", PRODUCT_FIELDS)
def test_changing_any_one_product_field_lists_exactly_that_field(name: str) -> None:
    after = product()
    after[name] = {"weight_grams": 400, "returnable": False, "return_window_days": 14}.get(
        name, "changed"
    )
    assert names(diff_product(product(), after)) == [name]


def test_a_changed_variant_lists_the_changed_fields_only() -> None:
    before = product(variants=[variant(), variant("KURTA-L", size="L")])
    after = product(
        variants=[variant(price_paise=89_900), variant("KURTA-L", size="L", is_active=False)]
    )
    assert diff_product(before, after) == [
        Change("variants[KURTA-L].is_active", True, False),
        Change("variants[KURTA-M].price_paise", 99_900, 89_900),
    ]


def test_an_added_and_a_removed_variant_are_listed_whole() -> None:
    before = product(variants=[variant("KURTA-M"), variant("KURTA-S", size="S")])
    after = product(variants=[variant("KURTA-M"), variant("KURTA-L", size="L")])
    changes = diff_product(before, after)
    assert [c.field for c in changes] == ["variants[KURTA-L]", "variants[KURTA-S]"]
    assert changes[0].before is None and changes[0].after["size"] == "L"
    assert changes[1].after is None and changes[1].before["size"] == "S"


def test_variants_are_matched_by_sku_ignoring_case_and_order() -> None:
    before = product(variants=[variant("KURTA-M"), variant("KURTA-L", size="L")])
    after = product(variants=[variant("kurta-l", size="L"), variant("kurta-m")])
    assert diff_product(before, after) == []


def test_a_replaced_image_is_listed_by_position_with_both_pictures() -> None:
    changes = diff_product(
        product(images=[image(1, "a1"), image(2, "a2")]),
        product(images=[image(1, "a1"), image(2, "a3")]),
    )
    assert names(changes) == ["images[2]"]
    assert changes[0].before["asset_id"] == "a2" and changes[0].after["asset_id"] == "a3"


def test_a_changed_caption_is_a_change_but_a_changed_url_for_the_same_asset_is_not() -> None:
    assert names(diff_product(product(), product(images=[image(alt="Back")]))) == ["images[1]"]
    moved = image()
    moved["url"] = "https://cdn.example/a1.png"
    assert diff_product(product(), product(images=[moved])) == []


def test_images_added_and_removed() -> None:
    changes = diff_product(product(images=[image(1)]), product(images=[image(1), image(2, "a2")]))
    assert names(changes) == ["images[2]"] and changes[0].before is None
    changes = diff_product(product(images=[image(1), image(2, "a2")]), product(images=[image(1)]))
    assert names(changes) == ["images[2]"] and changes[0].after is None


def test_reordering_images_changes_the_positions_that_moved() -> None:
    changes = diff_product(
        product(images=[image(1, "a1"), image(2, "a2")]),
        product(images=[image(1, "a2"), image(2, "a1")]),
    )
    assert names(changes) == ["images[1]", "images[2]"]


def test_details_variants_and_images_come_in_that_order() -> None:
    changes = diff_product(
        product(),
        product(title="New", variants=[variant(price_paise=1)], images=[image(asset="zz")]),
    )
    assert names(changes) == ["title", "variants[KURTA-M].price_paise", "images[1]"]


def test_a_first_submission_of_a_product_lists_everything_that_has_a_value() -> None:
    changes = diff_product(None, product(subcategory=None))
    assert names(changes) == [
        "title",
        "description",
        "category",
        "gender",
        "fabric",
        "weight_grams",
        "returnable",
        "return_window_days",
        "variants[KURTA-M]",
        "images[1]",
    ]


def test_false_and_zero_are_values_not_nothing() -> None:
    assert names(diff_product(product(returnable=True), product(returnable=False))) == [
        "returnable"
    ]
    assert names(diff_product(product(return_window_days=7), product(return_window_days=0))) == [
        "return_window_days"
    ]
    assert names(diff_product(None, product(returnable=False, return_window_days=0))) == [
        "title",
        "description",
        "category",
        "gender",
        "fabric",
        "weight_grams",
        "returnable",
        "return_window_days",
        "variants[KURTA-M]",
        "images[1]",
    ]


def test_the_inputs_are_not_changed() -> None:
    before, after = product(), product(title="New", variants=[variant(price_paise=1)])
    snapshot = (deepcopy(before), deepcopy(after))
    diff_product(before, after)
    assert (before, after) == snapshot
