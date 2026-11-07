import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

import httpx
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

logger = logging.getLogger(__name__)

# ADR 0009: services cache the key set for 10 minutes and refetch at most once per minute.
CACHE_TTL_SECONDS = 600.0
MIN_REFETCH_INTERVAL_SECONDS = 60.0
MIN_KEY_BITS = 2048
MAX_RESPONSE_BYTES = 256 * 1024
FETCH_TIMEOUT_SECONDS = 3.0
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

Fetcher = Callable[[], Awaitable[dict[str, Any]]]
Clock = Callable[[], float]


class JwksError(Exception):
    """The key set could not be fetched or holds no usable key."""


def check_jwks_url(url: str, *, allow_insecure: bool = False) -> None:
    """Refuses a JWKS URL that is not HTTPS. Whoever serves the key set decides which tokens
    are valid, so over plain HTTP anyone on the network path could forge every token.

    Plain HTTP is allowed for a loopback host, or with `allow_insecure=True` for a private
    network the caller trusts (e.g. a compose-internal hostname in development).
    """
    parts = urlsplit(url)
    if not parts.hostname:
        raise ValueError(f"JWKS URL has no host: {url!r}")
    if parts.scheme == "https":
        return
    if parts.scheme == "http" and (allow_insecure or parts.hostname in LOOPBACK_HOSTS):
        return
    raise ValueError(
        f"JWKS URL must use https (got {parts.scheme or 'no'} scheme for {parts.hostname}); "
        "pass allow_insecure=True only for a trusted private network"
    )


