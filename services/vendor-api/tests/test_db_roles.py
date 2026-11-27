"""Each app's own database login, with only the table rights it needs (ADR 0011, migration 0012).

Every other test runs the seller app's requests as `vendor_seller`, the admin app's as
`vendor_admin` and the worker's jobs as `vendor_worker` (support.as_role), so a right an app is
missing fails there. These tests pin the rights themselves, check what each role is refused, and
cover the `db-logins` command and the production checks that refuse an all-powerful login.
"""

import secrets
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from support import ADMIN_ROLE, SELLER_ROLE, WORKER_ROLE, as_role

from vendor_api import cli, worker
from vendor_api.api.health import default_readiness_checks
from vendor_api.core.settings import Settings
from vendor_api.db.base import Base
from vendor_api.db.roles import GROUP_ROLES, POWER_SQL, power_problems
from vendor_api.db.session import async_url, libpq_url

ROLES = (SELLER_ROLE, ADMIN_ROLE, WORKER_ROLE)
R, C, U, D = "SELECT", "INSERT", "UPDATE", "DELETE"

# The rights each app has today. A change here is a change to what an app may do: make it in a
# migration too, and say why there.
EXPECTED: dict[str, dict[str, set[str]]] = {
    "vendors": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R, U}, WORKER_ROLE: {R}},
    "vendor_status_events": {SELLER_ROLE: {R, C}, ADMIN_ROLE: {R, C}, WORKER_ROLE: {R}},
    "vendor_users": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R}},
    "auth_tokens": {SELLER_ROLE: {R, C, U}},
    "assets": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R}, WORKER_ROLE: {R}},
    "brand_profiles": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R, U}, WORKER_ROLE: {R}},
    "products": {SELLER_ROLE: {R, C, U, D}, ADMIN_ROLE: {R, U}, WORKER_ROLE: {R}},
    "product_revisions": {SELLER_ROLE: {R, C, U, D}, ADMIN_ROLE: {R, U}, WORKER_ROLE: {R}},
    "product_variants": {SELLER_ROLE: {R, C, U, D}, ADMIN_ROLE: {R}, WORKER_ROLE: {R}},
    "product_revision_variants": {SELLER_ROLE: {R, C, U, D}, ADMIN_ROLE: {R}, WORKER_ROLE: {R}},
    "product_images": {SELLER_ROLE: {R, C, U, D}, ADMIN_ROLE: {R}, WORKER_ROLE: {R}},
    "reviews": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R, U}, WORKER_ROLE: {R}},
    "review_events": {SELLER_ROLE: {R, C}, ADMIN_ROLE: {R, C}},
    "outbox_events": {SELLER_ROLE: {R, C}, ADMIN_ROLE: {R, C, U}, WORKER_ROLE: {R, C, U, D}},
    "outbox_event_log": {ADMIN_ROLE: {R, C}, WORKER_ROLE: {R, C}},
    "store_details": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R}},
    "commissions": {SELLER_ROLE: {R, C, U}, ADMIN_ROLE: {R, C, U}},
    "size_charts": {SELLER_ROLE: {R, C, U, D}, ADMIN_ROLE: {R}, WORKER_ROLE: {R}},
    "vendor_change_events": {SELLER_ROLE: {R, C}, ADMIN_ROLE: {R, C}},
}

# Rights on single columns (the rest of the table stays out of reach).
EXPECTED_COLUMNS: dict[tuple[str, str], set[tuple[str, str]]] = {
    ("products", WORKER_ROLE): {("version", U), ("updated_at", U)},
}

# The event logs only ever grow: on top of their triggers, nobody may change or delete a row.
APPEND_ONLY = ("vendor_status_events", "review_events", "vendor_change_events", "outbox_event_log")


async def granted(session: AsyncSession) -> dict[str, dict[str, set[str]]]:
    rows = await session.execute(
        text(
            "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
            "WHERE table_schema = 'public' AND grantee = ANY(:roles)"
        ),
        {"roles": list(ROLES)},
    )
    found: dict[str, dict[str, set[str]]] = {}
    for table, role, right in rows:
        found.setdefault(table, {}).setdefault(role, set()).add(right)
    return found


async def column_grants(session: AsyncSession) -> dict[tuple[str, str], set[tuple[str, str]]]:
    """Rights granted on single columns (pg_attribute.attacl), not those a table grant implies."""
    rows = await session.execute(
        text(
            "SELECT c.relname, acl.grantee::regrole::text, a.attname, acl.privilege_type "
            "FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(a.attacl) AS acl "
            "WHERE n.nspname = 'public' AND a.attacl IS NOT NULL"
        )
    )
    found: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for table, role, column, right in rows:
        if role in ROLES:
            found.setdefault((table, role), set()).add((column, right))
    return found


