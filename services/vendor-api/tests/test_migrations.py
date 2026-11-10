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
    "protect_brand_profile_history",
    "protect_submitted_product_revision",
    "protect_submitted_revision_content",
    "protect_review_record",
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


# What 0006 adds to earlier tables: triggers, a check constraint and two indexes.
HARDENING_TRIGGERS = {
    "vendor_status_events_no_truncate",
    "brand_profiles_protect_history",
    "product_revisions_protect_submitted",
    "product_revision_variants_protect_submitted",
    "product_images_protect_submitted",
    "reviews_protect_record",
    "reviews_no_truncate",
}
HARDENING_INDEXES = {"ix_reviews_brand_profile_id", "ix_reviews_product_revision_id"}


def _hardening_objects(engine: Engine) -> set[str]:
    query = text(
        "SELECT tgname FROM pg_trigger WHERE tgname = ANY(:triggers) "
        "UNION ALL SELECT indexname FROM pg_indexes WHERE indexname = ANY(:indexes) "
        "UNION ALL SELECT conname FROM pg_constraint "
        "WHERE conname = 'ck_products_pending_review_has_pending'"
    )
    params = {"triggers": list(HARDENING_TRIGGERS), "indexes": list(HARDENING_INDEXES)}
    with engine.connect() as connection:
        return {str(name) for name in connection.scalars(query, params)}


def test_the_hardening_migration_alone_can_be_undone_and_redone(
    alembic_config: Config, migrated_db: str
) -> None:
    expected = HARDENING_TRIGGERS | HARDENING_INDEXES | {"ck_products_pending_review_has_pending"}
    engine = create_engine(sync_url(migrated_db))
    try:
        assert _hardening_objects(engine) == expected
        try:
            command.downgrade(alembic_config, "0005")
            assert _hardening_objects(engine) == set()
            assert _tables(migrated_db) >= TABLES  # only 0006's objects go
        finally:
            command.upgrade(alembic_config, "head")
        assert _hardening_objects(engine) == expected
    finally:
        engine.dispose()


def _event_columns(engine: Engine) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns("review_events")}


def test_the_event_detail_migration_alone_can_be_undone_and_redone(
    alembic_config: Config, migrated_db: str
) -> None:
    engine = create_engine(sync_url(migrated_db))
    try:
        assert "detail" in _event_columns(engine)
        try:
            command.downgrade(alembic_config, "0006")
            assert "detail" not in _event_columns(engine)
            assert _tables(migrated_db) >= TABLES  # only the column goes
        finally:
            command.upgrade(alembic_config, "head")
        assert "detail" in _event_columns(engine)
        with engine.connect() as connection:
            kind = connection.scalar(
                text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'review_events' AND column_name = 'detail'"
                )
            )
        assert kind == "jsonb"
    finally:
        engine.dispose()


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
