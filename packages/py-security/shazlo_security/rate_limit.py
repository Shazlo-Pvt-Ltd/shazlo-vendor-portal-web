import hashlib
import hmac
import logging
from dataclasses import dataclass
from typing import Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


class RateLimited(Exception):
    """A counter is over its limit. `retry_after` is the seconds until the longest window ends."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"rate limited, retry after {retry_after}s")
        self.retry_after = retry_after


class RateLimiterUnavailable(Exception):
    """The store is down and the endpoint is configured to refuse rather than skip the limit."""


@dataclass(frozen=True)
class RateRule:
    """At most `limit` hits per `window_seconds`."""

    limit: int
    window_seconds: int

    def __post_init__(self) -> None:
        if self.limit < 1 or self.window_seconds < 1:
            raise ValueError("limit and window_seconds must be at least 1")


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    count: int
    retry_after: int  # seconds until the window resets, at least 1


class RateLimiter(Protocol):
    """Counts hits per key. The store behind it can change without touching the endpoints."""

    async def hit(self, key: str, rule: RateRule) -> RateLimitResult:
        """Counts one hit. Allowed while the count in the current window is within the limit."""
        ...

    async def reset(self, key: str) -> None: ...


class RedisRateLimiter:
    """Fixed window: the first hit starts the window and the key expires with it.

    A client can use up the limit at the end of one window and again at the start of the next,
    so a burst of up to twice the limit can pass across a boundary. That is fine for brute-force
    protection, and the TTL gives an exact `Retry-After`.

    `prefix` is required: services that share a Redis give theirs different prefixes (for
    example `identity:rl:`), so their counters can never meet.
    """

    def __init__(self, redis: Redis, prefix: str) -> None:
        if not prefix:
            raise ValueError("a key prefix is required")
        self._redis = redis
        self._prefix = prefix

    async def hit(self, key: str, rule: RateRule) -> RateLimitResult:
        name = self._prefix + key
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incr(name)
            pipe.ttl(name)
            count, ttl = await pipe.execute()
        if ttl < 0:
            # The first hit, or a key whose expiry was lost: either way, (re)start the window.
            await self._redis.expire(name, rule.window_seconds)
            ttl = rule.window_seconds
        return RateLimitResult(count <= rule.limit, count, max(1, ttl))

    async def reset(self, key: str) -> None:
        await self._redis.delete(self._prefix + key)


@dataclass(frozen=True)
class Check:
    """One counter an endpoint is limited by, e.g. `Check("ip", "203.0.113.7", rule)`."""

    scope: str
    subject: str
    rule: RateRule


@dataclass(frozen=True)
class RateLimitConfig:
    # Keys the hashes that name subjects in Redis, so a Redis dump does not reveal emails.
    # Every instance of a service must share it.
    hmac_key: bytes
    # Endpoints that refuse (RateLimiterUnavailable) when Redis is down; the others skip the
    # limit and log a warning.
    fail_closed: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if not self.hmac_key:
            raise ValueError("hmac_key must not be empty")


class RateLimitGuard:
    """Applies the checks of an endpoint, raises when one is over and decides what a store
    outage means."""

    def __init__(self, limiter: RateLimiter, config: RateLimitConfig) -> None:
        self._limiter = limiter
        self._fail_closed = config.fail_closed
        self._hmac_key = config.hmac_key

    def _key(self, endpoint: str, scope: str, subject: str) -> str:
        # Subjects are hashed, so Redis never holds an email (or IP) in plain text. A keyed hash
        # because emails are guessable: a plain hash could be reversed from a Redis dump.
        digest = hmac.new(self._hmac_key, subject.encode(), hashlib.sha256).hexdigest()
        return f"{endpoint}:{scope}:{digest}"

    async def check(self, endpoint: str, checks: list[Check]) -> None:
        """Counts a hit on every check; raises RateLimited if any is over its limit.

        Every counter is hit even when an earlier one is over, so the counters stay honest.
        """
        try:
            results = [
                await self._limiter.hit(self._key(endpoint, c.scope, c.subject), c.rule)
                for c in checks
            ]
        except RedisError as error:
            self._store_down(endpoint, error)
            return
        denied = [result for result in results if not result.allowed]
        if denied:
            raise RateLimited(max(result.retry_after for result in denied))

    async def reset(self, endpoint: str, scope: str, subject: str) -> None:
        """Clears one counter (a successful login clears the email's). Never fails the request."""
        try:
            await self._limiter.reset(self._key(endpoint, scope, subject))
        except RedisError:
            logger.warning("rate limit reset failed", extra={"endpoint": endpoint})

    def _store_down(self, endpoint: str, error: RedisError) -> None:
        if endpoint in self._fail_closed:
            logger.error(
                "rate limiter unavailable, refusing", exc_info=error, extra={"endpoint": endpoint}
            )
            raise RateLimiterUnavailable(endpoint) from error
        logger.warning(
            "rate limiter unavailable, allowing", exc_info=error, extra={"endpoint": endpoint}
        )