async def refused(session: AsyncSession, role: str, statement: str) -> bool:
    """Whether `role` is refused `statement`. Run in a savepoint that is rolled back either way,
    which also undoes the SET ROLE."""
    savepoint = await session.begin_nested()
    try:
        await session.execute(text(f"SET ROLE {role}"))
        await session.execute(text(statement))
    except DBAPIError as error:
        message = str(error.orig)
        denied = "permission denied" in message or "must be owner" in message
    else:
        denied = False
    await savepoint.rollback()
    return denied


# --- The rights ------------------------------------------------------------------------------


async def test_every_table_has_a_line_in_the_matrix() -> None:
    assert set(Base.metadata.tables) == set(EXPECTED)


async def test_each_app_has_exactly_its_rights(session: AsyncSession) -> None:
    assert await granted(session) == EXPECTED


async def test_single_column_rights_are_only_these(session: AsyncSession) -> None:
    assert await column_grants(session) == EXPECTED_COLUMNS


async def test_nobody_may_change_or_delete_an_event_log_row(session: AsyncSession) -> None:
    rights = await granted(session)
    for table in APPEND_ONLY:
        for role, allowed in rights.get(table, {}).items():
            assert not allowed & {U, D, "TRUNCATE"}, (table, role)


async def test_the_group_roles_cannot_log_in_or_do_more(session: AsyncSession) -> None:
    rows = await session.execute(
        text(
            "SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls "
            "FROM pg_roles WHERE rolname = ANY(:roles)"
        ),
        {"roles": list(ROLES)},
    )
    found = {name: rest for name, *rest in rows}
    assert set(found) == set(ROLES)
    for role, powers in found.items():
        assert powers == [False] * 5, role


async def test_the_roles_are_the_ones_the_cli_and_checks_use() -> None:
    assert set(GROUP_ROLES.values()) == set(ROLES)


# --- What each app is refused ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("role", "statement"),
    [
        # The admin app never sees a seller's password or sign-in tokens, nor sets them.
        (ADMIN_ROLE, "SELECT token_hash FROM auth_tokens"),
        (ADMIN_ROLE, "UPDATE vendor_users SET password_hash = 'x'"),
        (ADMIN_ROLE, "INSERT INTO vendors (name) VALUES ('x')"),
        (ADMIN_ROLE, "DELETE FROM products"),
        # The seller app never marks an event sent or writes the delivery log.
        (SELLER_ROLE, "UPDATE outbox_events SET status = 'sent'"),
        (SELLER_ROLE, "DELETE FROM outbox_events"),
        (SELLER_ROLE, "SELECT * FROM outbox_event_log"),
        # The worker only reads the catalog; it writes nothing but the outbox.
        # The worker may raise a product's version (reconciliation), and change nothing else.
        (WORKER_ROLE, "UPDATE products SET status = 'approved'"),
        (WORKER_ROLE, "UPDATE products SET live_revision_id = NULL"),
        (WORKER_ROLE, "INSERT INTO reviews (subject) VALUES ('product')"),
        (WORKER_ROLE, "SELECT password_hash FROM vendor_users"),
        (WORKER_ROLE, "SELECT * FROM auth_tokens"),
        # Nobody changes the schema or empties a table.
        (SELLER_ROLE, "TRUNCATE review_events"),
        (ADMIN_ROLE, "TRUNCATE vendors"),
        (WORKER_ROLE, "TRUNCATE outbox_events"),
        (SELLER_ROLE, "CREATE TABLE stolen (id int)"),
        (ADMIN_ROLE, "ALTER TABLE reviews DISABLE TRIGGER ALL"),
        (WORKER_ROLE, "DROP TABLE outbox_event_log"),
    ],
)
async def test_an_app_is_refused_what_is_not_its_job(
    session: AsyncSession, role: str, statement: str
) -> None:
    assert await refused(session, role, statement)


async def test_the_refusals_are_real_and_not_a_broken_test(session: AsyncSession) -> None:
    # The same machinery lets a role do what it may.
    assert not await refused(session, SELLER_ROLE, "SELECT count(*) FROM vendor_users")
    assert not await refused(session, ADMIN_ROLE, "SELECT count(*) FROM reviews")
    assert not await refused(session, WORKER_ROLE, "SELECT count(*) FROM outbox_events")
    current = await session.execute(text("SELECT current_user"))
    assert current.scalar_one() not in ROLES  # back to the test's owner


# --- Refusing an all-powerful login ----------------------------------------------------------


async def power(session: AsyncSession) -> list[str]:
    row = (await session.execute(text(POWER_SQL))).mappings().one()
    return power_problems(row)


async def test_the_owner_of_the_tables_is_too_powerful_for_an_app(session: AsyncSession) -> None:
    problems = await power(session)
    assert "owns the tables (or is a member of their owner)" in problems


@pytest.mark.parametrize("role", ROLES)
async def test_an_app_role_has_no_power_beyond_its_rows(session: AsyncSession, role: str) -> None:
    async with as_role(session, role):
        assert await power(session) == []


def test_production_readiness_checks_the_login_and_dev_does_not(settings: Settings) -> None:
    dev = default_readiness_checks(settings)
    # model_copy skips validation, which is fine here: the checks read only env and the URLs.
    prod = default_readiness_checks(settings.model_copy(update={"env": "prod"}))
    assert set(dev) == {"postgres", "redis"}
    assert set(prod) == {"postgres", "redis", "database_role"}