def http_fetcher(
    url: str,
    *,
    timeout: float = FETCH_TIMEOUT_SECONDS,
    allow_insecure: bool = False,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Fetcher:
    """Fetches the JWKS document over HTTPS.

    `timeout` bounds the whole fetch (connect, headers and body together), so a slow or
    drip-fed endpoint cannot hold a refresh, and the requests waiting on it, for longer. The
    body is streamed and abandoned once it passes MAX_RESPONSE_BYTES, so an oversized response
    never sits in memory. `transport` is for tests (`httpx.MockTransport`).
    """
    check_jwks_url(url, allow_insecure=allow_insecure)

    async def fetch() -> dict[str, Any]:
        try:
            async with asyncio.timeout(timeout):
                body = await _read_limited(url, timeout=timeout, transport=transport)
        except TimeoutError as error:
            raise JwksError(f"JWKS fetch took longer than {timeout} seconds") from error
        try:
            document = json.loads(body)
        except ValueError as error:
            raise JwksError("JWKS response is not valid JSON") from error
        if not isinstance(document, dict):
            raise JwksError("JWKS response is not a JSON object")
        return document

    return fetch


async def _read_limited(
    url: str, *, timeout: float, transport: httpx.AsyncBaseTransport | None
) -> bytes:
    # `identity` asks for an uncompressed body, so the bytes counted are the bytes sent.
    headers = {"Accept": "application/json", "Accept-Encoding": "identity"}
    async with (
        httpx.AsyncClient(timeout=timeout, transport=transport) as client,
        client.stream("GET", url, headers=headers) as response,
    ):
        response.raise_for_status()
        declared = response.headers.get("Content-Length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
            raise JwksError("JWKS response is too large")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body += chunk
            if len(body) > MAX_RESPONSE_BYTES:
                raise JwksError("JWKS response is too large")
        return bytes(body)


def parse_jwks(document: dict[str, Any]) -> dict[str, rsa.RSAPublicKey]:
    """The usable RSA signing keys by `kid`. Anything else in the document is skipped.

    Raises JwksError if nothing usable is left, so a broken response never replaces good keys.
    """
    raw = document.get("keys")
    if not isinstance(raw, list):
        raise JwksError("JWKS has no 'keys' list")
    keys: dict[str, rsa.RSAPublicKey] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        kid = entry.get("kid")
        usable = (
            isinstance(kid, str)
            and kid
            and entry.get("kty") == "RSA"
            and entry.get("use", "sig") == "sig"
            and entry.get("alg", "RS256") == "RS256"
        )
        if not usable:
            continue
        try:
            key = RSAAlgorithm.from_jwk(entry)
        except Exception:  # noqa: BLE001 - one bad key must not hide the good ones
            logger.warning("skipping unreadable JWKS key", extra={"kid": kid})
            continue
        if isinstance(key, rsa.RSAPublicKey) and key.key_size >= MIN_KEY_BITS:
            keys[str(kid)] = key
    if not keys:
        raise JwksError("JWKS holds no usable RS256 key")
    return keys


class JwksClient:
    """Public keys from a JWKS endpoint, fetched rarely (ADR 0009).

    - The keys are cached for `cache_ttl` seconds. Verifying a token never fetches by itself
      unless the cache has run out or the token names a `kid` that is not cached.
    - A cached `kid` is always answered at once. Once the cache has run out, that answer also
      starts one refresh in the background, so no request waits on the network for it.
    - Only an unknown `kid` waits for a fetch (the key may have been published since).
    - No fetch starts less than `min_refetch_interval` seconds after the previous attempt, so
      neither a flood of unknown `kid`s nor an outage can turn into a request per token.
    - Concurrent callers share one fetch.
    - If a fetch fails, the last good keys stay in use (stale, but better than no sign-in) and
      the next attempt waits for the interval. Before the first success, tokens are rejected.
    """

    def __init__(
        self,
        fetch: Fetcher,
        *,
        cache_ttl: float = CACHE_TTL_SECONDS,
        min_refetch_interval: float = MIN_REFETCH_INTERVAL_SECONDS,
        clock: Clock = time.monotonic,
    ) -> None:
        self._fetch = fetch
        self._cache_ttl = cache_ttl
        self._min_interval = min_refetch_interval
        self._clock = clock
        self._keys: dict[str, rsa.RSAPublicKey] = {}
        self._fetched_at: float | None = None  # last success
        self._attempted_at: float | None = None  # last attempt, success or not
        self._lock = asyncio.Lock()
        # Kept so the task is not garbage-collected mid-fetch, and so only one runs at a time.
        self._background: asyncio.Task[None] | None = None

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        allow_insecure: bool = False,
        timeout: float = FETCH_TIMEOUT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
        **options: Any,
    ) -> "JwksClient":
        """A client for an HTTPS JWKS URL. Plain HTTP is refused unless the host is loopback
        or `allow_insecure=True` is passed (see `check_jwks_url`)."""
        fetch = http_fetcher(
            url, timeout=timeout, allow_insecure=allow_insecure, transport=transport
        )
        return cls(fetch, **options)

    async def get_key(self, kid: str) -> rsa.RSAPublicKey | None:
        key = self._keys.get(kid)
        if key is not None:
            if not self._is_fresh() and self._may_fetch():
                self._refresh_in_background()
            return key
        async with self._lock:
            # Another caller, or the background refresh, may have fetched while this one waited.
            if kid in self._keys:
                return self._keys[kid]
            if self._may_fetch():
                await self._refresh()
        return self._keys.get(kid)

    async def wait_for_refresh(self) -> None:
        """Waits for the background refresh, if one is running. For tests and shutdown."""
        if self._background is not None:
            await asyncio.shield(self._background)

    def _refresh_in_background(self) -> None:
        if self._background is not None and not self._background.done():
            return
        self._background = asyncio.get_running_loop().create_task(self._refresh_if_due())

    async def _refresh_if_due(self) -> None:
        async with self._lock:
            # A caller with an unknown kid may have refreshed before this task got the lock.
            if not self._is_fresh() and self._may_fetch():
                await self._refresh()

    def _is_fresh(self) -> bool:
        return self._fetched_at is not None and self._clock() - self._fetched_at < self._cache_ttl

    def _may_fetch(self) -> bool:
        return (
            self._attempted_at is None or self._clock() - self._attempted_at >= self._min_interval
        )

    async def _refresh(self) -> None:
        self._attempted_at = self._clock()
        try:
            keys = parse_jwks(await self._fetch())
        except Exception as error:  # noqa: BLE001 - any failure keeps the last good keys
            logger.warning(
                "JWKS fetch failed, keeping the cached keys",
                exc_info=error,
                extra={"cached_keys": len(self._keys)},
            )
            return
        self._keys = keys
        self._fetched_at = self._clock()
