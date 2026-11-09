import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Any


@dataclass(frozen=True)
class AccessClaims:
    subject: uuid.UUID
    roles: tuple[str, ...]
    jti: str
    must_change_password: bool = False
    # When the token expires (its `exp`). A token exchange caps the tokens it issues here.
    expires_at: datetime | None = None
    # Every claim that is not one of the above or a registered one (for example `vendor_id` in
    # vendor-api tokens), as the token carried it. Read-only.
    extra: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))
