import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from shazlo_security.passwords import PasswordService
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import Api, make_api

from vendor_api import cli
from vendor_api.core.security import password_config
from vendor_api.core.settings import Settings, get_settings
from vendor_api.db.models import Vendor, VendorStatusEvent, VendorUser
from vendor_api.openapi import OPENAPI_PATH, build_openapi
from vendor_api.services.seed import (
    DEV_SEED_PASSWORD,
    SEED_OWNER_EMAIL,
    SEED_SLUG,
    SEED_STAFF_EMAIL,
    CatalogSeed,
    seed_demo_vendor,
)

SEED_PASSWORD = "local-dev-password-1"  # noqa: S105


# --- openapi.json ------------------------------------------------------------------------


def test_openapi_json_is_up_to_date() -> None:
    """The committed document is what the app generates. If this fails, a route or a schema
    changed: run `python -m vendor_api.cli export-openapi` and commit the result."""
    committed = OPENAPI_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == build_openapi(), (
        "openapi.json is stale: run python -m vendor_api.cli export-openapi"
    )


def test_the_generated_document_is_stable_and_complete() -> None:
    first, second = build_openapi(), build_openapi()
    assert first == second  # the throwaway signing key never reaches it
    document = json.loads(first)
    assert document["info"]["title"] == "vendor-api"
    paths = set(document["paths"])
    assert {
        "/v1/auth/signup",
        "/v1/auth/login",
        "/v1/auth/refresh",
        "/v1/auth/set-password",
        "/v1/vendor/me",
        "/v1/vendor/users",
        "/v1/admin/me",
        "/.well-known/jwks.json",
    } <= paths
    assert "PRIVATE" not in first


