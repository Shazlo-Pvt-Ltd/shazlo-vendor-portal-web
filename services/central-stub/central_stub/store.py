"""What the stub holds: the events it has seen and the current state of every aggregate."""

import hashlib
from dataclasses import dataclass, field
from typing import Any

PUBLISHED = "published"
UNPUBLISHED = "unpublished"


@dataclass
class Held:
    """The latest applied state of one aggregate."""

    aggregate_type: str
    aggregate_id: str
    version: int
    state: str
    event_id: str
    received_at: str
    data: dict[str, Any]


def digest(raw_body: bytes) -> str:
    return hashlib.sha256(raw_body).hexdigest()


def state_of(event: dict[str, Any]) -> str:
    """`published` or `unpublished` (the two values reconciliation reports)."""
    event_type: str = event["type"]
    if event_type.endswith(".published"):
        return PUBLISHED
    if event_type == "vendor.status_changed":
        return PUBLISHED if event["payload"]["status"] == "approved" else UNPUBLISHED
    return UNPUBLISHED


@dataclass
class Store:
    # event_id -> hash of the body it arrived with (a repeat with other bytes is a conflict)
    seen: dict[str, str] = field(default_factory=dict)
    held: dict[tuple[str, str], Held] = field(default_factory=dict)
    received: int = 0

    def conflicts(self, event_id: str, raw_body: bytes) -> bool:
        known = self.seen.get(event_id)
        return known is not None and known != digest(raw_body)

    def is_duplicate(self, event_id: str) -> bool:
        return event_id in self.seen

    def apply(self, event: dict[str, Any], raw_body: bytes, received_at: str) -> str:
        """Records the event; returns `accepted`, or `stale` when its version is not higher."""
        self.seen[event["event_id"]] = digest(raw_body)
        self.received += 1
        key = (event["aggregate"]["type"], event["aggregate"]["id"])
        current = self.held.get(key)
        if current is not None and event["version"] <= current.version:
            return "stale"
        self.held[key] = Held(
            aggregate_type=key[0],
            aggregate_id=key[1],
            version=event["version"],
            state=state_of(event),
            event_id=event["event_id"],
            received_at=received_at,
            data=event["payload"],
        )
        return "accepted"

    def versions(
        self, aggregate_type: str, cursor: str | None, limit: int
    ) -> tuple[list[Held], str | None]:
        """One page, ordered by aggregate id; `cursor` is the last id of the previous page."""
        rows = sorted(
            (h for (kind, _), h in self.held.items() if kind == aggregate_type),
            key=lambda h: h.aggregate_id,
        )
        if cursor is not None:
            rows = [h for h in rows if h.aggregate_id > cursor]
        page = rows[:limit]
        more = len(rows) > limit
        return page, (page[-1].aggregate_id if more and page else None)

    def reset(self) -> None:
        self.seen.clear()
        self.held.clear()
        self.received = 0
