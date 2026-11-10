"""The receiver's rules (ADR 0003), one test each, and every example of the contract."""

import copy
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from shazlo_security.signing import SigningKey
from support import NOW, OTHER_SECRET, Sender

from central_stub.app import create_app
from central_stub.settings import DEFAULT_CONTRACT_DIR, Settings

Example = Callable[[str], dict[str, Any]]
NAMES = sorted(p.stem for p in (DEFAULT_CONTRACT_DIR / "examples").glob("*.json"))


def changed(event: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """A copy with a new event id and the given top-level fields."""
    return {**copy.deepcopy(event), "event_id": str(uuid.uuid4()), **changes}


def state(sender: Sender) -> dict[str, Any]:
    body: dict[str, Any] = sender.client.get("/_stub/state").json()
    return body


# --- accepted -----------------------------------------------------------------------------


@pytest.mark.parametrize("name", NAMES)
def test_every_example_of_the_contract_is_accepted(
    name: str, sender: Sender, example: Example
) -> None:
    event = example(name)
    response = sender.post(event)
    assert response.status_code == 200, response.text
    assert response.json() == {"event_id": event["event_id"], "status": "accepted"}


def test_there_are_examples_to_test() -> None:
    assert len(NAMES) == 5


def test_a_replay_is_a_duplicate_and_changes_nothing(sender: Sender, example: Example) -> None:
    event = example("product.published")
    assert sender.post(event).json()["status"] == "accepted"
    again = sender.post(event)
    assert again.status_code == 200
    assert again.json() == {"event_id": event["event_id"], "status": "duplicate"}
    assert state(sender)["events_received"] == 1


def test_the_same_event_id_with_another_body_is_a_conflict(
    sender: Sender, example: Example
) -> None:
    event = example("product.published")
    sender.post(event)
    other = {**event, "version": event["version"] + 1}
    response = sender.post(other)
    assert response.status_code == 409
    assert response.json()["extra"]["code"] == "event_id_conflict"


def test_an_old_version_is_stale(sender: Sender, example: Example) -> None:
    event = example("product.published")
    sender.post(event)
    older = changed(event, version=event["version"] - 1)
    response = sender.post(older)
    assert response.status_code == 200
    assert response.json()["status"] == "stale"
    # The same version again is not higher, so it is stale too.
    assert sender.post(changed(event)).json()["status"] == "stale"


def test_a_higher_version_replaces_what_is_held(sender: Sender, example: Example) -> None:
    published = example("product.published")
    sender.post(published)
    unpublished = changed(example("product.unpublished"), version=published["version"] + 1)
    unpublished["aggregate"] = published["aggregate"]
    unpublished["payload"] = {**unpublished["payload"], "product_id": published["aggregate"]["id"]}
    assert sender.post(unpublished).json()["status"] == "accepted"
    items = sender.versions(aggregate_type="product").json()["items"]
    assert items == [
        {
            "aggregate_id": published["aggregate"]["id"],
            "version": published["version"] + 1,
            "state": "unpublished",
        }
    ]


# --- refused before anything is parsed -------------------------------------------------------


def test_a_tampered_body_is_refused(sender: Sender, example: Example) -> None:
    event = example("product.published")
    body = b'{"event_id":"' + event["event_id"].encode() + b'"}'
    headers = sender.headers(b"{}")  # signed for another body
    response = sender.client.post(
        "/internal/v1/events",
        content=body,
        headers={"Idempotency-Key": event["event_id"], **headers},
    )
    assert response.status_code == 401
    assert response.json()["extra"]["code"] == "bad_signature"


def test_the_signature_is_checked_before_the_body_is_parsed(sender: Sender) -> None:
    # Not JSON at all: a 401, not a 422, because the signature comes first.
    response = sender.client.post(
        "/internal/v1/events", content=b"not json", headers=sender.headers(b"different")
    )
    assert response.status_code == 401


def test_an_unsigned_request_is_refused(sender: Sender, example: Example) -> None:
    response = sender.client.post("/internal/v1/events", json=example("product.published"))
    assert response.status_code == 401
    assert response.json()["extra"]["code"] == "malformed_signature"


def test_an_unknown_key_is_refused(sender: Sender, example: Example) -> None:
    stranger = SigningKey("k9", b"x" * 40)
    response = sender.post(example("product.published"), key=stranger)
    assert response.status_code == 401
    assert response.json()["extra"]["code"] == "unknown_key"


def test_either_active_key_is_accepted(sender: Sender, example: Example) -> None:
    second = SigningKey("k2", OTHER_SECRET)
    assert sender.post(example("product.published"), key=second).status_code == 200


@pytest.mark.parametrize("offset", [61, -61, 3600])
def test_a_timestamp_more_than_sixty_seconds_off_is_refused(
    offset: int, sender: Sender, example: Example
) -> None:
    sender.now = NOW + offset
    response = sender.post(example("product.published"))
    assert response.status_code == 401
    assert response.json()["extra"]["code"] == "stale_timestamp"


@pytest.mark.parametrize("offset", [60, -60])
def test_sixty_seconds_off_is_still_accepted(offset: int, sender: Sender, example: Example) -> None:
    sender.now = NOW + offset
    assert sender.post(example("product.published")).status_code == 200


def test_a_body_over_256_kb_is_refused(sender: Sender) -> None:
    response = sender.post(b'{"x":"' + b"a" * (256 * 1024) + b'"}')
    assert response.status_code == 413
    assert response.json()["extra"]["code"] == "payload_too_large"


def test_a_body_of_exactly_256_kb_is_not_too_large(sender: Sender) -> None:
    body = b'{"x":"' + b"a" * (256 * 1024 - 8) + b'"}'
    assert len(body) == 256 * 1024
    assert sender.post(body).status_code == 422  # too big would be 413; this fails the schema


# --- validated against the schemas --------------------------------------------------------


def test_invalid_json_is_a_422(sender: Sender) -> None:
    assert sender.post(b"{nope").status_code == 422


def test_an_unknown_event_type_is_a_422(sender: Sender, example: Example) -> None:
    response = sender.post(changed(example("product.published"), type="product.deleted"))
    assert response.status_code == 422
    assert "type" in response.json()["extra"]["fields"]


@pytest.mark.parametrize("field", ["stock", "email", "phone", "discount", "weight"])
def test_an_unknown_payload_field_is_a_422(field: str, sender: Sender, example: Example) -> None:
    event = example("product.published")
    event["payload"][field] = 5
    response = sender.post(event)
    assert response.status_code == 422
    assert response.json()["extra"]["code"] == "schema_invalid"
    assert response.json()["extra"]["fields"]


def test_an_unknown_envelope_field_is_a_422(sender: Sender, example: Example) -> None:
    assert sender.post({**example("product.published"), "vendor_email": "a@b.c"}).status_code == 422


def test_the_idempotency_key_must_match_the_event_id(sender: Sender, example: Example) -> None:
    response = sender.post(example("product.published"), idempotency_key=str(uuid.uuid4()))
    assert response.status_code == 422
    assert response.json()["extra"]["code"] == "idempotency_key_mismatch"


def test_a_refused_event_is_not_remembered(sender: Sender, example: Example) -> None:
    bad = example("product.published")
    bad["payload"]["stock"] = 1
    sender.post(bad)
    assert state(sender)["events_received"] == 0


# --- reconciliation --------------------------------------------------------------------------


def test_versions_need_a_signature(client: TestClient) -> None:
    assert client.get("/internal/v1/versions?aggregate_type=product").status_code == 401


def test_versions_reject_a_bad_query(sender: Sender) -> None:
    assert sender.versions(aggregate_type="order").status_code == 422
    assert sender.versions(aggregate_type="product", limit="0").status_code == 422
    assert sender.versions(aggregate_type="product", limit="501").status_code == 422
    assert sender.versions().status_code == 422


def test_versions_are_paged(sender: Sender, example: Example) -> None:
    ids = sorted(str(uuid.uuid4()) for _ in range(5))
    for aggregate_id in ids:
        event = changed(example("product.published"))
        event["aggregate"]["id"] = aggregate_id
        event["payload"]["product_id"] = aggregate_id
        assert sender.post(event).status_code == 200
    first = sender.versions(aggregate_type="product", limit="2").json()
    assert [i["aggregate_id"] for i in first["items"]] == ids[:2]
    assert first["next_cursor"] == ids[1]
    seen = [i["aggregate_id"] for i in first["items"]]
    cursor = first["next_cursor"]
    while cursor:
        page = sender.versions(aggregate_type="product", limit="2", cursor=cursor).json()
        seen += [i["aggregate_id"] for i in page["items"]]
        cursor = page["next_cursor"]
    assert seen == ids


def test_a_vendor_is_published_only_while_approved(sender: Sender, example: Example) -> None:
    event = example("vendor.status_changed")  # the example is a suspension
    sender.post(event)
    state_now = sender.versions(aggregate_type="vendor").json()["items"][0]["state"]
    assert state_now == "unpublished"
    approved = changed(event, version=event["version"] + 1)
    approved["payload"] = {**event["payload"], "status": "approved"}
    sender.post(approved)
    assert sender.versions(aggregate_type="vendor").json()["items"][0]["state"] == "published"


# --- misbehaviour on purpose -----------------------------------------------------------------


def set_mode(sender: Sender, **body: Any) -> Any:
    return sender.client.put("/_stub/mode", json=body)


def test_it_answers_500_on_request(sender: Sender, example: Example) -> None:
    set_mode(sender, mode="error_500")
    assert sender.post(example("product.published")).status_code == 500
    assert sender.versions(aggregate_type="product").status_code == 500


def test_it_answers_429_with_retry_after(sender: Sender, example: Example) -> None:
    set_mode(sender, mode="rate_limited")
    response = sender.post(example("product.published"))
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "30"


def test_it_refuses_the_signature_on_request(sender: Sender, example: Example) -> None:
    set_mode(sender, mode="unauthorized")
    assert sender.post(example("product.published")).status_code == 401


def test_it_can_time_out(sender: Sender, example: Example) -> None:
    set_mode(sender, mode="timeout")
    # The wait is 0.05 s in these tests; the default is 120 s, longer than any client's timeout.
    response = sender.post(example("product.published"))
    assert response.status_code == 200  # after the wait it answers normally
    assert response.json()["status"] == "accepted"


def test_a_counted_failure_ends_by_itself(sender: Sender, example: Example) -> None:
    set_mode(sender, mode="error_500", remaining=2)
    event = example("product.published")
    assert [sender.post(event).status_code for _ in range(3)] == [500, 500, 200]
    assert state(sender)["behaviour"]["mode"] == "ok"


def test_a_failed_attempt_stores_nothing(sender: Sender, example: Example) -> None:
    set_mode(sender, mode="error_500", remaining=1)
    sender.post(example("product.published"))
    assert state(sender)["events_received"] == 0


def test_the_mode_endpoint_validates(sender: Sender) -> None:
    assert set_mode(sender, mode="explode").status_code == 422
    assert set_mode(sender, mode="error_500", remaining=0).status_code == 422
    assert set_mode(sender, mode="error_500", remaining=True).status_code == 422
    assert sender.client.put("/_stub/mode", content=b"nope").status_code == 422


def test_reset_forgets_everything(sender: Sender, example: Example) -> None:
    sender.post(example("product.published"))
    set_mode(sender, mode="error_500")
    sender.client.post("/_stub/reset")
    now = state(sender)
    assert now["events_received"] == 0
    assert now["held"] == []
    assert now["behaviour"]["mode"] == "ok"


def test_the_starting_mode_comes_from_the_settings(settings: Settings, example: Example) -> None:
    failing = settings.model_copy(update={"stub_mode": "error_500"})
    other = Sender(TestClient(create_app(failing, lambda: NOW)))
    assert other.post(example("product.published")).status_code == 500


# --- what a developer sees ------------------------------------------------------------------


def test_the_page_shows_what_was_approved(sender: Sender, example: Example) -> None:
    event = example("brand_profile.published")
    sender.post(event)
    page = sender.client.get("/")
    assert page.status_code == 200
    assert event["aggregate"]["id"] in page.text
    assert "Brand pages (1)" in page.text


def test_the_page_escapes_what_it_shows(sender: Sender, example: Example) -> None:
    event = example("brand_profile.published")
    event["payload"]["display_name"] = "<script>alert(1)</script>"
    sender.post(event)
    assert "<script>alert(1)" not in sender.client.get("/").text


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
