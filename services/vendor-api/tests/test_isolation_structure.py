"""A new table or route that skips the isolation rules fails here.

- Every table that holds vendor data has a `vendor_id` that leads to `vendors`, and an index on
  it. A table that is only ever reached through a parent that has one is listed in
  `SCOPED_THROUGH_PARENT` with the parent.
- Every route under `/v1/vendor` depends on `current_vendor_user`.

The checkers are plain functions, and the last tests feed them bad samples to show they fail.
"""

import importlib
import pkgutil
from collections.abc import Iterable
from typing import Any

import pytest
from fastapi import APIRouter, Depends
from fastapi.dependencies.models import Dependant
from fastapi.dependencies.utils import get_dependant
from fastapi.routing import APIRoute
from sqlalchemy import Column, ForeignKey, Index, Integer, MetaData, Table, Uuid
from sqlalchemy.dialects import postgresql

import vendor_api.api
from vendor_api.api.deps import current_vendor_user, require_vendor_role
from vendor_api.db import models  # noqa: F401  (registers the tables on the metadata)
from vendor_api.db.base import Base
from vendor_api.db.models import AuthToken, VendorUser, VendorUserRole
from vendor_api.db.scoped import scoped_select

# Tables with no `vendor_id` of their own, and the table that scopes them: they are only ever
# read or written through that parent, which has one. Entries for tables that do not exist yet
# are fine: the rule applies as soon as the table does.
SCOPED_THROUGH_PARENT = {
    "auth_tokens": "vendor_users",  # a user's one-time tokens
    "review_events": "reviews",  # the audit trail of a review
    "product_revision_variants": "product_revisions",  # a revision's variant prices
}
# Tables whose `vendor_id` is a second column of a key, because every query reaches them through
# their parent: no index of their own is needed on `vendor_id`.
NO_VENDOR_INDEX_NEEDED = {
    "product_revisions": "reached through products",
    "product_images": "reached through product_revisions",
}
TENANT_ROOT = "vendors"


def _leads_to_vendors(column: Column[Any], seen: frozenset[str] = frozenset()) -> bool:
    """Whether the column is, directly or through a chain of foreign keys, `vendors.id`."""
    for foreign_key in column.foreign_keys:
        target = foreign_key.column
        if target.table.name == TENANT_ROOT and target.name == "id":
            return True
        key = f"{target.table.name}.{target.name}"
        if (
            target.name == "vendor_id"
            and key not in seen
            and _leads_to_vendors(target, seen | {key})
        ):
            return True
    return False


def _has_index_starting_with(table: Table, column_name: str) -> bool:
    for index in table.indexes:
        if next(iter(index.columns)).name == column_name:
            return True
    for constraint in table.constraints:
        columns = list(getattr(constraint, "columns", []))
        if (
            columns
            and columns[0].name == column_name
            and constraint.__class__.__name__
            in {
                "UniqueConstraint",
                "PrimaryKeyConstraint",
            }
        ):
            return True
    return False


def isolation_problems(
    metadata: MetaData,
    through_parent: dict[str, str] = SCOPED_THROUGH_PARENT,
    no_index: Iterable[str] = NO_VENDOR_INDEX_NEEDED,
) -> list[str]:
    problems: list[str] = []
    for table in metadata.sorted_tables:
        if table.name == TENANT_ROOT:
            continue
        parent = through_parent.get(table.name)
        if parent is not None:
            if not any(fk.column.table.name == parent for fk in table.foreign_keys):
                problems.append(f"{table.name}: no foreign key to its scoping parent {parent}")
            continue
        column = table.columns.get("vendor_id")
        if column is None:
            problems.append(
                f"{table.name}: no vendor_id. Vendor data needs one; a table reached only through "
                "a parent that has one goes in SCOPED_THROUGH_PARENT"
            )
            continue
        if not _leads_to_vendors(column):
            problems.append(f"{table.name}: vendor_id has no foreign key leading to vendors.id")
        if table.name not in set(no_index) and not _has_index_starting_with(table, "vendor_id"):
            problems.append(f"{table.name}: no index that starts with vendor_id")
    return problems


def _calls(dependant: Dependant) -> Iterable[object]:
    for dependency in dependant.dependencies:
        yield dependency.call
        yield from _calls(dependency)


def _calls_of(function: object) -> set[object]:
    """Everything a dependency callable depends on, itself included."""
    return {function, *_calls(get_dependant(path="/", call=function))}  # type: ignore[arg-type]


