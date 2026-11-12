"""Repairs what the central app is missing or has wrong (ADR 0003, section 6).

Retries cannot repair a restored database, a dead event or a catalog published before the outbox
existed. This does, by writing the **current state** of an aggregate as a new event, at a version
above everything already sent for it (the central app applies only a higher version, so a repair
can never be taken for something stale).

**Reconciliation** (nightly, from the worker; `Reconciler.reconcile`) asks the central app what it
holds (`GET /internal/v1/versions`) for each aggregate type and compares it with the database:

| vendor-api says | the central app has | what happens |
| --- | --- | --- |
| published | nothing, an older version or an unpublished one | a `published` event |
| published | the same version or a newer one, published | nothing (a newer one is left alone) |
| unpublished | it published | an `unpublished` event |
| unpublished | nothing, or it unpublished | nothing |

An aggregate with an event still `pending` or `sending` is skipped: it is on its way, and the
comparison would only say that the central app is behind. So a second run, once the first one's
events are delivered, writes nothing, and a second run before then writes nothing either.

**Resync** (`Reconciler.resync`, the `resync` command) needs no answer from the central app: it
writes the current state of a vendor, a product or everything, once more. A published aggregate
gets a `published` event; one that was published and is not now gets an `unpublished` one; one that
never was gets nothing. It is also the first sync of a catalog published before this phase.

What is published (`wanted`): a vendor's brand page, when the vendor is approved and has a published
profile; a product, when its vendor is approved and it has a live revision and is not archived; a
vendor, when it is approved (`pending` vendors are not reported at all).

**Load.** Everything is done in chunks of 200 aggregates, each its own transaction, with a pause
between them, and the run stops while more than `reconcile_max_pending` events wait in the outbox
(the next run carries on, because what was not repaired is still behind). Only one worker reconciles
at a time (an advisory lock).
"""

import asyncio
import contextlib
import logging
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Any, Protocol

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import (
    BrandProfile,
    BrandProfileState,
    OutboxEvent,
    Product,
    ProductStatus,
    Vendor,
    VendorStatus,
    VendorStatusEvent,
)
from vendor_api.services.central_contract import InvalidEvent
from vendor_api.services.central_events import (
    REPORTED_STATUSES,
    BuiltEvent,
    EventBuildError,
    brand_profile_published,
    brand_profile_unpublished,
    load_brand_snapshot,
    load_product_snapshot,
    product_published,
    product_unpublished,
    vendor_status_changed,
)
from vendor_api.services.outbox import OutboxWriter
from vendor_api.services.publisher import Clock, Sessions

logger = logging.getLogger(__name__)

PUBLISHED = "published"
UNPUBLISHED = "unpublished"
AGGREGATE_TYPES = ("vendor", "brand_profile", "product")
CHUNK = 200
PAUSE_SECONDS = 1.0
# One advisory lock for the whole job, so that two workers do not repair the same things twice.
LOCK_KEY = 0x5A4C_0186


class VersionSource(Protocol):
    """What the central app holds: aggregate id to (version, state). `CentralClient` is one."""

    async def versions(self, aggregate_type: str) -> dict[uuid.UUID, tuple[int, str]]: ...


@dataclass(frozen=True)
class Held:
    """What the central app holds of an aggregate."""

    version: int
    state: str


@dataclass(frozen=True)
class Facts:
    """What vendor-api knows of one aggregate."""

    aggregate_type: str
    aggregate_id: uuid.UUID
    vendor_id: uuid.UUID
    wanted: str  # published or unpublished
    own_version: int  # the aggregate's own version: a product's, a profile's, a status count
    last_version: int | None  # the highest event version in the outbox
    last_state: str | None  # published or unpublished, as of that event
    in_flight: bool  # an event of it is still pending or sending
    reason: str  # why it is unpublished, for an `unpublished` event


@dataclass(frozen=True)
class Scope:
    """What a resync covers. `everything` or a vendor (page, status and products) or a product."""

    vendor_id: uuid.UUID | None = None
    product_id: uuid.UUID | None = None
    everything: bool = False


@dataclass
class Report:
    written: Counter[str] = field(default_factory=Counter)  # by aggregate type
    in_flight: int = 0  # skipped: an event is on its way
    unbuildable: int = 0  # skipped: its state cannot be made into a valid event
    conflicts: int = 0  # a chunk lost a race with an approval; the next run repairs it
    stopped_for_backlog: bool = False
    another_run_active: bool = False

    @property
    def total(self) -> int:
        return sum(self.written.values())


def next_version(facts: Facts, held: Held | None) -> int:
    """Above the aggregate's own version, its last event and what the central app holds."""
    return max(
        facts.own_version,
        facts.last_version + 1 if facts.last_version else 0,
        held.version + 1 if held else 0,
    )


