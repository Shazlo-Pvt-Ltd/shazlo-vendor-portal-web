"""What admins and monitoring see of the outbox (ADR 0003, section 4): the events, why one died,
the retry of a dead one, and the counts that say whether delivery is keeping up.

Retrying only puts a `dead` event back to `pending`. It does not send anything and does not jump the
queue: the worker's claim skips an event while an earlier version of its aggregate is still
`pending` or `sending`, so a retried version never overtakes one that is waiting. (A *later* version
may already have been delivered, since a dead event does not block newer ones; the central app
answers `200 stale` to the old one, which is what keeps it from going back in time.)
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from vendor_api.core.errors import ApiError
from vendor_api.db.models import (
    OutboxEvent,
    OutboxEventLog,
    OutboxLogKind,
    OutboxStatus,
)

MAX_PAGE_SIZE = 100

EVENT_NOT_FOUND = ApiError(404, "outbox_event_not_found", "Outbox event not found")


@dataclass(frozen=True)
class OutboxPage:
    items: list[OutboxEvent]  # without their payload
    total: int
    limit: int
    offset: int


@dataclass(frozen=True)
class OutboxDetail:
    event: OutboxEvent
    history: list[OutboxEventLog]  # oldest first


@dataclass(frozen=True)
class OutboxStats:
    pending: int
    sending: int
    dead: int
    # How long the oldest event that is due (pending, its time has come) has been waiting.
    oldest_due_age_seconds: int | None


class OutboxAdminService:
    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock

    async def list_events(
        self,
        db: AsyncSession,
        *,
        status: str | None,
        aggregate_type: str | None,
        vendor_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> OutboxPage:
        """Newest first; with no status filter the `dead` ones come first (they need a person)."""
        conditions = []
        if status is not None:
            conditions.append(OutboxEvent.status == status)
        if aggregate_type is not None:
            conditions.append(OutboxEvent.aggregate_type == aggregate_type)
        if vendor_id is not None:
            conditions.append(OutboxEvent.vendor_id == vendor_id)
        total = await db.scalar(select(func.count()).select_from(OutboxEvent).where(*conditions))
        dead_first = case((OutboxEvent.status == OutboxStatus.DEAD, 0), else_=1)
        rows = await db.scalars(
            select(OutboxEvent)
            .options(defer(OutboxEvent.payload))  # the list never carries bodies
            .where(*conditions)
            .order_by(dead_first, OutboxEvent.created_at.desc(), OutboxEvent.id)
            .limit(limit)
            .offset(offset)
        )
        return OutboxPage(list(rows), int(total or 0), limit, offset)

    async def get_event(self, db: AsyncSession, event_id: uuid.UUID) -> OutboxDetail:
        event = await db.get(OutboxEvent, event_id)
        if event is None:
            raise EVENT_NOT_FOUND
        history = await db.scalars(
            select(OutboxEventLog)
            .where(OutboxEventLog.event_id == event_id)
            .order_by(OutboxEventLog.id)
        )
        return OutboxDetail(event, list(history))

    async def retry(self, db: AsyncSession, event_id: uuid.UUID, admin_id: uuid.UUID) -> None:
        """`dead` to `pending`, with the attempts counted from zero again and a log entry naming
        the admin. `409 invalid_outbox_status` for any other status (a sent event is final)."""
        try:
            event = await db.scalar(
                select(OutboxEvent)
                .where(OutboxEvent.id == event_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if event is None:
                raise EVENT_NOT_FOUND
            if event.status != OutboxStatus.DEAD:
                raise ApiError(
                    409,
                    "invalid_outbox_status",
                    f"Only a dead event can be retried; this one is {event.status}",
                )
            event.status = OutboxStatus.PENDING
            event.attempts = 0
            event.next_attempt_at = self._clock()
            db.add(
                OutboxEventLog(
                    event_id=event.id,
                    kind=OutboxLogKind.RETRY,
                    outcome="put back by an admin",
                    actor_id=admin_id,
                )
            )
            await db.flush()
            await db.commit()
        except BaseException:
            await db.rollback()
            raise


async def outbox_stats(db: AsyncSession, now: datetime) -> OutboxStats:
    """The counts for monitoring, in one query."""
    row = (
        await db.execute(
            select(
                func.count().filter(OutboxEvent.status == OutboxStatus.PENDING),
                func.count().filter(OutboxEvent.status == OutboxStatus.SENDING),
                func.count().filter(OutboxEvent.status == OutboxStatus.DEAD),
                func.min(OutboxEvent.next_attempt_at).filter(
                    OutboxEvent.status == OutboxStatus.PENDING, OutboxEvent.next_attempt_at <= now
                ),
            )
        )
    ).one()
    pending, sending, dead, oldest = row
    age = max(0, int((now - oldest).total_seconds())) if oldest is not None else None
    return OutboxStats(int(pending), int(sending), int(dead), age)
