import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fakeredis import FakeAsyncRedis

from shazlo_security.refresh_tokens import (
    InvalidRefreshTokenError,
    RefreshConflictError,
    RefreshSession,
    RefreshTokenConfig,
    RefreshTokenStore,
    StaleSessionError,
    hash_token,
)

SUBJECT = uuid.UUID("11111111-2222-3333-4444-555555555555")
PREFIX = "test:"
START = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def store(redis: FakeAsyncRedis, clock: Clock) -> RefreshTokenStore:
    return RefreshTokenStore(redis, RefreshTokenConfig(PREFIX), clock=clock)


async def start(store: RefreshTokenStore, subject_id: uuid.UUID = SUBJECT) -> RefreshSession:
    """A login: reads the generation, (checks the password,) starts a family."""
    return await store.start_family(subject_id, await store.generation(subject_id))


async def test_token_is_256_bits_and_only_its_hash_is_stored(
    store: RefreshTokenStore, redis: FakeAsyncRedis
) -> None:
    session = await start(store)
    assert len(session.token) >= 43  # 32 random bytes, base64url
    keys = [_text(key) async for key in redis.scan_iter("*")]
    assert f"{PREFIX}rt:{hash_token(session.token)}" in keys
    assert not any(session.token in key for key in keys)
    for key in keys:
        # Whatever the key's type, the raw token must not appear in its value.
        for value in await _dump_values(redis, key):
            assert session.token not in value


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


async def _dump_values(redis: FakeAsyncRedis, key: str) -> list[str]:
    kind = _text(await redis.type(key))
    if kind == "hash":
        return [_text(v) for v in (await redis.hgetall(key)).values()]
    if kind == "set":
        return [_text(v) for v in await redis.smembers(key)]
    value = await redis.get(key)
    return [_text(value)] if value else []


async def test_rotation_gives_a_new_token_in_the_same_family(store: RefreshTokenStore) -> None:
    first = await start(store)
    rotation = await store.rotate(first.token)
    assert rotation.subject_id == SUBJECT
    assert rotation.session.token != first.token
    assert rotation.session.family_id == first.family_id
    # The new token rotates in turn.
    assert (await store.rotate(rotation.session.token)).subject_id == SUBJECT


async def test_reusing_a_rotated_token_revokes_the_family(
    store: RefreshTokenStore, clock: Clock
) -> None:
    first = await start(store)
    second = (await store.rotate(first.token)).session
    clock.now += timedelta(seconds=11)  # past the reuse grace window
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(first.token)
    # The token handed out after the first one is dead too.
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(second.token)


async def test_unknown_token_is_rejected(store: RefreshTokenStore) -> None:
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate("never-issued")


async def test_token_lifetime_is_seven_days(store: RefreshTokenStore, clock: Clock) -> None:
    session = await start(store)
    assert session.expires_at == START + timedelta(days=7)


async def test_family_ends_thirty_days_after_login(store: RefreshTokenStore, clock: Clock) -> None:
    session = await start(store)
    # Keep refreshing every 6 days: each token is valid, but the family has a hard limit.
    for _ in range(4):
        clock.now += timedelta(days=6)
        session = (await store.rotate(session.token)).session
    clock.now = START + timedelta(days=28)
    # The last token may not outlive the family.
    last = (await store.rotate(session.token)).session
    assert last.expires_at == START + timedelta(days=30)
    clock.now = START + timedelta(days=30, seconds=1)
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(last.token)


async def test_revoke_by_token_ends_the_family(store: RefreshTokenStore) -> None:
    session = await start(store)
    await store.revoke_by_token(session.token)
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(session.token)
    await store.revoke_by_token("unknown")  # ignored


async def test_revoke_all_ends_every_family_of_the_admin_only(
    store: RefreshTokenStore,
) -> None:
    mine = [await start(store) for _ in range(3)]
    other = await start(store, uuid.uuid4())
    await store.revoke_all(SUBJECT)
    for session in mine:
        with pytest.raises(InvalidRefreshTokenError):
            await store.rotate(session.token)
    assert (await store.rotate(other.token)).session.family_id == other.family_id


