"""The outbox for admins: what is stuck, why, and a way to retry it (ADR 0003, section 4).

Part of the admin group (`/v1/admin/*`, identity-api tokens only, role `vendor_reviewer` or
`super_admin`, enforced once by the router-level dependency). The admin who retries is always the
token's `sub`. Nothing here holds a signature or a secret: the outbox stores event bodies (the
contract's payloads, which carry neither) and a short reason for each failure.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.admin import Reviewer, reviewer_dependency
from vendor_api.api.auth import no_store
from vendor_api.db.models import OutboxEvent, OutboxEventLog
from vendor_api.db.session import get_session
from vendor_api.services.outbox_admin import (
    MAX_PAGE_SIZE,
    OutboxAdminService,
    outbox_stats,
)

router = APIRouter(
    prefix="/admin/outbox", tags=["admin-outbox"], dependencies=[Depends(reviewer_dependency)]
)

Db = Annotated[AsyncSession, Depends(get_session)]


def get_outbox_admin(request: Request) -> OutboxAdminService:
    return cast(OutboxAdminService, request.app.state.outbox_admin)


Outbox = Annotated[OutboxAdminService, Depends(get_outbox_admin)]


class OutboxEventOut(BaseModel):
    id: uuid.UUID  # the event_id the central app de-duplicates on
    vendor_id: uuid.UUID
    aggregate_type: str
    aggregate_id: uuid.UUID
    event_type: str
    version: int
    status: str
    attempts: int
    next_attempt_at: datetime
    locked_at: datetime | None
    # Why the last attempt failed: a short reason (at most 1000 characters), never a response.
    last_error: str | None
    created_at: datetime
    sent_at: datetime | None


class OutboxPageOut(BaseModel):
    items: list[OutboxEventOut]
    total: int
    limit: int
    offset: int


class LogEntryOut(BaseModel):
    created_at: datetime
    kind: Literal["attempt", "retry"]
    outcome: str
    # The admin who asked for a retry (an identity-api id); empty for an attempt.
    actor_id: uuid.UUID | None


class OutboxEventDetailOut(OutboxEventOut):
    # The event body, as it was sent.
    payload: dict[str, Any]
    # What happened to it, oldest first.
    history: list[LogEntryOut]


class OutboxStatsOut(BaseModel):
    pending: int
    sending: int
    dead: int
    oldest_due_age_seconds: int | None


def event_out(event: OutboxEvent) -> OutboxEventOut:
    return OutboxEventOut(
        id=event.id,
        vendor_id=event.vendor_id,
        aggregate_type=event.aggregate_type,
        aggregate_id=event.aggregate_id,
        event_type=event.event_type,
        version=event.version,
        status=event.status,
        attempts=event.attempts,
        next_attempt_at=event.next_attempt_at,
        locked_at=event.locked_at,
        last_error=event.last_error,
        created_at=event.created_at,
        sent_at=event.sent_at,
    )


def _log(entry: OutboxEventLog) -> LogEntryOut:
    return LogEntryOut(
        created_at=entry.created_at,
        kind=cast(Literal["attempt", "retry"], entry.kind),
        outcome=entry.outcome,
        actor_id=entry.actor_id,
    )


@router.get("")
async def list_outbox(
    response: Response,
    db: Db,
    outbox: Outbox,
    status: Annotated[
        Literal["pending", "sending", "sent", "dead"] | None,
        Query(description="Only events in this status"),
    ] = None,
    aggregate_type: Annotated[Literal["brand_profile", "product", "vendor"] | None, Query()] = None,
    vendor_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> OutboxPageOut:
    """Outbox events, paged, without their bodies. Newest first; with no `status` filter the
    `dead` ones come first, since they need a person."""
    no_store(response)
    page = await outbox.list_events(
        db,
        status=status,
        aggregate_type=aggregate_type,
        vendor_id=vendor_id,
        limit=limit,
        offset=offset,
    )
    return OutboxPageOut(
        items=[event_out(e) for e in page.items],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/stats")
async def get_stats(response: Response, db: Db) -> OutboxStatsOut:
    """How many events are `pending`, `sending` and `dead`, and how long the oldest due one has
    waited (also on `/ready`, for monitoring)."""
    no_store(response)
    stats = await outbox_stats(db, datetime.now(UTC))
    return OutboxStatsOut(
        pending=stats.pending,
        sending=stats.sending,
        dead=stats.dead,
        oldest_due_age_seconds=stats.oldest_due_age_seconds,
    )


@router.get("/{event_id}")
async def get_event(
    event_id: uuid.UUID, response: Response, db: Db, outbox: Outbox
) -> OutboxEventDetailOut:
    """One event with its body and what happened to it."""
    no_store(response)
    detail = await outbox.get_event(db, event_id)
    return OutboxEventDetailOut(
        **event_out(detail.event).model_dump(),
        payload=detail.event.payload,
        history=[_log(entry) for entry in detail.history],
    )


@router.post("/{event_id}/retry")
async def retry_event(
    event_id: uuid.UUID, response: Response, db: Db, outbox: Outbox, admin: Reviewer
) -> OutboxEventDetailOut:
    """Puts a `dead` event back to `pending` (its attempts start again, and the log records the
    admin). The worker sends it in its turn: it never overtakes an earlier version of the same
    aggregate that is still waiting. `409 invalid_outbox_status` for any other status."""
    no_store(response)
    await outbox.retry(db, event_id, admin.id)
    detail = await outbox.get_event(db, event_id)
    return OutboxEventDetailOut(
        **event_out(detail.event).model_dump(),
        payload=detail.event.payload,
        history=[_log(entry) for entry in detail.history],
    )