def api_routers() -> list[APIRouter]:
    """Every router in `vendor_api.api`, found by walking the package: a new module with a
    `router` is checked without anyone remembering to add it here."""
    found = []
    for module_info in pkgutil.iter_modules(vendor_api.api.__path__):
        module = importlib.import_module(f"vendor_api.api.{module_info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            found.append(router)
    return found


def unscoped_routes(routers: Iterable[APIRouter], prefix: str = "/vendor") -> list[str]:
    """Routes whose path starts with `prefix` that do not depend on `current_vendor_user`,
    directly or through `require_vendor_role`, `current_scope` or a router-level dependency.

    (Router paths are relative to `/v1`, so the prefix is `/vendor`.)
    """
    missing = []
    for router in routers:
        inherited: set[object] = set()
        for dependency in router.dependencies:
            if dependency.dependency is not None:
                inherited |= _calls_of(dependency.dependency)
        for route in router.routes:
            if isinstance(route, APIRoute) and route.path.startswith(prefix):
                calls = inherited | set(_calls(route.dependant))
                if current_vendor_user not in calls:
                    missing.append(f"{sorted(route.methods or [])} {route.path}")
    return missing


# --- The real schema and the real routes -------------------------------------------------


def test_every_table_of_vendor_data_is_scoped_by_vendor_id() -> None:
    assert isolation_problems(Base.metadata) == []


def test_every_route_under_vendor_depends_on_the_current_vendor_user() -> None:
    routers = api_routers()
    routes = [r for router in routers for r in router.routes if isinstance(r, APIRoute)]
    # The check is looking at something: the vendor group exists and has several routes.
    assert len([r for r in routes if r.path.startswith("/vendor")]) >= 4
    assert unscoped_routes(routers) == []


def test_the_exemptions_name_real_reasons() -> None:
    assert all(
        parent and reason
        for parent, reason in zip(
            SCOPED_THROUGH_PARENT.values(), NO_VENDOR_INDEX_NEEDED.values(), strict=False
        )
    )
    assert TENANT_ROOT in Base.metadata.tables


# --- The checkers do catch a mistake -----------------------------------------------------


def _sample(*tables: str) -> MetaData:
    metadata = MetaData()
    Table("vendors", metadata, Column("id", Uuid, primary_key=True))
    for name in tables:
        Table(name, metadata, Column("id", Integer, primary_key=True))
    return metadata


def test_a_table_without_vendor_id_is_reported() -> None:
    problems = isolation_problems(_sample("notes"))
    assert len(problems) == 1
    assert "notes: no vendor_id" in problems[0]


def test_a_vendor_id_that_leads_nowhere_is_reported() -> None:
    metadata = _sample()
    Table(
        "notes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("vendor_id", Uuid, index=True),  # no foreign key
    )
    assert any("no foreign key leading to vendors" in p for p in isolation_problems(metadata))


def test_a_vendor_id_without_an_index_is_reported() -> None:
    metadata = _sample()
    Table(
        "notes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("vendor_id", Uuid, ForeignKey("vendors.id")),
    )
    assert any("no index that starts with vendor_id" in p for p in isolation_problems(metadata))


def test_a_scoped_table_is_accepted() -> None:
    metadata = _sample()
    Table(
        "notes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("vendor_id", Uuid, ForeignKey("vendors.id")),
        Index("ix_notes_vendor_id", "vendor_id"),
    )
    assert isolation_problems(metadata) == []


def test_a_chain_of_foreign_keys_to_vendors_is_accepted() -> None:
    """A child table whose vendor_id points at a parent's vendor_id (a composite key)."""
    metadata = _sample()
    Table(
        "parents",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("vendor_id", Uuid, ForeignKey("vendors.id")),
        Index("ix_parents_vendor_id", "vendor_id"),
    )
    Table(
        "children",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("vendor_id", Uuid, ForeignKey("parents.vendor_id")),
        Index("ix_children_vendor_id", "vendor_id"),
    )
    assert isolation_problems(metadata) == []


def test_a_child_table_must_really_point_at_its_scoping_parent() -> None:
    metadata = _sample("logs")  # no foreign key at all
    assert isolation_problems(metadata, {"logs": "vendor_users"}) == [
        "logs: no foreign key to its scoping parent vendor_users"
    ]


def test_a_route_without_the_dependency_is_reported() -> None:
    router = APIRouter(prefix="/vendor")

    @router.get("/open")
    async def open_route() -> dict[str, str]:
        return {}

    @router.get("/guarded", dependencies=[Depends(current_vendor_user)])
    async def guarded() -> dict[str, str]:
        return {}

    assert unscoped_routes([router]) == ["['GET'] /vendor/open"]


def test_a_router_level_dependency_counts() -> None:
    router = APIRouter(prefix="/vendor", dependencies=[Depends(current_vendor_user)])

    @router.get("/anything")
    async def anything() -> dict[str, str]:
        return {}

    assert unscoped_routes([router]) == []


def test_a_role_guard_counts_because_it_depends_on_the_current_user() -> None:
    router = APIRouter(prefix="/vendor")

    @router.get("/owners", dependencies=[Depends(require_vendor_role(VendorUserRole.OWNER))])
    async def owners() -> dict[str, str]:
        return {}

    assert unscoped_routes([router]) == []


def test_other_groups_are_not_held_to_the_vendor_rule() -> None:
    router = APIRouter(prefix="/auth")

    @router.post("/login")
    async def login() -> dict[str, str]:
        return {}

    assert unscoped_routes([router]) == []


# --- The helpers -------------------------------------------------------------------------


def test_scoped_select_always_filters_by_vendor() -> None:
    import uuid

    vendor_id = uuid.uuid4()
    dialect = postgresql.dialect()  # type: ignore[no-untyped-call]
    statement = scoped_select(VendorUser, vendor_id)
    sql = str(statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    assert f"vendor_users.vendor_id = '{vendor_id}'" in sql


def test_a_model_without_vendor_id_cannot_be_scoped() -> None:
    import uuid

    with pytest.raises(TypeError, match="no vendor_id"):
        scoped_select(AuthToken, uuid.uuid4())
