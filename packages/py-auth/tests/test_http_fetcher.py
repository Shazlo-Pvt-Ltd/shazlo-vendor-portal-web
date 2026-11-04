"""The real fetch path: `http_fetcher` and `JwksClient.from_url`, over `httpx.MockTransport`."""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from shazlo_auth import JwksClient, JwksError
from shazlo_auth.jwks import MAX_RESPONSE_BYTES, http_fetcher
from tests.helpers import jwk_of

URL = "https://identity.example/.well-known/jwks.json"
Handler = Callable[[httpx.Request], Coroutine[Any, Any, httpx.Response]]


def transport(handler: Handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def jwks_body(private_keys: dict[str, rsa.RSAPrivateKey]) -> dict[str, Any]:
    return {"keys": [jwk_of("key-1", private_keys["key-1"])]}


# --- Success ---------------------------------------------------------------------------


async def test_fetches_the_document(private_keys: dict[str, rsa.RSAPrivateKey]) -> None:
    seen: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=jwks_body(private_keys))

    fetch = http_fetcher(URL, transport=transport(handler))
    assert await fetch() == jwks_body(private_keys)
    assert str(seen[0].url) == URL
    assert seen[0].headers["Accept-Encoding"] == "identity"


async def test_from_url_verifies_with_the_fetched_keys(
    private_keys: dict[str, rsa.RSAPrivateKey],
) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=jwks_body(private_keys))

    client = JwksClient.from_url(URL, transport=transport(handler))
    assert await client.get_key("key-1") is not None
    assert await client.get_key("nobody") is None


# --- Failures --------------------------------------------------------------------------


@pytest.mark.parametrize("status", [301, 404, 500, 503])
async def test_a_non_2xx_status_fails(status: int) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"keys": []})

    with pytest.raises(httpx.HTTPStatusError):
        await http_fetcher(URL, transport=transport(handler))()


@pytest.mark.parametrize("body", [b"not json", b"", b"\xff\xfe", b"[1, 2]", b'"keys"'])
async def test_a_body_that_is_not_a_json_object_fails(body: bytes) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    with pytest.raises(JwksError):
        await http_fetcher(URL, transport=transport(handler))()


async def test_an_oversized_body_is_abandoned_while_streaming() -> None:
    """No Content-Length and an endless body: the fetch stops just past the limit."""
    sent = 0

    async def endless() -> AsyncIterator[bytes]:
        nonlocal sent
        while True:
            sent += 1
            yield b" " * 1024

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=endless())

    with pytest.raises(JwksError, match="too large"):
        await http_fetcher(URL, transport=transport(handler))()
    assert sent * 1024 <= MAX_RESPONSE_BYTES + 2 * 1024


async def test_an_oversized_content_length_is_refused_before_reading() -> None:
    read = False

    async def body() -> AsyncIterator[bytes]:
        nonlocal read
        read = True
        yield b"{}"

    async def handler(request: httpx.Request) -> httpx.Response:
        headers = {"Content-Length": str(MAX_RESPONSE_BYTES + 1)}
        return httpx.Response(200, content=body(), headers=headers)

    with pytest.raises(JwksError, match="too large"):
        await http_fetcher(URL, transport=transport(handler))()
    assert not read


async def test_a_body_at_the_limit_is_accepted() -> None:
    padding = MAX_RESPONSE_BYTES - len(json.dumps({"keys": [], "pad": ""}))
    body = json.dumps({"keys": [], "pad": " " * padding}).encode()
    assert len(body) == MAX_RESPONSE_BYTES

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    assert (await http_fetcher(URL, transport=transport(handler))())["keys"] == []


async def test_the_timeout_covers_the_whole_fetch() -> None:
    """A drip-fed body never trips httpx's per-read timeout; the total timeout still ends it."""

    async def drip() -> AsyncIterator[bytes]:
        yield b'{"keys": ['
        while True:
            await asyncio.sleep(0.01)
            yield b" "

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=drip())

    fetch = http_fetcher(URL, timeout=0.2, transport=transport(handler))
    with pytest.raises(JwksError, match="longer than"):
        await asyncio.wait_for(fetch(), timeout=5)


async def test_the_timeout_covers_a_server_that_never_answers() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    fetch = http_fetcher(URL, timeout=0.1, transport=transport(handler))
    with pytest.raises(JwksError, match="longer than"):
        await asyncio.wait_for(fetch(), timeout=5)


async def test_a_failed_fetch_through_from_url_keeps_tokens_rejected() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = JwksClient.from_url(URL, transport=transport(handler))
    assert await client.get_key("key-1") is None


# --- Scheme ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://identity.example/.well-known/jwks.json",
        "http://identity-api:8000/.well-known/jwks.json",
        "ftp://identity.example/jwks.json",
        "file:///etc/jwks.json",
        "identity.example/jwks.json",
        "https:///jwks.json",
        "http://localhost.evil.example/jwks.json",
    ],
)
def test_anything_but_https_is_refused(url: str) -> None:
    with pytest.raises(ValueError):
        http_fetcher(url)
    with pytest.raises(ValueError):
        JwksClient.from_url(url)


@pytest.mark.parametrize(
    "url",
    [
        URL,
        "HTTPS://identity.example/jwks.json",
        "http://localhost:8000/.well-known/jwks.json",
        "http://127.0.0.1:8000/.well-known/jwks.json",
        "http://[::1]:8000/.well-known/jwks.json",
    ],
)
def test_https_and_loopback_http_are_allowed(url: str) -> None:
    http_fetcher(url)
    JwksClient.from_url(url)


def test_allow_insecure_permits_plain_http_on_a_private_network() -> None:
    url = "http://identity-api:8000/.well-known/jwks.json"
    http_fetcher(url, allow_insecure=True)
    JwksClient.from_url(url, allow_insecure=True)


def test_allow_insecure_still_refuses_other_schemes() -> None:
    with pytest.raises(ValueError):
        http_fetcher("ftp://identity-api/jwks.json", allow_insecure=True)
