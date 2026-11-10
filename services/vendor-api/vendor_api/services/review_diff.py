"""The field-level difference between two versions of a brand profile or a product.

A reviewer needs to see what a vendor changed, not the whole page again. Each function takes the
content of the version under review and of the version before it (None for a first submission)
and returns **exactly the fields that differ**, in a stable order: the fields of the content in
their natural order, then variants by SKU, then images by position. A field that is the same in
both versions is never listed, and `None` and an empty list count as the same "nothing".

Values are plain JSON (text, numbers, booleans, lists, small objects), because they go straight
into the API's answer.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

BRAND_FIELDS = (
    "brand_name",
    "tagline",
    "about",
    "logo",
    "banner",
    "website_url",
    "instagram_handle",
    "categories",
    "price_min_paise",
    "price_max_paise",
)
PRODUCT_FIELDS = (
    "title",
    "description",
    "category",
    "subcategory",
    "gender",
    "fabric",
    "weight_grams",
    "returnable",
    "return_window_days",
)
VARIANT_FIELDS = ("size", "color", "price_paise", "mrp_paise", "is_active")


@dataclass(frozen=True)
class Change:
    field: str
    before: Any
    after: Any


def _empty(value: object) -> bool:
    return value is None or value == [] or value == {}


def _same(before: object, after: object) -> bool:
    return before == after or (_empty(before) and _empty(after))


def diff_fields(
    before: Mapping[str, Any] | None, after: Mapping[str, Any], fields: Sequence[str]
) -> list[Change]:
    """The listed fields whose value differs. With no `before`, every field that has a value."""
    old = before or {}
    return [
        Change(name, old.get(name), after.get(name))
        for name in fields
        if not _same(old.get(name), after.get(name))
    ]


def diff_brand_profile(before: Mapping[str, Any] | None, after: Mapping[str, Any]) -> list[Change]:
    return diff_fields(before, after, BRAND_FIELDS)


def diff_product(before: Mapping[str, Any] | None, after: Mapping[str, Any]) -> list[Change]:
    """Product details, then each variant (a whole variant added or removed, or the fields of one
    that changed, named `variants[<sku>].<field>`), then each image by position."""
    changes = diff_fields(before, after, PRODUCT_FIELDS)
    old = before or {}
    changes += _diff_variants(old.get("variants") or [], after.get("variants") or [])
    changes += _diff_images(old.get("images") or [], after.get("images") or [])
    return changes


def _diff_variants(
    before: Sequence[Mapping[str, Any]], after: Sequence[Mapping[str, Any]]
) -> list[Change]:
    old = {v["sku"].lower(): v for v in before}
    new = {v["sku"].lower(): v for v in after}
    changes: list[Change] = []
    for key in sorted(old.keys() | new.keys()):
        was, now = old.get(key), new.get(key)
        sku = (now or was or {}).get("sku", key)
        if was is None:
            changes.append(Change(f"variants[{sku}]", None, dict(now or {})))
        elif now is None:
            changes.append(Change(f"variants[{sku}]", dict(was), None))
        else:
            changes += [
                Change(f"variants[{sku}].{c.field}", c.before, c.after)
                for c in diff_fields(was, now, VARIANT_FIELDS)
            ]
    return changes


def _diff_images(
    before: Sequence[Mapping[str, Any]], after: Sequence[Mapping[str, Any]]
) -> list[Change]:
    old = {i["position"]: i for i in before}
    new = {i["position"]: i for i in after}
    changes: list[Change] = []
    for position in sorted(old.keys() | new.keys()):
        was, now = old.get(position), new.get(position)
        if was is None or now is None or _image_key(was) != _image_key(now):
            changes.append(
                Change(
                    f"images[{position}]",
                    None if was is None else dict(was),
                    None if now is None else dict(now),
                )
            )
    return changes


def _image_key(image: Mapping[str, Any]) -> tuple[object, object]:
    # The same picture with the same caption: the URL follows from the asset.
    return image.get("asset_id"), image.get("alt_text")