def test_check_passes_when_current_and_fails_when_stale(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    target = tmp_path / "openapi.json"
    assert cli.main(["export-openapi", "--out", str(target)]) == 0
    assert cli.main(["export-openapi", "--check", "--out", str(target)]) == 0
    assert "up to date" in capsys.readouterr().out

    target.write_text("{}\n", encoding="utf-8")
    assert cli.main(["export-openapi", "--check", "--out", str(target)]) == 1
    assert "stale" in capsys.readouterr().err
    assert cli.main(["export-openapi", "--check", "--out", str(tmp_path / "missing.json")]) == 1


def test_the_committed_file_ends_with_one_newline_and_uses_unix_endings() -> None:
    raw = OPENAPI_PATH.read_bytes()
    assert raw.endswith(b"}\n") or raw.endswith(b"}\r\n")
    assert not raw.endswith(b"\n\n")


# --- The dev seed ------------------------------------------------------------------------


@pytest.fixture
def seed_hasher(settings: Settings) -> PasswordService:
    return PasswordService(password_config(settings.model_copy(update={"argon2_time_cost": 1})))


async def test_the_seed_creates_an_approved_vendor_with_two_verified_users(
    session: AsyncSession, seed_hasher: PasswordService
) -> None:
    assert await seed_demo_vendor(session, seed_hasher, SEED_PASSWORD) is True

    vendor = await session.scalar(select(Vendor).where(Vendor.slug == SEED_SLUG))
    assert vendor is not None
    assert vendor.status == "approved"
    users = {
        user.email: user
        for user in await session.scalars(
            select(VendorUser).where(VendorUser.vendor_id == vendor.id)
        )
    }
    assert set(users) == {SEED_OWNER_EMAIL, SEED_STAFF_EMAIL}
    assert (users[SEED_OWNER_EMAIL].role, users[SEED_STAFF_EMAIL].role) == ("owner", "staff")
    for user in users.values():
        assert user.status == "active"
        assert user.email_verified_at is not None
        assert user.password_hash is not None
        assert SEED_PASSWORD not in user.password_hash
        assert (await seed_hasher.verify_login(user.password_hash, SEED_PASSWORD)).ok
    (event,) = (await session.scalars(select(VendorStatusEvent))).all()
    assert (event.from_status, event.to_status, event.actor_type) == (None, "approved", "system")


async def test_running_the_seed_twice_changes_nothing(
    session: AsyncSession, seed_hasher: PasswordService
) -> None:
    await seed_demo_vendor(session, seed_hasher, SEED_PASSWORD)
    before = [
        (u.id, u.password_hash)
        for u in await session.scalars(select(VendorUser).order_by(VendorUser.email))
    ]
    assert await seed_demo_vendor(session, seed_hasher, "a-different-password-2") is False
    after = [
        (u.id, u.password_hash)
        for u in await session.scalars(
            select(VendorUser).order_by(VendorUser.email).execution_options(populate_existing=True)
        )
    ]
    assert after == before  # a later run never replaces a password someone has set
    assert await session.scalar(select(func.count()).select_from(Vendor)) == 1


async def test_the_seed_leaves_a_user_with_one_of_its_addresses_alone(
    session: AsyncSession, seed_hasher: PasswordService
) -> None:
    from support import make_account

    await make_account(session, seed_hasher, email=SEED_STAFF_EMAIL)
    assert await seed_demo_vendor(session, seed_hasher, SEED_PASSWORD) is False
    assert await session.scalar(select(func.count()).select_from(Vendor)) == 1


async def test_the_seeded_users_can_sign_in(
    settings: Settings, override: object, session: AsyncSession
) -> None:
    from fakeredis import FakeAsyncRedis

    configured = override(  # type: ignore[operator]
        settings, argon2_memory_cost_kib=8, argon2_time_cost=1, jwt_issuer="https://vendor-api.test"
    )
    hasher = PasswordService(password_config(configured))
    await seed_demo_vendor(session, hasher, SEED_PASSWORD)
    fake = FakeAsyncRedis()
    try:
        async for api in make_api(configured, session, fake):
            owner: Api = api
            login = await owner.login(SEED_OWNER_EMAIL, SEED_PASSWORD)
            assert login.status_code == 200
            assert login.json()["vendor"]["status"] == "approved"
            assert (await owner.login(SEED_STAFF_EMAIL, SEED_PASSWORD)).json()["user"][
                "role"
            ] == "staff"
    finally:
        await fake.aclose()


@pytest.fixture
def clean_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    get_settings.cache_clear()
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize("env", ["test", "prod"])
def test_the_seed_command_only_runs_in_dev(
    clean_settings: None,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    env: str,
) -> None:
    monkeypatch.setenv("ENV", env)
    if env == "prod":
        for name, value in {
            "EMAIL_BACKEND": "smtp",
            "SMTP_HOST": "smtp.provider.example",
            "PORTAL_BASE_URL": "https://vendors.shazlo.store",
            "RATE_LIMIT_HMAC_KEY": "k" * 32,
            "IDENTITY_JWKS_URL": "https://identity.shazlo.store/.well-known/jwks.json",
            "IDENTITY_ISSUER": "https://identity.shazlo.store",
            "JWT_ISSUER": "https://vendor-api.shazlo.store",
        }.items():
            monkeypatch.setenv(name, value)
    assert cli.main(["seed-dev"]) == 1
    assert "only runs with ENV=dev" in capsys.readouterr().err


def test_the_seed_command_refuses_a_short_password(
    clean_settings: None, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ENV", "dev")
    assert cli.main(["seed-dev", "--password", "short"]) == 1
    assert "at least 12 characters" in capsys.readouterr().err


def test_the_seed_command_never_prints_the_password(
    clean_settings: None, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ENV", "dev")
    passwords: list[str] = []
    results = iter([True, False])

    async def fake_seed(password: str) -> bool:
        passwords.append(password)
        return next(results)

    async def fake_catalog(password: str) -> CatalogSeed | None:
        return None  # the catalog has its own tests (test_seed_catalog.py)

    monkeypatch.setattr(cli, "_seed_dev", fake_seed)
    monkeypatch.setattr(cli, "_seed_catalog", fake_catalog)
    assert cli.main(["seed-dev", "--password", SEED_PASSWORD]) == 0
    first = capsys.readouterr().out
    assert SEED_OWNER_EMAIL in first
    assert SEED_STAFF_EMAIL in first
    assert "local use only" in first
    assert SEED_PASSWORD not in first  # a password is never echoed

    assert cli.main(["seed-dev"]) == 0
    second = capsys.readouterr().out
    assert "already exists" in second
    assert passwords == [SEED_PASSWORD, DEV_SEED_PASSWORD]  # the documented default is the fallback
    assert DEV_SEED_PASSWORD not in second


def test_the_default_password_is_valid_and_documented() -> None:
    assert len(DEV_SEED_PASSWORD) >= 12
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
    assert DEV_SEED_PASSWORD in readme