async def test_the_readiness_check_fails_for_the_owner(
    migrated_db: str, settings: Settings
) -> None:
    check = default_readiness_checks(
        settings.model_copy(update={"env": "prod", "database_url": migrated_db})
    )["database_role"]
    with pytest.raises(PermissionError, match="owns the tables"):
        await check()


async def test_the_worker_refuses_to_start_as_the_owner(migrated_db: str) -> None:
    engine = create_async_engine(async_url(migrated_db), poolclass=NullPool)
    try:
        with pytest.raises(RuntimeError, match="vendor_worker login"):
            await worker.refuse_a_powerful_login(engine)
    finally:
        await engine.dispose()


# --- db-logins -------------------------------------------------------------------------------


@pytest.fixture
async def logins(
    migrated_db: str, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[dict[str, str]]:
    """Three throwaway login names and passwords for db-logins. Roles belong to the whole server,
    so they are dropped after the test."""
    tag = uuid.uuid4().hex[:8]
    names = {app: f"t_{app}_{tag}" for app in ("seller", "admin", "worker")}
    passwords = {app: secrets.token_urlsafe(24) for app in names}
    monkeypatch.setenv("DATABASE_URL", migrated_db)
    for app in names:
        monkeypatch.setenv(f"VENDOR_{app.upper()}_DB_USER", names[app])
        monkeypatch.setenv(f"VENDOR_{app.upper()}_DB_PASSWORD", passwords[app])
    yield {**{f"{app}_user": name for app, name in names.items()}, **passwords}
    connection = await asyncpg.connect(libpq_url(migrated_db))
    try:
        for name in names.values():
            await connection.execute(f'DROP ROLE IF EXISTS "{name}"')
    finally:
        await connection.close()


async def connect_as(migrated_db: str, user: str, password: str) -> asyncpg.Connection:
    url = make_url(libpq_url(migrated_db)).set(username=user, password=password)
    return await asyncpg.connect(url.render_as_string(hide_password=False))


async def test_db_logins_makes_one_login_per_app_with_only_its_group(
    logins: dict[str, str], migrated_db: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["db-logins"]) == 0
    out = capsys.readouterr().out
    assert f"Created {logins['admin_user']} (member of vendor_admin)." in out
    for secret in (logins["seller"], logins["admin"], logins["worker"]):
        assert secret not in out

    admin = await connect_as(migrated_db, logins["admin_user"], logins["admin"])
    try:
        row = await admin.fetchrow(POWER_SQL)
        assert row is not None and power_problems(row) == []
        await admin.fetchval("SELECT count(*) FROM reviews")
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await admin.fetchval("SELECT count(*) FROM auth_tokens")
    finally:
        await admin.close()
    seller = await connect_as(migrated_db, logins["seller_user"], logins["seller"])
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await seller.fetchval("SELECT count(*) FROM outbox_event_log")
    finally:
        await seller.close()


async def test_db_logins_again_changes_the_password(
    logins: dict[str, str],
    migrated_db: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["db-logins", "--app", "worker"]) == 0
    monkeypatch.setenv("VENDOR_WORKER_DB_PASSWORD", "a-brand-new-password-0123")
    assert cli.main(["db-logins", "--app", "worker"]) == 0
    assert f"Updated the password of {logins['worker_user']}" in capsys.readouterr().out
    with pytest.raises(asyncpg.InvalidPasswordError):
        await connect_as(migrated_db, logins["worker_user"], logins["worker"])
    fresh = await connect_as(migrated_db, logins["worker_user"], "a-brand-new-password-0123")
    await fresh.close()


def test_db_logins_refuses_a_short_or_missing_password(
    logins: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("VENDOR_SELLER_DB_PASSWORD", "short")
    monkeypatch.delenv("VENDOR_ADMIN_DB_PASSWORD")
    assert cli.main(["db-logins"]) == 1
    err = capsys.readouterr().err
    assert "set VENDOR_SELLER_DB_PASSWORD to at least 16 characters" in err
    assert "set VENDOR_ADMIN_DB_PASSWORD to at least 16 characters" in err


def test_db_logins_refuses_one_name_for_two_apps(
    logins: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("VENDOR_ADMIN_DB_USER", logins["seller_user"])
    assert cli.main(["db-logins"]) == 1
    assert "each app needs its own login name" in capsys.readouterr().err


async def test_db_logins_refuses_a_login_that_holds_another_apps_rights(
    logins: dict[str, str], migrated_db: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["db-logins", "--app", "seller"]) == 0
    connection = await asyncpg.connect(libpq_url(migrated_db))
    try:
        await connection.execute(f'GRANT vendor_admin TO "{logins["seller_user"]}"')
    finally:
        await connection.close()
    assert cli.main(["db-logins", "--app", "seller"]) == 1
    assert "is also a member of vendor_admin" in capsys.readouterr().err
