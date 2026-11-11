"""Validation of the events sent to the central app against ADR 0003's JSON Schemas.

The schemas in `docs/adr/0003-contract/schemas/` are the one definition both teams build against;
this module reads them (it keeps no copy). In a checkout they are found from the repository root;
the Docker image copies them to a directory named by `CONTRACT_DIR`.
"""

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

# vendor_api/services/central_contract.py -> repository root -> docs/adr/0003-contract
_CHECKOUT_CONTRACT = Path(__file__).resolve().parents[4] / "docs" / "adr" / "0003-contract"
ENVELOPE = "envelope"
# The contract's limit on a request body (a bigger one is refused with 413).
MAX_BODY_BYTES = 256 * 1024


class InvalidEvent(Exception):
    """An event that does not match the contract. A bug in the builder, never a runtime input."""

    def __init__(self, problems: dict[str, str]) -> None:
        self.problems = problems
        super().__init__("; ".join(f"{path}: {message}" for path, message in problems.items()))


def contract_dir() -> Path:
    configured = os.environ.get("CONTRACT_DIR")
    return Path(configured) if configured else _CHECKOUT_CONTRACT


class Contract:
    def __init__(self, directory: Path) -> None:
        schemas = directory / "schemas"
        registry: Registry = Registry()
        loaded: dict[str, dict[str, Any]] = {}
        for path in sorted(schemas.glob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            loaded[path.name.removesuffix(".schema.json")] = schema
            resource = Resource.from_contents(schema)
            registry = registry.with_resources([(path.name, resource), (schema["$id"], resource)])
        if ENVELOPE not in loaded:
            raise FileNotFoundError(f"no event schemas in {schemas}")
        self.event_types = sorted(name for name in loaded if name != ENVELOPE)
        self._validators = {
            name: Draft202012Validator(
                loaded[name], registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER
            )
            for name in self.event_types
        }

    def problems(self, event: object) -> dict[str, str]:
        """Field path -> message; empty when the event is valid."""
        event_type = event.get("type") if isinstance(event, dict) else None
        validator = self._validators.get(event_type) if isinstance(event_type, str) else None
        if validator is None:
            return {"type": f"must be one of {', '.join(self.event_types)}"}
        found: dict[str, str] = {}
        for error in sorted(validator.iter_errors(event), key=lambda e: list(map(str, e.path))):
            path = ".".join(str(part) for part in error.absolute_path) or "(event)"
            found.setdefault(path, error.message)
        return found

    def validate(self, event: object) -> None:
        problems = self.problems(event)
        if problems:
            raise InvalidEvent(problems)


@lru_cache(maxsize=1)
def contract() -> Contract:
    return Contract(contract_dir())
