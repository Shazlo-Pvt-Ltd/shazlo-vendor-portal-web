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
    "products",
    "product_revisions",
    "product_variants",
    "product_revision_variants",
    "product_images",
    "reviews",
    "review_events",
}
# Helper functions the schema creates: a downgrade must remove them too.
FUNCTIONS = (
    "vendor_status_events_append_only",
    "is_clean_text_list",
    "enforce_version_increases",
    "enforce_version_never_decreases",
    "require_variant_and_image_on_submit",
    "forbid_update_delete_truncate",
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


def _constraint_exists(engine: Engine, name: str) -> bool:
    query = text("SELECT count(*) FROM pg_constraint WHERE conname = :name")
    with engine.connect() as connection:
        return bool(connection.scalar(query, {"name": name}))


def test_the_review_migration_alone_can_be_undone_and_redone(
    alembic_config: Config, migrated_db: str
) -> None:
    engine = create_engine(sync_url(migrated_db))
    try:
        assert _constraint_exists(engine, "uq_brand_profiles_id_vendor_id")
        try:
            command.downgrade(alembic_config, "0004")
            tables = _tables(migrated_db)
            assert {"products", "brand_profiles"} <= tables
            assert not {"reviews", "review_events"} & tables
            # The key it added to an earlier table goes too.
            assert not _constraint_exists(engine, "uq_brand_profiles_id_vendor_id")
        finally:
            command.upgrade(alembic_config, "head")
        assert {"reviews", "review_events"} <= _tables(migrated_db)
        assert _constraint_exists(engine, "uq_brand_profiles_id_vendor_id")
    finally:
        engine.dispose()


def test_the_product_migration_alone_can_be_undone_and_redone(
    alembic_config: Config, migrated_db: str
) -> None:
    product_tables = {
        "products",
        "product_revisions",
        "product_variants",
        "product_revision_variants",
        "product_images",
    }
    try:
        command.downgrade(alembic_config, "0003")
        tables = _tables(migrated_db)
        assert {"assets", "brand_profiles"} <= tables
        assert not product_tables & tables
    finally:
        command.upgrade(alembic_config, "head")
    assert product_tables <= _tables(migrated_db)


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
