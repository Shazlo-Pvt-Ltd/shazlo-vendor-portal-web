import asyncio
import logging
from collections.abc import AsyncIterator

import pytest
from fakeredis import FakeAsyncRedis, FakeServer

from shazlo_security.rate_limit import (
    Check,
    RateLimitConfig,
    RateLimited,
    RateLimiterUnavailable,
    RateLimitGuard,
    RateRule,
    RedisRateLimiter,
)

PREFIX = "test:rl:"
EMAIL = "reviewer@shazlo.test"


def rule(limit: int, window: int = 60) -> RateRule:
    return RateRule(limit=limit, window_seconds=window)


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


# --- Limiter ---------------------------------------------------------------------------


async def test_hits_are_allowed_up_to_the_limit(redis: FakeAsyncRedis) -> None:
    limiter = RedisRateLimiter(redis, PREFIX)
    results = [await limiter.hit("k", rule(3)) for _ in range(5)]
    assert [r.allowed for r in results] == [True, True, True, False, False]
    assert [r.count for r in results] == [1, 2, 3, 4, 5]


async def test_retry_after_is_the_time_left_in_the_window(redis: FakeAsyncRedis) -> None:
    limiter = RedisRateLimiter(redis, PREFIX)
    first = await limiter.hit("k", rule(1, window=60))
    assert first.retry_after == 60
    blocked = await limiter.hit("k", rule(1, window=60))
    assert not blocked.allowed
    assert 59 <= blocked.retry_after <= 60
    # The window does not slide: blocked hits do not push the reset further away.
    assert await redis.ttl(PREFIX + "k") <= 60


async def test_the_window_resets(redis: FakeAsyncRedis) -> None:
    limiter = RedisRateLimiter(redis, PREFIX)
    assert (await limiter.hit("k", rule(1, window=1))).allowed
    assert not (await limiter.hit("k", rule(1, window=1))).allowed
    await asyncio.sleep(1.2)
    again = await limiter.hit("k", rule(1, window=1))
    assert again.allowed
    assert again.count == 1


async def test_keys_are_counted_separately(redis: FakeAsyncRedis) -> None:
    limiter = RedisRateLimiter(redis, PREFIX)
    assert (await limiter.hit("a", rule(1))).allowed
    assert not (await limiter.hit("a", rule(1))).allowed
    assert (await limiter.hit("b", rule(1))).allowed


async def test_reset_clears_the_counter(redis: FakeAsyncRedis) -> None:
    limiter = RedisRateLimiter(redis, PREFIX)
    await limiter.hit("k", rule(1))
    await limiter.reset("k")
    assert (await limiter.hit("k", rule(1))).allowed


async def test_a_counter_that_lost_its_expiry_gets_one_again(redis: FakeAsyncRedis) -> None:
    await redis.set(PREFIX + "k", 7)  # e.g. a crash between INCR and EXPIRE
    result = await RedisRateLimiter(redis, PREFIX).hit("k", rule(5, window=30))
    assert not result.allowed
    assert 0 < await redis.ttl(PREFIX + "k") <= 30


# --- Guard -------------------------------------------------------------------------------


def make_guard(
    redis: FakeAsyncRedis,
    *,
    key: bytes = b"k" * 32,
    fail_closed: frozenset[str] = frozenset(),
    prefix: str = PREFIX,
) -> RateLimitGuard:
    return RateLimitGuard(
        RedisRateLimiter(redis, prefix), RateLimitConfig(hmac_key=key, fail_closed=fail_closed)
    )


async def test_guard_raises_rate_limited_with_retry_after(
    redis: FakeAsyncRedis,
) -> None:
    guard = make_guard(redis)
    checks = [Check("ip", "203.0.113.7", rule(2, window=120))]
    await guard.check("login", checks)
    await guard.check("login", checks)
    with pytest.raises(RateLimited) as caught:
        await guard.check("login", checks)
    assert 119 <= caught.value.retry_after <= 120


async def test_a_refused_check_stops_the_later_counters(
    redis: FakeAsyncRedis,
) -> None:
    """Login lockout: requests a narrow counter (per IP) already refuses must not reach the loose
    per-email counter, or one client could use up a victim's per-email limit for everyone."""
    guard = make_guard(redis)
    email_rule = rule(3, 3600)
    attacker = [Check("ip", "203.0.113.7", rule(1, window=60)), Check("email", EMAIL, email_rule)]
    await guard.check("login", attacker)
    for _ in range(10):
        with pytest.raises(RateLimited) as caught:
            await guard.check("login", attacker)
        assert caught.value.retry_after <= 60  # the IP's window, the first one over
    # The attacker's refused requests did not count: the owner, elsewhere, still gets in.
    owner = [Check("ip", "198.51.100.1", rule(5, window=60)), Check("email", EMAIL, email_rule)]
    await guard.check("login", owner)
    await guard.check("login", owner)
    with pytest.raises(RateLimited) as caught:
        await guard.check("login", owner)
    assert caught.value.retry_after > 60


async def test_remembered_subjects_expire_and_never_store_the_subject(
    redis: FakeAsyncRedis,
) -> None:
    guard = make_guard(redis)
    assert not await guard.remembers("login", "email_ip", f"1.1.1.1 {EMAIL}")
    await guard.remember("login", "email_ip", f"1.1.1.1 {EMAIL}", 120)
    assert await guard.remembers("login", "email_ip", f"1.1.1.1 {EMAIL}")
    assert not await guard.remembers("login", "email_ip", f"2.2.2.2 {EMAIL}")
    keys = [key.decode() async for key in redis.scan_iter("*")]
    assert len(keys) == 1
    assert EMAIL.split("@")[0] not in keys[0]
    assert 0 < await redis.ttl(keys[0]) <= 120


