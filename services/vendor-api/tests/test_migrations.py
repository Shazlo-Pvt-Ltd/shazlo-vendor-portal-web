from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text

from vendor_api.db.session import sync_url

TABLES = {
    "vendors",
    "vendor_status_events",
    "vendor_users",
    "auth_tokens",
    "assets",
    "brand_profiles",
}
# Helper functions the schema creates: a downgrade must remove them too.
FUNCTIONS = (
    "vendor_status_events_append_only",
    "is_clean_text_list",
    "enforce_version_increases",
)


def _tables(url: str) -> set[str]:
    engine = create_engine(sync_url(url))
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_downgrade_base_then_upgrade_head(alembic_config: Config, migrated_db: str) -> None:
    assert _tables(migrated_db) >= TABLES

    # The schema is shared by the whole session, so always leave it at head for later tests.
    try:
        command.downgrade(alembic_config, "base")
        assert not TABLES & _tables(migrated_db)
    finally:
        command.upgrade(alembic_config, "head")
    assert _tables(migrated_db) >= TABLES


def _function_count(engine: Engine) -> int:
    query = text("SELECT count(*) FROM pg_proc WHERE proname = ANY(:names)")
    with engine.connect() as connection:
        return int(connection.scalar(query, {"names": list(FUNCTIONS)}) or 0)


def test_downgrade_removes_the_database_functions(alembic_config: Config, migrated_db: str) -> None:
    engine = create_engine(sync_url(migrated_db))
    try:
        assert _function_count(engine) == len(FUNCTIONS)
        try:
            command.downgrade(alembic_config, "base")
            assert _function_count(engine) == 0
        finally:
            command.upgrade(alembic_config, "head")
        assert _function_count(engine) == len(FUNCTIONS)
    finally:
        engine.dispose()


def test_the_brand_profile_migration_alone_can_be_undone_and_redone(
    alembic_config: Config, migrated_db: str
) -> None:
    try:
        command.downgrade(alembic_config, "0002")
        tables = _tables(migrated_db)
        assert {"vendors", "vendor_users"} <= tables
        assert not {"assets", "brand_profiles"} & tables
    finally:
        command.upgrade(alembic_config, "head")
    assert {"assets", "brand_profiles"} <= _tables(migrated_db)


def test_models_match_migrations(alembic_config: Config, migrated_db: str) -> None:
    # Fails if a model changes without a migration.
    command.check(alembic_config)
