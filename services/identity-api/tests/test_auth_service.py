"""AuthService races against Redis (fakeredis), with a stand-in for the database.

The database tests in test_auth_api.py need Postgres; these pin the ordering that keeps a login
with the old password from outliving a password change, which only needs one admin row.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any, cast

import pytest
from fakeredis import FakeAsyncRedis
from shazlo_security.keys import load_keyring
from shazlo_security.passwords import PasswordCheck, PasswordService
from shazlo_security.refresh_tokens import (
    InvalidRefreshTokenError,
    RefreshSession,
    RefreshTokenStore,
)
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.core.errors import ApiError
from identity_api.core.security import (
    key_ring_config,
    password_config,
    refresh_token_config,
    token_issuer,
)
from identity_api.core.settings import Settings
from identity_api.db.models import Admin
from identity_api.services.auth import AuthService, AuthSession

ADMIN_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
EMAIL = "reviewer@shazlo.test"
PASSWORD = "correct horse battery"
NEW_PASSWORD = "another long passphrase"


class FakeDatabase:
    """One `admins` row. Each FakeSession reads it on load and refresh and writes it on commit."""

    def __init__(self, password_hash: str) -> None:
        self.row: dict[str, Any] = {"password_hash": password_hash, "is_active": True}

    def session(self) -> AsyncSession:
        return cast(AsyncSession, FakeSession(self))


class FakeSession:
    def __init__(self, database: FakeDatabase) -> None:
        self._database = database
        self._admin: Admin | None = None

    async def scalar(self, _statement: object) -> Admin:
        return self.load()

    async def get(self, _model: object, _id: object) -> Admin:
        return self.load()

    async def refresh(
        self, admin: Admin, attribute_names: list[str], with_for_update: bool = False
    ) -> None:
        for name in attribute_names:
            setattr(admin, name, self._database.row[name])

    async def commit(self) -> None:
        if self._admin is not None:
            for name in self._database.row:
                self._database.row[name] = getattr(self._admin, name)

    async def rollback(self) -> None:
        pass

    def load(self) -> Admin:
        self._admin = Admin(
            id=ADMIN_ID,
            email=EMAIL,
            display_name="Test Admin",
            must_change_password=False,
            roles=[],
            **self._database.row,
        )
        return self._admin


@pytest.fixture
def fast_settings(settings: Settings, override: Callable[..., Settings]) -> Settings:
    return override(settings, argon2_memory_cost_kib=8, argon2_time_cost=1)


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture
def passwords(fast_settings: Settings) -> PasswordService:
    return PasswordService(password_config(fast_settings))


@pytest.fixture
def store(redis: FakeAsyncRedis, fast_settings: Settings) -> RefreshTokenStore:
    return RefreshTokenStore(redis, refresh_token_config(fast_settings))


@pytest.fixture
def auth(
    fast_settings: Settings, passwords: PasswordService, store: RefreshTokenStore
) -> AuthService:
    issuer = token_issuer(fast_settings, load_keyring(key_ring_config(fast_settings)))
    return AuthService(fast_settings, passwords, issuer, store)


@pytest.fixture
async def database(passwords: PasswordService) -> FakeDatabase:
    return FakeDatabase(await passwords.hash(PASSWORD))


async def change_password(auth: AuthService, database: FakeDatabase) -> AuthSession:
    db = FakeSession(database)
    return await auth.change_password(cast(AsyncSession, db), db.load(), PASSWORD, NEW_PASSWORD)


async def assert_dead(store: RefreshTokenStore, session: RefreshSession) -> None:
    with pytest.raises(InvalidRefreshTokenError):
        await store.rotate(session.token)


async def test_password_change_during_the_password_check_fails_the_login(
    auth: AuthService,
    database: FakeDatabase,
    passwords: PasswordService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The login loaded the old hash and verifies the old password; the change commits now."""
    verify = passwords.verify_login
    changed: list[AuthSession] = []
    racing = False

    async def verify_then_change(stored_hash: str | None, password: str) -> PasswordCheck:
        nonlocal racing
        check = await verify(stored_hash, password)
        if not racing:  # the login's check, not the one inside change_password
            racing = True
            changed.append(await change_password(auth, database))
        return check

    monkeypatch.setattr(passwords, "verify_login", verify_then_change)
    with pytest.raises(ApiError) as error:
        await auth.login(database.session(), EMAIL, PASSWORD)
    assert error.value.code == "invalid_credentials"
    # The session the password change started is unaffected.
    assert (await auth.refresh(database.session(), changed[0].refresh.token)).admin.id == ADMIN_ID


async def test_password_change_before_the_family_starts_fails_the_login(
    auth: AuthService,
    database: FakeDatabase,
    store: RefreshTokenStore,
    redis: FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The change commits and revokes after the login's checks, before its family exists."""
    start_family = store.start_family
    changed: list[AuthSession] = []
    racing = False

    async def change_then_start(admin_id: uuid.UUID, generation: int) -> RefreshSession:
        nonlocal racing
        if not racing:  # the login's family, not the one change_password starts
            racing = True
            changed.append(await change_password(auth, database))
        return await start_family(admin_id, generation)

    monkeypatch.setattr(store, "start_family", change_then_start)
    with pytest.raises(ApiError) as error:
        await auth.login(database.session(), EMAIL, PASSWORD)
    assert error.value.code == "invalid_credentials"
    families = {
        f.decode() if isinstance(f, bytes) else f
        for f in await redis.smembers(f"identity:ra:{ADMIN_ID}")
    }
    assert families == {changed[0].refresh.family_id}


async def test_password_change_after_login_ends_its_session(
    auth: AuthService, database: FakeDatabase, store: RefreshTokenStore
) -> None:
    logged_in = await auth.login(database.session(), EMAIL, PASSWORD)
    await change_password(auth, database)
    await assert_dead(store, logged_in.refresh)


async def test_concurrent_login_and_password_change_never_leave_an_old_session(
    auth: AuthService, database: FakeDatabase, store: RefreshTokenStore
) -> None:
    login, changed = await asyncio.gather(
        auth.login(database.session(), EMAIL, PASSWORD),
        change_password(auth, database),
        return_exceptions=True,
    )
    assert isinstance(changed, AuthSession)
    if isinstance(login, AuthSession):
        await assert_dead(store, login.refresh)
    else:
        assert isinstance(login, ApiError)
        assert login.code == "invalid_credentials"
    assert (await auth.refresh(database.session(), changed.refresh.token)).admin.id == ADMIN_ID


async def test_concurrent_refreshes_return_a_conflict_not_a_revocation(
    auth: AuthService, database: FakeDatabase
) -> None:
    session = await auth.login(database.session(), EMAIL, PASSWORD)
    results = await asyncio.gather(
        auth.refresh(database.session(), session.refresh.token),
        auth.refresh(database.session(), session.refresh.token),
        return_exceptions=True,
    )
    winners = [r for r in results if isinstance(r, AuthSession)]
    errors = [r for r in results if isinstance(r, ApiError)]
    assert len(winners) == 1
    assert [(e.status_code, e.code) for e in errors] == [(409, "refresh_conflict")]
    assert await auth.refresh(database.session(), winners[0].refresh.token)
