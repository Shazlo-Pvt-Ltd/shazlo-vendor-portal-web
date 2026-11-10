"""Cloudinary's signature and the Admin API client (no network: a mock transport answers)."""

import json
import logging
from typing import Any

import httpx
import pytest

from vendor_api.services.cloudinary import (
    CloudinaryClient,
    ImageHostError,
    delivery_url,
    sign_params,
    upload_url,
)

SECRET = "abcd"


# --- Signing -----------------------------------------------------------------------------


def test_the_signature_is_the_sorted_parameters_with_the_secret_appended() -> None:
    params = {"timestamp": "1315060510", "public_id": "sample", "overwrite": "false"}
    expected = "80c62db012da68b43cbc2c2d19955acd53ae7cf300d644783f7641370b44393c"
    assert sign_params(params, SECRET) == expected


def test_the_order_the_parameters_are_given_in_does_not_matter() -> None:
    first = sign_params({"a": "1", "b": "2", "c": "3"}, SECRET)
    assert sign_params({"c": "3", "a": "1", "b": "2"}, SECRET) == first


def test_a_changed_value_name_or_secret_changes_the_signature() -> None:
    base = {"public_id": "shazlo/vendors/1/products/x", "timestamp": "100"}
    signature = sign_params(base, SECRET)
    assert sign_params({**base, "public_id": "shazlo/vendors/2/products/x"}, SECRET) != signature
    assert sign_params({**base, "timestamp": "101"}, SECRET) != signature
    assert sign_params({**base, "extra": "x"}, SECRET) != signature
    assert sign_params(base, "other-secret") != signature


def test_the_secret_is_not_part_of_the_signature_text() -> None:
    signature = sign_params({"a": "1"}, SECRET)
    assert SECRET not in signature
    assert len(signature) == 64


def test_the_urls() -> None:
    assert upload_url("demo") == "https://api.cloudinary.com/v1_1/demo/image/upload"
    assert delivery_url("demo", "a/b/c") == "https://res.cloudinary.com/demo/image/upload/a/b/c"


# --- The Admin API client ----------------------------------------------------------------


def stored(**changes: Any) -> dict[str, Any]:
    return {
        "public_id": "shazlo/vendors/1/products/abc",
        "resource_type": "image",
        "type": "upload",
        "format": "PNG",
        "bytes": 48_211,
        "width": 800,
        "height": 600,
        "secure_url": "https://res.cloudinary.com/demo/image/upload/v1/shazlo/abc.png",
        **changes,
    }


def client(handler: Any) -> tuple[CloudinaryClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    http = httpx.AsyncClient(transport=httpx.MockTransport(record))
    return CloudinaryClient("demo", "key123", SECRET, http), seen


async def test_describe_reads_what_cloudinary_stored() -> None:
    api, seen = client(lambda _: httpx.Response(200, json=stored()))
    image = await api.describe("shazlo/vendors/1/products/abc")
    assert image is not None
    assert (image.format, image.bytes, image.width, image.height) == ("png", 48_211, 800, 600)
    assert image.secure_url.startswith("https://")
    (request,) = seen
    assert request.method == "GET"
    assert str(request.url) == (
        "https://api.cloudinary.com/v1_1/demo/resources/image/upload/shazlo/vendors/1/products/abc"
    )
    # Basic auth with the key and secret: they go in the header, never the URL.
    assert request.headers["authorization"].startswith("Basic ")
    assert SECRET not in str(request.url) and "key123" not in str(request.url)


async def test_a_missing_file_is_none_not_an_error() -> None:
    api, _ = client(
        lambda _: httpx.Response(404, json={"error": {"message": "Resource not found"}})
    )
    assert await api.describe("shazlo/x") is None


@pytest.mark.parametrize("status", [400, 401, 403, 420, 500, 503])
async def test_any_other_answer_is_an_image_host_error(
    status: int, caplog: pytest.LogCaptureFixture
) -> None:
    api, _ = client(lambda _: httpx.Response(status, json={}))
    with (
        caplog.at_level(logging.ERROR, logger="vendor_api.cloudinary"),
        pytest.raises(ImageHostError),
    ):
        await api.describe("shazlo/x")
    assert SECRET not in caplog.text


async def test_a_network_failure_is_an_image_host_error() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    api, _ = client(fail)
    with pytest.raises(ImageHostError):
        await api.describe("shazlo/x")


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"public_id": "x"},
        stored(bytes="many"),
        stored(bytes="1e1000"),
        [],
        None,
        stored(width=None),
        stored(resource_type="video"),
        stored(type="private"),
    ],
)
async def test_an_answer_that_is_not_an_uploaded_image_is_refused(body: object) -> None:
    api, _ = client(lambda _: httpx.Response(200, json=body))
    with pytest.raises(ImageHostError):
        await api.describe("shazlo/x")


async def test_an_answer_that_is_not_json_is_refused() -> None:
    api, _ = client(lambda _: httpx.Response(200, content=b"<html>oops</html>"))
    with pytest.raises(ImageHostError):
        await api.describe("shazlo/x")


async def test_delete_asks_cloudinary_to_remove_the_file() -> None:
    api, seen = client(lambda _: httpx.Response(200, json={"deleted": {"shazlo/x": "deleted"}}))
    await api.delete("shazlo/x")
    (request,) = seen
    assert request.method == "DELETE"
    assert request.url.path == "/v1_1/demo/resources/image/upload"
    assert request.url.params["public_ids[]"] == "shazlo/x"
    assert request.headers["authorization"].startswith("Basic ")


async def test_a_failed_delete_is_logged_and_never_raised(
    caplog: pytest.LogCaptureFixture,
) -> None:
    api, _ = client(lambda _: httpx.Response(500, json={}))
    with caplog.at_level(logging.WARNING, logger="vendor_api.cloudinary"):
        await api.delete("shazlo/x")

    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    broken, _ = client(fail)
    await broken.delete("shazlo/x")  # no exception
    assert "cloudinary delete" in caplog.text
    assert SECRET not in caplog.text and json.dumps(SECRET) not in caplog.text
