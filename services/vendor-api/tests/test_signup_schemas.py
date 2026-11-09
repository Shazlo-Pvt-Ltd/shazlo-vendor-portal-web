from typing import Any

import pytest
from pydantic import ValidationError

from vendor_api.api.auth import ResendRequest, SignupRequest, VerifyEmailRequest

VALID: dict[str, Any] = {
    "brand_name": "Atelier Rouge",
    "contact_name": "Asha Rao",
    "email": "Asha@Atelier.test",
    "phone": "+91 98765 43210",
    "product_type": "apparel",
    "price_min_paise": 99_900,
    "price_max_paise": 499_900,
    "password": "correct horse battery",
    "terms_accepted": True,
}


def make(**changes: Any) -> SignupRequest:
    return SignupRequest.model_validate({**VALID, **changes})


def test_a_valid_request_is_accepted_and_trimmed() -> None:
    request = make(brand_name="  Atelier Rouge  ", email="  asha@atelier.test ")
    assert request.brand_name == "Atelier Rouge"
    assert request.email == "asha@atelier.test"
    assert request.website_or_instagram is None


def test_the_password_is_never_trimmed() -> None:
    assert make(password="  spaced out pass  ").password == "  spaced out pass  "


def test_a_blank_website_is_none() -> None:
    assert make(website_or_instagram="   ").website_or_instagram is None
    assert make(website_or_instagram="@atelier").website_or_instagram == "@atelier"


@pytest.mark.parametrize(
    "changes",
    [
        {"brand_name": ""},
        {"brand_name": "   "},
        {"brand_name": "x" * 201},
        {"contact_name": ""},
        {"email": "no-at-sign"},
        {"email": "a@b"},
        {"email": "a b@c.test"},
        {"email": "ünï@brand.test"},
        {"email": "a@" + "b" * 330 + ".test"},
        {"phone": "abc"},
        {"phone": "12"},
        {"phone": "+9" + "1" * 30 + "0"},  # 33 characters: the column holds 32
        {"contact_name": "Asha\u0000Rao"},
        {"brand_name": "Atelier\ud800"},
        {"product_type": "apparel\x07"},
        {"website_or_instagram": "insta\u0000gram"},
        {"email": "official.brand.test<me@evil.test>"},
        {"email": "victim@corp.test,x@y.test"},
        {"email": '"quoted"@brand.test'},
        {"email": "a..b@brand.test"},
        {"email": "a@-brand.test"},
        {"phone": "+91 98765 43210; DROP"},
        {"product_type": ""},
        {"price_min_paise": -1},
        {"price_max_paise": 10**12 + 1},
        {"price_min_paise": 500, "price_max_paise": 499},
        {"price_min_paise": 1.5},
        {"password": ""},
        {"password": "x" * 129},
        {"terms_accepted": "maybe"},
        {"unexpected": "field"},
    ],
    ids=str,
)
def test_invalid_requests_are_refused(changes: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        make(**changes)


@pytest.mark.parametrize("missing", sorted(set(VALID)))
def test_every_field_is_required(missing: str) -> None:
    values = {key: value for key, value in VALID.items() if key != missing}
    with pytest.raises(ValidationError):
        SignupRequest.model_validate(values)


def test_equal_prices_are_a_valid_range() -> None:
    assert make(price_min_paise=1000, price_max_paise=1000).price_max_paise == 1000


def test_terms_accepted_false_still_parses() -> None:
    # The route answers it with its own `terms_not_accepted` error.
    assert make(terms_accepted=False).terms_accepted is False


def test_the_other_requests_are_strict() -> None:
    with pytest.raises(ValidationError):
        VerifyEmailRequest.model_validate({"token": ""})
    with pytest.raises(ValidationError):
        VerifyEmailRequest.model_validate({"token": "a", "extra": 1})
    with pytest.raises(ValidationError):
        ResendRequest.model_validate({"email": "nope"})
    assert ResendRequest.model_validate({"email": " A@b.test "}).email == "A@b.test"