async def test_keys_expire_in_redis(store: RefreshTokenStore, redis: FakeAsyncRedis) -> None:
    session = await start(store)
    assert 0 < await redis.ttl(f"{PREFIX}rt:{hash_token(session.token)}") <= 7 * 86400
    assert 0 < await redis.ttl(f"{PREFIX}rf:{session.family_id}") <= 30 * 86400


# --- revoke_all keeps the index of families started meanwhile -------------------------------


async def test_revoke_all_keeps_a_family_started_while_it_runs(
    store: RefreshTokenStore, redis: FakeAsyncRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A login with the new password lands between revoke_all's SMEMBERS and its cleanup."""
    old = await start(store)
    started: list[RefreshSession] = []
    smembers = redis.smembers

    async def smembers_then_login(name: str) -> object:
        members = await smembers(name)
        started.append(await start(store))
        return members

    monkeypatch.setattr(redis, "smembers", smembers_then_login)
    await store.revoke_all(SUBJECT)
    monkeypatch.undo()

    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(old.token)
    # The newcomer is still indexed, so the next revoke_all finds and ends it.
    assert started[0].family_id in {_text(m) for m in await redis.smembers(f"{PREFIX}ra:{SUBJECT}")}
    await store.revoke_all(SUBJECT)
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(started[0].token)


# --- session generation --------------------------------------------------------------------


async def test_login_that_read_the_old_generation_cannot_start_a_family(
    store: RefreshTokenStore, redis: FakeAsyncRedis
) -> None:
    generation = await store.generation(SUBJECT)  # the login reads it, then checks the password
    new_generation = await store.revoke_all(SUBJECT)  # meanwhile the password changes
    assert new_generation == generation + 1
    with pytest.raises(StaleSessionError):
        await store.start_family(SUBJECT, generation)
    assert not [key async for key in redis.scan_iter(PREFIX + "rf:*")]
    assert not [key async for key in redis.scan_iter(PREFIX + "rt:*")]
    # A login with the current generation works.
    assert (await store.start_family(SUBJECT, new_generation)).family_id


async def test_family_from_an_older_generation_is_rejected_and_revoked(
    store: RefreshTokenStore, redis: FakeAsyncRedis
) -> None:
    session = await start(store)
    # The generation moved on, but the family escaped the revocation (e.g. a missed index entry).
    await redis.incr(f"{PREFIX}rg:{SUBJECT}")
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(session.token)
    assert not await redis.exists(f"{PREFIX}rf:{session.family_id}")


async def test_concurrent_login_and_revoke_all_never_leave_a_live_old_family(
    store: RefreshTokenStore,
) -> None:
    for _ in range(25):
        subject_id = uuid.uuid4()
        generation = await store.generation(subject_id)

        async def login(subject_id: uuid.UUID, generation: int) -> RefreshSession | None:
            await asyncio.sleep(0)
            try:
                return await store.start_family(subject_id, generation)
            except StaleSessionError:
                return None

        session, _ = await asyncio.gather(
            login(subject_id, generation), store.revoke_all(subject_id)
        )
        if session is not None:
            with pytest.raises(InvalidRefreshTokenError):
                await store.rotate(session.token)


# --- atomic rotation -----------------------------------------------------------------------


async def test_rotation_writes_the_new_token_with_a_ttl(
    store: RefreshTokenStore, redis: FakeAsyncRedis
) -> None:
    first = await start(store)
    second = (await store.rotate(first.token)).session
    assert 0 < await redis.ttl(f"{PREFIX}rt:{hash_token(second.token)}") <= 7 * 86400
    assert 0 < await redis.ttl(f"{PREFIX}rtu:{hash_token(first.token)}") <= 7 * 86400
    # The used marker records when the token was used.
    used_at = await redis.get(f"{PREFIX}rtu:{hash_token(first.token)}")
    assert used_at is not None
    assert float(used_at) == START.timestamp()


async def test_family_revoked_during_rotation_issues_no_token(
    store: RefreshTokenStore, redis: FakeAsyncRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logout lands after rotate has read the family but before it writes the next token."""
    session = await start(store)
    hmget = redis.hmget

    async def hmget_then_logout(name: str, keys: list[str]) -> object:
        values = await hmget(name, keys)
        await store.revoke_by_token(session.token)
        return values

    monkeypatch.setattr(redis, "hmget", hmget_then_logout)
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(session.token)
    monkeypatch.undo()
    assert len([key async for key in redis.scan_iter(PREFIX + "rt:*")]) == 1  # only the original
    assert not await redis.exists(f"{PREFIX}rtu:{hash_token(session.token)}")


# --- reuse grace window --------------------------------------------------------------------


async def test_concurrent_refreshes_conflict_without_revoking(store: RefreshTokenStore) -> None:
    """Two tabs refresh with the same cookie at the same moment."""
    session = await start(store)
    results = await asyncio.gather(
        store.rotate(session.token), store.rotate(session.token), return_exceptions=True
    )
    winners = [r for r in results if not isinstance(r, BaseException)]
    assert len(winners) == 1
    assert [type(r) for r in results if isinstance(r, BaseException)] == [RefreshConflictError]
    # The family survives: the winner's token keeps working.
    assert (await store.rotate(winners[0].session.token)).subject_id == SUBJECT


async def test_reuse_within_the_grace_window_conflicts(
    store: RefreshTokenStore, clock: Clock
) -> None:
    first = await start(store)
    second = (await store.rotate(first.token)).session
    clock.now += timedelta(seconds=9)
    with pytest.raises(RefreshConflictError):
        await store.rotate(first.token)
    # Once the window has passed, the same reuse revokes the family.
    clock.now += timedelta(seconds=2)
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(first.token)
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(second.token)


async def test_zero_grace_revokes_on_any_reuse(
    redis: FakeAsyncRedis,
    clock: Clock,
) -> None:
    config = RefreshTokenConfig(PREFIX, reuse_grace_seconds=0)
    store = RefreshTokenStore(redis, config, clock=clock)
    session = await start(store)
    results = await asyncio.gather(
        store.rotate(session.token), store.rotate(session.token), return_exceptions=True
    )
    winners = [r for r in results if not isinstance(r, BaseException)]
    assert len(winners) == 1
    errors = [type(r) for r in results if isinstance(r, BaseException)]
    assert errors == [InvalidRefreshTokenError]
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(winners[0].session.token)


# --- Prefixes and configuration ------------------------------------------------------------


async def test_stores_with_different_prefixes_never_touch_each_others_families(
    redis: FakeAsyncRedis, clock: Clock
) -> None:
    identity = RefreshTokenStore(redis, RefreshTokenConfig("identity:"), clock=clock)
    vendor = RefreshTokenStore(redis, RefreshTokenConfig("vendor:"), clock=clock)
    # The same subject ID in both: only the prefix tells them apart.
    mine = await start(identity)
    theirs = await start(vendor)

    # A token of one store is unknown to the other.
    with pytest.raises(InvalidRefreshTokenError):
        await vendor.rotate(mine.token)
    with pytest.raises(InvalidRefreshTokenError):
        await identity.rotate(theirs.token)
    assert await vendor.family_id_of(mine.token) is None

    # Ending every session in one store leaves the other's alone, and its generation too.
    assert await identity.revoke_all(SUBJECT) == 1
    assert await vendor.generation(SUBJECT) == 0
    with pytest.raises(InvalidRefreshTokenError):
        await identity.rotate(mine.token)
    assert (await vendor.rotate(theirs.token)).subject_id == SUBJECT

    keys = [_text(key) async for key in redis.scan_iter("*")]
    assert keys
    assert all(key.startswith(("identity:", "vendor:")) for key in keys)


def test_a_prefix_is_required() -> None:
    with pytest.raises(TypeError):
        RefreshTokenConfig()  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="prefix"):
        RefreshTokenConfig("")


@pytest.mark.parametrize(
    "changes",
    [
        {"token_ttl": timedelta(0)},
        {"family_max_ttl": timedelta(seconds=-1)},
        {"reuse_grace_seconds": -1},
    ],
)
def test_invalid_lifetimes_are_refused(changes: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="must"):
        RefreshTokenConfig("p:", **changes)  # type: ignore[arg-type]
