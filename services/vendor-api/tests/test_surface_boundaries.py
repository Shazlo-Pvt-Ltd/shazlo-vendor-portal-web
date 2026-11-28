"""The seller routers and the admin routers never import each other (ADR 0011).

vendor-api runs as two apps from one package: the seller app serves the Vendor Portal, the admin
app serves Shazlo One's Vendors module. What both need lives in `api/common.py` and
`api/views.py`; a router of one group importing a router of the other would pull it (and what it
needs to start) into the wrong app.
"""

import ast
from pathlib import Path

import vendor_api.api

API = Path(vendor_api.api.__file__).parent
SHARED = {"vendor_api.api.common", "vendor_api.api.views"}
# Routers that both apps mount: probes, nothing else.
BOTH = {"health.py"}


def router_imports(path: Path) -> set[str]:
    """The `vendor_api.api.*` modules a file imports."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.module:
            names = [node.module] + [f"{node.module}.{alias.name}" for alias in node.names]
        elif isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        else:
            continue
        for name in names:
            if name.startswith("vendor_api.api."):
                # `from vendor_api.api import admin` names the module after the package.
                parts = name.split(".")
                found.add(".".join(parts[:3]))
    found.discard("vendor_api.api.__init__")
    return found


def admin_routers() -> list[Path]:
    return sorted(API.glob("admin*.py"))


def seller_routers() -> list[Path]:
    skip = {"__init__.py", "common.py", "views.py", *BOTH}
    return sorted(p for p in API.glob("*.py") if p.name not in skip and p not in admin_routers())


def test_there_are_routers_of_both_kinds() -> None:
    assert len(admin_routers()) >= 5
    assert len(seller_routers()) >= 10


def test_admin_routers_import_only_admin_and_shared_modules() -> None:
    wrong = {
        path.name: sorted(
            module
            for module in router_imports(path)
            if module not in SHARED and not module.startswith("vendor_api.api.admin")
        )
        for path in admin_routers()
    }
    assert {name: modules for name, modules in wrong.items() if modules} == {}


def test_seller_routers_never_import_admin_routers() -> None:
    wrong = {
        path.name: sorted(m for m in router_imports(path) if m.startswith("vendor_api.api.admin"))
        for path in seller_routers()
    }
    assert {name: modules for name, modules in wrong.items() if modules} == {}


def test_shared_modules_import_no_router() -> None:
    for name in ("common.py", "views.py"):
        assert router_imports(API / name) <= SHARED - {f"vendor_api.api.{name[:-3]}"}
