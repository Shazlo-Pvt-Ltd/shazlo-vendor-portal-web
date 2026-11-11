"""Validates an event body against the ADR 0003 schemas (the files both teams build against)."""

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ENVELOPE = "envelope.schema.json"


class Contract:
    def __init__(self, contract_dir: Path) -> None:
        schemas = contract_dir / "schemas"
        registry: Registry = Registry()
        loaded: dict[str, dict[str, Any]] = {}
        for path in sorted(schemas.glob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            loaded[path.name.removesuffix(".schema.json")] = schema
            resource = Resource.from_contents(schema)
            registry = registry.with_resources([(path.name, resource), (schema["$id"], resource)])
        self.event_types = sorted(name for name in loaded if name != ENVELOPE.split(".")[0])
        self._validators = {
            name: Draft202012Validator(
                loaded[name], registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER
            )
            for name in self.event_types
        }

    def errors(self, event: object) -> dict[str, str]:
        """Field path -> message; empty when the event is valid. Unknown types are one error."""
        event_type = event.get("type") if isinstance(event, dict) else None
        validator = self._validators.get(event_type) if isinstance(event_type, str) else None
        if validator is None:
            return {"type": f"must be one of {', '.join(self.event_types)}"}
        found: dict[str, str] = {}
        for error in sorted(validator.iter_errors(event), key=lambda e: list(map(str, e.path))):
            path = ".".join(str(part) for part in error.absolute_path) or "(body)"
            found.setdefault(path, error.message)
        return found
