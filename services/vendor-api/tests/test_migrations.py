from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from vendor_api.db.session import sync_url

TABLES = {"vendors", "vendor_status_events", "vendor_users", "auth_tokens"}


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


def test_downgrade_removes_the_audit_trigger_function(
    alembic_config: Config, migrated_db: str
) -> None:
    engine = create_engine(sync_url(migrated_db))
    query = text("SELECT count(*) FROM pg_proc WHERE proname = 'vendor_status_events_append_only'")
    try:
        with engine.connect() as connection:
            assert connection.scalar(query) == 1
        try:
            command.downgrade(alembic_config, "base")
            with engine.connect() as connection:
                assert connection.scalar(query) == 0
        finally:
            command.upgrade(alembic_config, "head")
    finally:
        engine.dispose()


def test_models_match_migrations(alembic_config: Config, migrated_db: str) -> None:
    # Fails if a model changes without a migration.
    command.check(alembic_config)
