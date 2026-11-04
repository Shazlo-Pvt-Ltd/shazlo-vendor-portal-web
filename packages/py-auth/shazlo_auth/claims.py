import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class AccessClaims:
    subject: uuid.UUID
    roles: tuple[str, ...]
    jti: str
    must_change_password: bool = False
    # When the token expires (its `exp`). A token exchange caps the tokens it issues here.
    expires_at: datetime | None = None
