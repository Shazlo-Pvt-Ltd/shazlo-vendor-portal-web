import ast
from pathlib import Path

import shazlo_security

SERVICES = {"identity_api", "vendor_api"}


def test_the_package_imports_nothing_from_a_service() -> None:
    root = Path(shazlo_security.__file__).parent
    offenders: list[str] = []
    for path in sorted(root.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            offenders += [
                f"{path.name}: {name}" for name in names if name.split(".")[0] in SERVICES
            ]
    assert offenders == []
