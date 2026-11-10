"""The ADR 0003 contract (docs/adr/0003-contract/) stays true.

Both teams build against the schemas and examples there, so a change that makes them disagree
must fail CI. These tests read the files as they are; they need no database.
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from shazlo_security.signing import sign

CONTRACT = Path(__file__).resolve().parents[3] / "docs" / "adr" / "0003-contract"
SCHEMAS = CONTRACT / "schemas"
EXAMPLES = CONTRACT / "examples"
ENVELOPE = "envelope.schema.json"


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def event_types() -> list[str]:
    return sorted(
        p.name.removesuffix(".schema.json")
        for p in SCHEMAS.glob("*.schema.json")
        if p.name != ENVELOPE
    )


def registry() -> Registry:
    """Every schema by its file name, so `$ref: envelope.schema.json` resolves offline."""
    registry: Registry = Registry()
    for path in SCHEMAS.glob("*.schema.json"):
        schema = load(path)
        resource = Resource.from_contents(schema)
        registry = registry.with_resources([(path.name, resource), (schema["$id"], resource)])
    return registry


def validator(event_type: str) -> Draft202012Validator:
    schema = load(SCHEMAS / f"{event_type}.schema.json")
    return Draft202012Validator(
        schema, registry=registry(), format_checker=Draft202012Validator.FORMAT_CHECKER
    )


def example(event_type: str) -> dict[str, Any]:
    event: dict[str, Any] = load(EXAMPLES / f"{event_type}.json")
    return event


EVENT_TYPES = event_types()


def test_the_contract_has_five_event_types() -> None:
    assert EVENT_TYPES == [
        "brand_profile.published",
        "brand_profile.unpublished",
        "product.published",
        "product.unpublished",
        "vendor.status_changed",
    ]


def test_every_event_type_has_an_example_and_the_reverse() -> None:
    assert sorted(p.name.removesuffix(".json") for p in EXAMPLES.glob("*.json")) == EVENT_TYPES


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_every_schema_is_a_valid_schema(event_type: str) -> None:
    Draft202012Validator.check_schema(load(SCHEMAS / f"{event_type}.schema.json"))


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_every_example_validates_against_its_schema(event_type: str) -> None:
    errors = sorted(validator(event_type).iter_errors(example(event_type)), key=str)
    assert not errors, [e.message for e in errors]


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_an_example_is_of_the_type_its_file_says(event_type: str) -> None:
    assert example(event_type)["type"] == event_type


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_an_example_does_not_validate_against_another_types_schema(event_type: str) -> None:
    for other in EVENT_TYPES:
        if other != event_type:
            assert not validator(other).is_valid(example(event_type)), other


def test_the_envelope_lists_the_same_types_as_the_schemas() -> None:
    envelope = load(SCHEMAS / ENVELOPE)
    assert sorted(envelope["properties"]["type"]["enum"]) == EVENT_TYPES


# --- the schemas refuse what must never be sent ------------------------------------------


def with_payload(event_type: str, **extra: Any) -> dict[str, Any]:
    event = example(event_type)
    event["payload"] = {**event["payload"], **extra}
    return event


FORBIDDEN_FIELDS = [
    "stock",
    "stock_quantity",
    "inventory",
    "quantity",
    "contact_email",
    "email",
    "phone",
    "contact_phone",
    "address",
    "owner_name",
    "discount",
    "weight",
]


@pytest.mark.parametrize("event_type", EVENT_TYPES)
@pytest.mark.parametrize("field", FORBIDDEN_FIELDS)
def test_no_payload_accepts_stock_or_contact_data(event_type: str, field: str) -> None:
    assert not validator(event_type).is_valid(with_payload(event_type, **{field: "x"}))


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_the_envelope_refuses_unknown_fields(event_type: str) -> None:
    event = example(event_type)
    event["vendor_email"] = "owner@example.com"
    assert not validator(event_type).is_valid(event)


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_the_aggregate_refuses_unknown_fields(event_type: str) -> None:
    event = example(event_type)
    event["aggregate"]["name"] = "x"
    assert not validator(event_type).is_valid(event)


@pytest.mark.parametrize("event_type", EVENT_TYPES)
@pytest.mark.parametrize(
    "field", ["event_id", "type", "version", "occurred_at", "producer", "payload"]
)
def test_the_envelope_fields_are_required(event_type: str, field: str) -> None:
    event = example(event_type)
    del event[field]
    assert not validator(event_type).is_valid(event)


@pytest.mark.parametrize("event_type", EVENT_TYPES)
@pytest.mark.parametrize("version", [0, -1, "1", 1.5])
def test_a_version_is_a_positive_integer(event_type: str, version: object) -> None:
    event = example(event_type)
    event["version"] = version
    assert not validator(event_type).is_valid(event)


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_the_producer_is_vendor_api(event_type: str) -> None:
    event = example(event_type)
    event["producer"] = "central"
    assert not validator(event_type).is_valid(event)


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_an_event_id_must_be_a_uuid(event_type: str) -> None:
    event = example(event_type)
    event["event_id"] = "not-a-uuid"
    assert not validator(event_type).is_valid(event)


@pytest.mark.parametrize("event_type", EVENT_TYPES)
def test_a_timestamp_must_be_a_date_time(event_type: str) -> None:
    event = example(event_type)
    event["occurred_at"] = "yesterday"
    assert not validator(event_type).is_valid(event)


# --- the OpenAPI file agrees with the schemas ---------------------------------------------


def openapi() -> dict[str, Any]:
    document: dict[str, Any] = yaml.safe_load(
        (CONTRACT / "openapi.yaml").read_text(encoding="utf-8")
    )
    return document


def test_openapi_accepts_exactly_the_schemas_event_types() -> None:
    body = openapi()["paths"]["/internal/v1/events"]["post"]["requestBody"]["content"]
    refs = [item["$ref"] for item in body["application/json"]["schema"]["oneOf"]]
    assert sorted(re.sub(r"^.*/(.+)\.schema\.json$", r"\1", ref) for ref in refs) == EVENT_TYPES
    for ref in refs:
        assert (CONTRACT / ref).is_file(), ref


def test_openapi_reconciles_the_same_aggregates_the_envelope_has() -> None:
    parameters = openapi()["paths"]["/internal/v1/versions"]["get"]["parameters"]
    aggregate_type = next(p for p in parameters if p.get("name") == "aggregate_type")
    envelope = load(SCHEMAS / ENVELOPE)
    assert sorted(aggregate_type["schema"]["enum"]) == sorted(
        envelope["properties"]["aggregate"]["properties"]["type"]["enum"]
    )


# --- the signing test vector in the README is reproduced by the signing code --------------

README = (CONTRACT / "README.md").read_text(encoding="utf-8")


def vector() -> tuple[bytes, int, bytes, str]:
    block = README.split("### Worked example (test vector)", 1)[1].split("```", 2)[1]
    secret = re.search(r"^secret:\s+(\S+)$", block, re.MULTILINE)
    timestamp = re.search(r"^timestamp:\s+(\d+)$", block, re.MULTILINE)
    body = re.search(r"^body \((\d+) bytes, exactly\):\n(\{.*\})$", block, re.MULTILINE)
    signature = re.search(r"^signature:\s+(v1=[0-9a-f]{64})$", block, re.MULTILINE)
    assert secret and timestamp and body and signature
    raw = body.group(2).encode()
    assert len(raw) == int(body.group(1))
    return secret.group(1).encode(), int(timestamp.group(1)), raw, signature.group(1)


def test_the_readmes_test_vector_is_reproduced_by_the_signing_code() -> None:
    secret, timestamp, body, signature = vector()
    assert sign(secret, timestamp, body) == signature


def test_the_readmes_test_vector_body_is_a_valid_event() -> None:
    _, _, body, _ = vector()
    event = json.loads(body)
    assert validator(event["type"]).is_valid(event)
