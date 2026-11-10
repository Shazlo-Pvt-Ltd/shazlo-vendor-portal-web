import json
import os
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fakeredis import FakeAsyncRedis
from shazlo_security.keys import generate_private_key, private_key_pem
from shazlo_security.passwords import PasswordService
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from support import IDENTITY_ISSUER, JWKS_URL, PASSWORD, Api, Identity, make_api

from vendor_api.core.security import password_config
from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorUser, VendorUserRole
from vendor_api.db.session import async_url

SERVICE_DIR = Path(__file__).resolve().parents[1]

# Postgres for the database tests (CI sets it; locally use vendor_test). Unset: they are skipped.
TEST_DATABASE_URL = os.environ.get("DATABASE_URL", "")


@pytest.fixture(scope="session")
def key_pems() -> dict[str, str]:
    """Two generated private keys by kid. Generating RSA keys is slow, so once per run."""
    return {
        kid: private_key_pem(generate_private_key()).decode()
        for kid in ("test-key-1", "test-key-2")
    }


@pytest.fixture
def settings(key_pems: dict[str, str]) -> Settings:
    return Settings(
        _env_file=None,
        env="test",
        database_url="postgresql+asyncpg://user:pw@localhost:5432/vendor_test",
        redis_url="redis://localhost:6379/0",
        jwt_keys=json.dumps({"test-key-1": key_pems["test-key-1"]}),
    )


@pytest.fixture
def override() -> Callable[..., Settings]:
    """A validated copy of settings with changes (`model_copy(update=)` skips validation)."""

    def apply(base: Settings, **changes: object) -> Settings:
        return Settings.model_validate({**base.model_dump(), **changes})

    return apply


@pytest.fixture(scope="session")
def alembic_config() -> Config:
    if not TEST_DATABASE_URL:
        pytest.skip("DATABASE_URL is not set")
    # The suite drops and recreates the schema, so never run it against a non-test database.
    database = make_url(TEST_DATABASE_URL).database or ""
    if not (database == "test" or database.endswith("_test")):
        pytest.fail(f"refusing to migrate {database!r}: DATABASE_URL must name `test` or `*_test`")
    config = Config(str(SERVICE_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL.replace("%", "%%"))
    config.attributes["configure_logger"] = False
    return config


@pytest.fixture(scope="session")
def migrated_db(alembic_config: Config) -> str:
    """Applies the migrations once per test run, starting from an empty schema."""
    command.downgrade(alembic_config, "base")
    command.upgrade(alembic_config, "head")
    return TEST_DATABASE_URL


@pytest.fixture
async def session(migrated_db: str) -> AsyncIterator[AsyncSession]:
    """A session inside a transaction that is rolled back after the test, so tests share no rows.

    Commits inside the test only release a savepoint.
    """
    engine = create_async_engine(async_url(migrated_db), poolclass=NullPool)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        db_session = AsyncSession(
            bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            yield db_session
        finally:
            await db_session.close()
            await transaction.rollback()
    await engine.dispose()


# --- Two vendors, for isolation tests ----------------------------------------------------


@dataclass
class Tenant:
    """One vendor with an owner, a staff member and an invited staff member (no password yet),
    and a valid access token for the owner and the staff member."""

    vendor: Vendor
    owner: VendorUser
    staff: VendorUser
    invited: VendorUser
    owner_token: str
    staff_token: str

    @property
    def users(self) -> list[VendorUser]:
        return [self.owner, self.staff, self.invited]


@dataclass
class Tenants:
    """Vendor A and vendor B, an admin token (a `vendor_reviewer` from identity-api) and the API.

    Use it to write an isolation test in a few lines: act as one tenant on the other's ids and
    expect a 404.
    """

    api: Api
    a: Tenant
    b: Tenant
    admin_token: str
    # identity-api for the tests: mint a token with other roles (`identity.token(["super_admin"])`).
    identity: Identity


async def _tenant(session: AsyncSession, api: Api, hasher: PasswordService, key: str) -> Tenant:
    vendor = Vendor(
        name=f"Brand {key.upper()}",
        slug=f"brand-{key}",
        email=f"owner@{key}.test",
        phone="+911234567890",
        contact_name="Owner",
        product_type="apparel",
        price_min_paise=10_000,
        price_max_paise=90_000,
    )
    session.add(vendor)
    await session.flush()
    password_hash = await hasher.hash(PASSWORD)
    now = datetime.now(UTC)
    owner, staff = (
        VendorUser(
            vendor_id=vendor.id,
            email=f"{name}@{key}.test",
            password_hash=password_hash,
            role=role,
            status="active",
            email_verified_at=now,
        )
        for name, role in (("owner", VendorUserRole.OWNER), ("staff", VendorUserRole.STAFF))
    )
    invited = VendorUser(
        vendor_id=vendor.id,
        email=f"invited@{key}.test",
        role=VendorUserRole.STAFF,
        status="invited",
    )
    session.add_all([owner, staff, invited])
    await session.commit()
    tokens = api.app.state.vendor_tokens
    return Tenant(
        vendor,
        owner,
        staff,
        invited,
        owner_token=tokens.issue(
            user_id=owner.id, vendor_id=vendor.id, role=VendorUserRole.OWNER
        ).token,
        staff_token=tokens.issue(
            user_id=staff.id, vendor_id=vendor.id, role=VendorUserRole.STAFF
        ).token,
    )


@pytest.fixture
async def tenants(
    session: AsyncSession, settings: Settings, override: Callable[..., Settings]
) -> AsyncIterator[Tenants]:
    identity = Identity()
    configured = override(
        settings,
        jwt_issuer="https://vendor-api.test",
        identity_jwks_url=JWKS_URL,
        identity_issuer=IDENTITY_ISSUER,
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
    )
    redis = FakeAsyncRedis()
    hasher = PasswordService(password_config(configured))
    async for api in make_api(configured, session, redis, identity.client):
        yield Tenants(
            api=api,
            a=await _tenant(session, api, hasher, "a"),
            b=await _tenant(session, api, hasher, "b"),
            admin_token=identity.token(["vendor_reviewer"]),
            identity=identity,
        )
    await redis.aclose()
