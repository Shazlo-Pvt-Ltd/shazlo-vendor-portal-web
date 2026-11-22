"""Money in request bodies is integer paise and nothing else.

Every amount a vendor sends (a variant's price and MRP, a brand's and a signup's price range) is
checked here at the model, the way FastAPI validates a JSON body, so these run without a
database. A JSON `true` must never become a price of one paise, nor `false` a minimum of zero;
a string or a float is a client bug that must be refused, not guessed at.
"""

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from vendor_api.api.auth import SignupRequest
from vendor_api.api.brand_profile import BrandProfileBody
from vendor_api.api.products import MAX_PAISE, VariantBody

NOT_PAISE: list[Any] = [True, False, "149900", 149900.0, 1499.5, None, [149900]]
NOT_PAISE_IDS = ["true", "false", "string", "whole-float", "fraction", "null", "list"]

SIGNUP: dict[str, Any] = {
    "brand_name": "Atelier Rouge",
    "contact_name": "Asha Rao",
    "email": "asha@atelier.test",
    "phone": "+91 98765 43210",
    "product_type": "apparel",
    "price_min_paise": 99_900,
    "price_max_paise": 499_900,
    "password": "correct horse battery",
    "terms_accepted": True,
}
BRAND: dict[str, Any] = {"brand_name": "Atelier", "price_min_paise": 0, "price_max_paise": 99_900}
VARIANT: dict[str, Any] = {"sku": "KURTA-01-M", "price_paise": 149_900, "mrp_paise": 199_900}

CASES: list[tuple[type[BaseModel], dict[str, Any], str]] = [
    (VariantBody, VARIANT, "price_paise"),
    (VariantBody, VARIANT, "mrp_paise"),
    (BrandProfileBody, BRAND, "price_min_paise"),
    (BrandProfileBody, BRAND, "price_max_paise"),
    (SignupRequest, SIGNUP, "price_min_paise"),
    (SignupRequest, SIGNUP, "price_max_paise"),
]
CASE_IDS = [f"{model.__name__}.{field}" for model, _, field in CASES]


@pytest.mark.parametrize(("model", "valid", "field"), CASES, ids=CASE_IDS)
def test_the_valid_bodies_are_accepted(
    model: type[BaseModel], valid: dict[str, Any], field: str
) -> None:
    assert getattr(model.model_validate(valid), field) == valid[field]


@pytest.mark.parametrize(("model", "valid", "field"), CASES, ids=CASE_IDS)
@pytest.mark.parametrize("amount", NOT_PAISE, ids=NOT_PAISE_IDS)
def test_an_amount_that_is_not_an_integer_is_refused(
    model: type[BaseModel], valid: dict[str, Any], field: str, amount: Any
) -> None:
    with pytest.raises(ValidationError) as error:
        model.model_validate({**valid, field: amount})
    assert any(e["loc"][-1] == field for e in error.value.errors())


@pytest.mark.parametrize(("model", "valid", "field"), CASES, ids=CASE_IDS)
def test_an_amount_over_the_cap_is_refused(
    model: type[BaseModel], valid: dict[str, Any], field: str
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate({**valid, field: MAX_PAISE + 1})


@pytest.mark.parametrize("field", ["price_paise", "mrp_paise"])
def test_a_variant_costs_at_least_one_paise(field: str) -> None:
    with pytest.raises(ValidationError):
        VariantBody.model_validate({**VARIANT, field: 0})
    assert VariantBody.model_validate({**VARIANT, "price_paise": 1, "mrp_paise": 1})


def test_the_mrp_may_equal_the_price_but_never_be_below_it() -> None:
    assert VariantBody.model_validate({**VARIANT, "mrp_paise": 149_900}).mrp_paise == 149_900
    with pytest.raises(ValidationError, match="mrp_paise must not be below price_paise"):
        VariantBody.model_validate({**VARIANT, "mrp_paise": 149_899})


@pytest.mark.parametrize("model", [BrandProfileBody, SignupRequest])
def test_a_price_range_is_never_upside_down(model: type[BaseModel]) -> None:
    valid = BRAND if model is BrandProfileBody else SIGNUP
    assert model.model_validate({**valid, "price_min_paise": 5, "price_max_paise": 5})
    with pytest.raises(ValidationError, match="price_max_paise must not be below"):
        model.model_validate({**valid, "price_min_paise": 6, "price_max_paise": 5})
