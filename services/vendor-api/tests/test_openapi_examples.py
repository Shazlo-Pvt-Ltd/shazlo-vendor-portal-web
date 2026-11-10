"""The OpenAPI document of the Phase 3 endpoints carries examples, and the examples are true.

An example that no longer validates is worse than none: a client author copies it. So each one
is validated against the model it documents, and every write endpoint must have one.
"""

import json
from typing import Any

import pytest
from pydantic import BaseModel

from vendor_api.api.admin_reviews import ApproveReviewRequest, RejectReviewRequest
from vendor_api.api.admin_vendors import ApproveVendorRequest, ReasonRequest
from vendor_api.api.assets import AssetOut, RegisterRequest, SignRequest, SignResponse
from vendor_api.api.brand_profile import BrandProfileBody
from vendor_api.api.product_import import ImportReportOut
from vendor_api.api.products import CreateProductBody, ProductContentBody
from vendor_api.openapi import build_openapi

REQUESTS: list[type[BaseModel]] = [
    BrandProfileBody,
    CreateProductBody,
    ProductContentBody,
    SignRequest,
    RegisterRequest,
    ApproveReviewRequest,
    RejectReviewRequest,
    ReasonRequest,
    ApproveVendorRequest,
]
RESPONSES: list[type[BaseModel]] = [SignResponse, AssetOut, ImportReportOut]

# The write endpoints of Phase 3 (the bulk import takes a file, not JSON).
PHASE_3 = (
    "/v1/vendor/brand-profile",
    "/v1/vendor/products",
    "/v1/vendor/assets",
    "/v1/admin/reviews",
    "/v1/admin/vendors",
)


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    result: dict[str, Any] = json.loads(build_openapi())
    return result


@pytest.mark.parametrize("model", [*REQUESTS, *RESPONSES], ids=lambda m: m.__name__)
def test_every_example_is_valid_for_its_model(model: type[BaseModel]) -> None:
    examples = model.model_json_schema().get("examples")
    assert examples, f"{model.__name__} has no example"
    for example in examples:
        model.model_validate(example)


def test_every_json_write_endpoint_of_phase_3_has_an_example(document: dict[str, Any]) -> None:
    checked = []
    for path, item in document["paths"].items():
        if not path.startswith(PHASE_3):
            continue
        for method, operation in item.items():
            content = operation.get("requestBody", {}).get("content", {}).get("application/json")
            if content is None:
                continue
            name = content["schema"]["$ref"].rsplit("/", 1)[1]
            schema = document["components"]["schemas"][name]
            assert schema.get("examples"), f"{method.upper()} {path} ({name}) has no example"
            checked.append((method, path))
    # The check looked at something: brand profile, products (create, update), assets (2),
    # review decisions (2) and vendor status changes (3).
    assert len(checked) >= 10, checked


def test_the_import_and_its_template_are_documented(document: dict[str, Any]) -> None:
    paths = document["paths"]
    assert "/v1/vendor/products/import" in paths
    assert "/v1/vendor/products/import/template" in paths
    body = paths["/v1/vendor/products/import"]["post"]["requestBody"]
    assert "text/csv" in body["content"]


def test_the_schemas_have_plain_names(document: dict[str, Any]) -> None:
    """Two models with one name make FastAPI qualify both with their module, which is noise in
    every client's generated code."""
    qualified = [name for name in document["components"]["schemas"] if "__" in name]
    assert qualified == []