async def test_remember_and_remembers_never_fail_the_request() -> None:
    server = FakeServer()
    server.connected = False
    client = FakeAsyncRedis(server=server)
    guard = make_guard(client)
    await guard.remember("login", "email_ip", EMAIL, 60)  # does not raise
    assert not await guard.remembers("login", "email_ip", EMAIL)
    await client.aclose()


async def test_redis_holds_no_plain_subject(
    redis: FakeAsyncRedis,
) -> None:
    guard = make_guard(redis)
    await guard.check(
        "login",
        [
            Check("email", "Secret.Person@shazlo.test", rule(5)),
            Check("ip", "198.51.100.9", rule(5)),
        ],
    )
    keys = [key.decode() async for key in redis.scan_iter("*")]
    assert len(keys) == 2
    for key in keys:
        assert "secret" not in key.lower()
        assert "shazlo" not in key
        assert "198.51" not in key


async def test_the_hash_is_keyed(
    redis: FakeAsyncRedis,
) -> None:
    """A plain SHA-256 of an email could be looked up; the key makes that useless."""
    one = make_guard(redis, key=b"a" * 32)
    other = make_guard(redis, key=b"b" * 32)
    await one.check("login", [Check("email", EMAIL, rule(5))])
    await other.check("login", [Check("email", EMAIL, rule(5))])
    assert len([key async for key in redis.scan_iter("*")]) == 2


async def test_two_instances_with_the_same_key_share_the_counter(
    redis: FakeAsyncRedis,
) -> None:
    one = make_guard(redis)
    other = make_guard(redis)
    checks = [Check("email", EMAIL, rule(2))]
    await one.check("login", checks)
    await other.check("login", checks)
    with pytest.raises(RateLimited):
        await one.check("login", checks)


@pytest.mark.parametrize(("endpoint", "closed"), [("login", True), ("token", False)])
async def test_redis_down_fails_closed_or_open_per_endpoint(
    caplog: pytest.LogCaptureFixture,
    endpoint: str,
    closed: bool,
) -> None:
    server = FakeServer()
    server.connected = False
    client = FakeAsyncRedis(server=server)
    guard = make_guard(client, fail_closed=frozenset({"login"}))
    with caplog.at_level(logging.WARNING):
        if closed:
            with pytest.raises(RateLimiterUnavailable):
                await guard.check(endpoint, [Check("ip", "1.1.1.1", rule(1))])
        else:
            await guard.check(endpoint, [Check("ip", "1.1.1.1", rule(1))])
    assert any("rate limiter unavailable" in record.getMessage() for record in caplog.records)
    await client.aclose()


async def test_a_failed_reset_never_fails_the_request() -> None:
    server = FakeServer()
    server.connected = False
    client = FakeAsyncRedis(server=server)
    guard = make_guard(client)
    await guard.reset("login", "email", EMAIL)  # does not raise
    await client.aclose()


# --- Prefixes and configuration ------------------------------------------------------------


async def test_limiters_with_different_prefixes_never_see_each_others_counters(
    redis: FakeAsyncRedis,
) -> None:
    identity = RedisRateLimiter(redis, "identity:rl:")
    vendor = RedisRateLimiter(redis, "vendor:rl:")
    assert (await identity.hit("login:ip:abc", rule(1))).allowed
    assert not (await identity.hit("login:ip:abc", rule(1))).allowed
    # The same key under the other prefix starts from zero.
    first = await vendor.hit("login:ip:abc", rule(1))
    assert first.allowed
    assert first.count == 1
    await identity.reset("login:ip:abc")
    assert not (await vendor.hit("login:ip:abc", rule(1))).allowed
    assert sorted([key.decode() async for key in redis.scan_iter("*")]) == [
        "vendor:rl:login:ip:abc"
    ]


async def test_guards_with_different_prefixes_do_not_share_counters(
    redis: FakeAsyncRedis,
) -> None:
    identity = make_guard(redis, prefix="identity:rl:")
    vendor = make_guard(redis, prefix="vendor:rl:")
    checks = [Check("email", EMAIL, rule(1))]
    await identity.check("login", checks)
    await vendor.check("login", checks)  # would raise if it saw identity's counter
    with pytest.raises(RateLimited):
        await identity.check("login", checks)


def test_a_prefix_is_required(redis: FakeAsyncRedis) -> None:
    with pytest.raises(TypeError):
        RedisRateLimiter(redis)  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="prefix"):
        RedisRateLimiter(redis, "")
    with pytest.raises(ValueError, match="must end with ':'"):
        RedisRateLimiter(redis, "vendor")


@pytest.mark.parametrize(("limit", "window"), [(0, 60), (5, 0), (-1, 60)])
def test_a_rule_must_be_positive(limit: int, window: int) -> None:
    with pytest.raises(ValueError, match="at least 1"):
        RateRule(limit=limit, window_seconds=window)


def test_an_empty_hmac_key_is_refused() -> None:
    with pytest.raises(ValueError, match="hmac_key"):
        RateLimitConfig(hmac_key=b"")