def decide(facts: Facts, held: Held | None, *, reconcile: bool) -> int | None:
    """The version of the event to write, or None for nothing to do (see the module docstring).
    `reconcile` compares with `held`; otherwise (a resync) the central app is not asked."""
    if facts.in_flight:
        return None
    if reconcile:
        if facts.wanted == PUBLISHED:
            current = (
                held is not None
                and held.state == PUBLISHED
                and held.version >= (facts.last_version or 0)
            )
            if current:
                return None
        elif held is None or held.state != PUBLISHED:
            return None
    elif facts.wanted == UNPUBLISHED and facts.last_state != PUBLISHED:
        return None
    return next_version(facts, held)


def seconds_until(at: time, now: datetime) -> float:
    """Seconds from `now` (UTC) to the next `at`."""
    target = now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


class Reconciler:
    def __init__(
        self,
        sessions: Sessions,
        writer: OutboxWriter,
        central: VersionSource | None = None,
        *,
        max_pending: int = 1000,
        pause: float = PAUSE_SECONDS,
        chunk: int = CHUNK,
        clock: Clock = lambda: datetime.now(UTC),
    ) -> None:
        self._sessions = sessions
        self._writer = writer
        self._central = central
        self._max_pending = max_pending
        self._pause = pause
        self._chunk = chunk
        self._clock = clock

    # --- The two jobs ------------------------------------------------------------------------

    async def reconcile(self) -> Report:
        """Compares with the central app and repairs what is behind. Raises `CentralError` if the
        central app cannot be asked (nothing is written then)."""
        if self._central is None:
            raise RuntimeError("reconciliation needs a central client")
        self._require_events()
        report = Report()
        async with self._sessions() as lock_session:
            if not await self._lock(lock_session):
                report.another_run_active = True
                logger.info("reconciliation is already running elsewhere")
                return report
            try:
                for kind in AGGREGATE_TYPES:
                    held = {
                        key: Held(version, state)
                        for key, (version, state) in (await self._central.versions(kind)).items()
                    }
                    ids = sorted(set(held) | set(await self._wanted_ids(kind)))
                    if not await self._repair(kind, ids, held, report):
                        break
            finally:
                await self._unlock(lock_session)
        logger.info("reconciliation finished", extra=_summary(report))
        return report

    async def resync(self, scope: Scope) -> Report:
        """Writes the current state of the aggregates in `scope`, whatever the central app holds."""
        self._require_events()
        report = Report()
        for kind in AGGREGATE_TYPES:
            ids = await self._scope_ids(kind, scope)
            if not await self._repair(kind, ids, None, report):
                break
        logger.info("resync finished", extra=_summary(report))
        return report

    def _require_events(self) -> None:
        if not self._writer.enabled:
            raise RuntimeError("OUTBOX_EVENTS_ENABLED is off: no event can be written")

    # --- One aggregate type ------------------------------------------------------------------

    async def _repair(
        self,
        kind: str,
        ids: list[uuid.UUID],
        held: dict[uuid.UUID, Held] | None,
        report: Report,
    ) -> bool:
        """Repairs `ids`, a chunk at a time. False when the run should stop (a full outbox)."""
        for start in range(0, len(ids), self._chunk):
            chunk = ids[start : start + self._chunk]
            if await self._backlog() >= self._max_pending:
                report.stopped_for_backlog = True
                logger.warning(
                    "reconciliation stopped: the outbox is full; the next run carries on",
                    extra={"max_pending": self._max_pending},
                )
                return False
            await self._repair_chunk(kind, chunk, held, report)
            if self._pause:
                await asyncio.sleep(self._pause)
        return True

    async def _repair_chunk(
        self,
        kind: str,
        ids: list[uuid.UUID],
        held: dict[uuid.UUID, Held] | None,
        report: Report,
    ) -> None:
        now = self._clock()
        async with self._sessions() as db:
            events: list[BuiltEvent] = []
            for facts in await self._facts(db, kind, ids):
                theirs = held.get(facts.aggregate_id) if held is not None else None
                version = decide(facts, theirs, reconcile=held is not None)
                if version is None:
                    report.in_flight += facts.in_flight
                    continue
                try:
                    events.append(await self._build(db, facts, version, theirs, now))
                except (EventBuildError, InvalidEvent) as error:
                    report.unbuildable += 1
                    logger.warning(
                        "an aggregate cannot be re-sent",
                        extra={"aggregate": str(facts.aggregate_id), "reason": str(error)},
                    )
            try:
                await self._writer.write_many(db, events, {"aggregate_type": kind})
                await db.commit()
            except ApiError:
                # An approval took the version first: this chunk is repaired by the next run.
                await db.rollback()
                report.conflicts += len(events)
                logger.warning("a chunk lost a race with a change", extra={"aggregate_type": kind})
                return
            report.written[kind] += len(events)

    async def _backlog(self) -> int:
        async with self._sessions() as db:
            count = await db.scalar(
                select(func.count())
                .select_from(OutboxEvent)
                .where(OutboxEvent.status.in_(["pending", "sending"]))
            )
        return int(count or 0)

    # --- Which aggregates ----------------------------------------------------------------------

    async def _wanted_ids(self, kind: str) -> list[uuid.UUID]:
        """Every aggregate of the type that should be shown."""
        async with self._sessions() as db:
            approved = Vendor.status == VendorStatus.APPROVED
            if kind == "vendor":
                query = select(Vendor.id).where(approved)
            elif kind == "brand_profile":
                query = (
                    select(Vendor.id)
                    .join(BrandProfile, BrandProfile.vendor_id == Vendor.id)
                    .where(approved, BrandProfile.state == BrandProfileState.PUBLISHED)
                )
            else:
                query = (
                    select(Product.id)
                    .join(Vendor, Vendor.id == Product.vendor_id)
                    .where(
                        approved,
                        Product.live_revision_id.is_not(None),
                        Product.status != ProductStatus.ARCHIVED,
                    )
                )
            return list(await db.scalars(query))

    async def _scope_ids(self, kind: str, scope: Scope) -> list[uuid.UUID]:
        async with self._sessions() as db:
            if scope.everything:
                wanted = await self._wanted_ids(kind)
                with_events = set(
                    await db.scalars(
                        select(OutboxEvent.aggregate_id)
                        .where(OutboxEvent.aggregate_type == kind)
                        .distinct()
                    )
                )
                return sorted(set(wanted) | with_events)
            if scope.product_id is not None:
                return [scope.product_id] if kind == "product" else []
            if scope.vendor_id is None:
                return []
            if kind in {"vendor", "brand_profile"}:
                return [scope.vendor_id]
            return sorted(
                await db.scalars(select(Product.id).where(Product.vendor_id == scope.vendor_id))
            )

    # --- What vendor-api knows -------------------------------------------------------------------

    async def _facts(self, db: AsyncSession, kind: str, ids: list[uuid.UUID]) -> list[Facts]:
        if not ids:
            return []
        outbox = await self._outbox_state(db, kind, ids)
        found: list[tuple[uuid.UUID, uuid.UUID, str, int, str]] = []  # id, vendor, wanted, own, why
        if kind == "product":
            rows = await db.execute(
                select(
                    Product.id,
                    Product.vendor_id,
                    Product.status,
                    Product.live_revision_id,
                    Product.version,
                    Vendor.status,
                )
                .join(Vendor, Vendor.id == Product.vendor_id)
                .where(Product.id.in_(ids))
            )
            for pid, vendor_id, status, live, version, vendor_status in rows.tuples():
                live_now = (
                    vendor_status == VendorStatus.APPROVED
                    and live is not None
                    and status != ProductStatus.ARCHIVED
                )
                if status == ProductStatus.ARCHIVED:
                    why = "archived"
                else:
                    why = _vendor_reason(vendor_status) or "back_in_review"
                found.append((pid, vendor_id, PUBLISHED if live_now else UNPUBLISHED, version, why))
        elif kind == "brand_profile":
            versions = dict(
                (
                    await db.execute(
                        select(BrandProfile.vendor_id, BrandProfile.version).where(
                            BrandProfile.vendor_id.in_(ids),
                            BrandProfile.state == BrandProfileState.PUBLISHED,
                        )
                    )
                )
                .tuples()
                .all()
            )
            for vendor_id, vendor_status in (
                await db.execute(select(Vendor.id, Vendor.status).where(Vendor.id.in_(ids)))
            ).tuples():
                shown = vendor_status == VendorStatus.APPROVED and vendor_id in versions
                why = _vendor_reason(vendor_status) or "withdrawn"
                found.append(
                    (
                        vendor_id,
                        vendor_id,
                        PUBLISHED if shown else UNPUBLISHED,
                        versions.get(vendor_id, 1),
                        why,
                    )
                )
        else:
            counts = dict(
                (
                    await db.execute(
                        select(VendorStatusEvent.vendor_id, func.count())
                        .where(VendorStatusEvent.vendor_id.in_(ids))
                        .group_by(VendorStatusEvent.vendor_id)
                    )
                )
                .tuples()
                .all()
            )
            for vendor_id, vendor_status in (
                await db.execute(select(Vendor.id, Vendor.status).where(Vendor.id.in_(ids)))
            ).tuples():
                if vendor_status not in REPORTED_STATUSES:
                    continue  # a pending vendor is not reported
                wanted = PUBLISHED if vendor_status == VendorStatus.APPROVED else UNPUBLISHED
                found.append((vendor_id, vendor_id, wanted, max(counts.get(vendor_id, 1), 1), ""))
        facts = []
        for aggregate_id, vendor_id, wanted, own, why in found:
            last_version, last_state, in_flight = outbox.get(aggregate_id, (None, None, False))
            facts.append(
                Facts(
                    kind,
                    aggregate_id,
                    vendor_id,
                    wanted,
                    own,
                    last_version,
                    last_state,
                    in_flight,
                    why,
                )
            )
        return facts

    @staticmethod
    async def _outbox_state(
        db: AsyncSession, kind: str, ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[int, str, bool]]:
        """Per aggregate: its last event's version and state, and whether one is still on its way.
        Columns only: published events carry whole payloads."""
        latest = await db.execute(
            select(
                OutboxEvent.aggregate_id,
                OutboxEvent.version,
                OutboxEvent.event_type,
                OutboxEvent.payload["status"].astext,
            )
            .where(OutboxEvent.aggregate_type == kind, OutboxEvent.aggregate_id.in_(ids))
            .distinct(OutboxEvent.aggregate_id)
            .order_by(OutboxEvent.aggregate_id, OutboxEvent.version.desc())
        )
        waiting = set(
            await db.scalars(
                select(OutboxEvent.aggregate_id)
                .where(
                    OutboxEvent.aggregate_type == kind,
                    OutboxEvent.aggregate_id.in_(ids),
                    OutboxEvent.status.in_(["pending", "sending"]),
                )
                .distinct()
            )
        )
        state: dict[uuid.UUID, tuple[int, str, bool]] = {}
        for aggregate_id, version, event_type, status in latest.tuples():
            if kind == "vendor":
                shown = status == VendorStatus.APPROVED
            else:
                shown = str(event_type).endswith(".published")
            state[aggregate_id] = (
                int(version),
                PUBLISHED if shown else UNPUBLISHED,
                aggregate_id in waiting,
            )
        return state

    # --- Building the event ----------------------------------------------------------------------

    async def _build(
        self, db: AsyncSession, facts: Facts, version: int, held: Held | None, now: datetime
    ) -> BuiltEvent:
        shown_at = held.version if held is not None else facts.last_version
        if facts.aggregate_type == "vendor":
            vendor = await db.get(Vendor, facts.aggregate_id)
            if vendor is None:
                raise EventBuildError("the vendor is gone")
            return vendor_status_changed(
                vendor.id,
                status=vendor.status,
                reason=vendor.status_reason,
                changed_at=vendor.status_changed_at or vendor.created_at,
                version=version,
                occurred_at=now,
            )
        if facts.aggregate_type == "brand_profile":
            if facts.wanted == PUBLISHED:
                brand = await load_brand_snapshot(db, facts.aggregate_id)
                return brand_profile_published(brand, version=version, occurred_at=now)
            return brand_profile_unpublished(
                facts.aggregate_id,
                version=version,
                last_published_version=shown_at,
                reason=facts.reason,
                unpublished_at=now,
                occurred_at=now,
            )
        if facts.wanted == PUBLISHED:
            product = await load_product_snapshot(db, facts.aggregate_id)
            return product_published(product, published_at=now, version=version, occurred_at=now)
        return product_unpublished(
            facts.aggregate_id,
            facts.vendor_id,
            version=version,
            last_published_version=shown_at,
            reason=facts.reason,
            unpublished_at=now,
            occurred_at=now,
        )

    # --- One run at a time -----------------------------------------------------------------------

    @staticmethod
    async def _lock(db: AsyncSession) -> bool:
        return bool(await db.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_KEY}))

    @staticmethod
    async def _unlock(db: AsyncSession) -> None:
        await db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})
        await db.commit()


def _vendor_reason(status: str) -> str | None:
    if status == VendorStatus.SUSPENDED:
        return "vendor_suspended"
    if status == VendorStatus.REJECTED:
        return "rejected_after_publish"
    return None


def _summary(report: Report) -> dict[str, Any]:
    return {
        "written": dict(report.written),
        "in_flight": report.in_flight,
        "unbuildable": report.unbuildable,
        "conflicts": report.conflicts,
        "stopped_for_backlog": report.stopped_for_backlog,
    }


async def run_nightly(
    reconciler: Reconciler,
    at: time,
    stop: asyncio.Event,
    clock: Clock = lambda: datetime.now(UTC),
) -> None:
    """Runs `reconciler.reconcile()` every day at `at` (UTC) until `stop` is set. A failed run
    (the central app is down) is logged and tried again the next night."""
    while not stop.is_set():
        wait = seconds_until(at, clock())
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=wait)
        if stop.is_set():
            return
        try:
            await reconciler.reconcile()
        except Exception:
            logger.exception("reconciliation failed; it runs again tomorrow")
