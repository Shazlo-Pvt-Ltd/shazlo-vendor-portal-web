from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from vendor_api.db.session import sync_url


def _tables(url: str) -> set[str]:
    engine = create_engine(sync_url(url))
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_baseline_upgrades_and_downgrades(alembic_config: Config, migrated_db: str) -> None:
    # Only Alembic's own bookkeeping exists until the schema issues add tables.
    assert _tables(migrated_db) <= {"alembic_version"}

    # The schema is shared by the whole session, so always leave it at head for later tests.
    try:
        command.downgrade(alembic_config, "base")
    finally:
        command.upgrade(alembic_config, "head")
    assert _tables(migrated_db) <= {"alembic_version"}


def test_models_match_migrations(alembic_config: Config, migrated_db: str) -> None:
    # Fails if a model changes without a migration.
    command.check(alembic_config)
