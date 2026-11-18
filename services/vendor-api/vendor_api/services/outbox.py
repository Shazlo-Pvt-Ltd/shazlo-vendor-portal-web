"""Writes the central-app event of an approval, inside the approval's transaction (ADR 0003, 5).

`OutboxWriter.on_decision` is the hook `ReviewDecisionService` runs after the changes and the audit
event and before the commit. On an **approval** it builds `brand_profile.published` or
`product.published` from the rows as they now stand (the profile that just became published, the
revision that just went live) and inserts one `outbox_events` row. So:

- an approval and its event are saved together or not at all: if anything here fails, the hook
  raises, the decision service rolls the transaction back and the approval did not happen;
- a rejection writes nothing (nothing was published or changed for the central app);
- the event's `version` is the aggregate's version: `Product.version` (which the decision raises
  when the live content changes), or for a brand page the profile's own version, raised past the
  page's last event when a suspension or reinstatement has already used it. Two approvals therefore
  give versions in order, and the table's unique key refuses a second event for the same version.

The row's `id` is the event id the central app de-duplicates on, and its `created_at` is the
event's `occurred_at` (the moment of the decision), so the sender can rebuild the exact envelope
from the row. The `payload` column holds the contract's payload, validated by the builder.
"""

import logging
import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import OutboxEvent, Product, ReviewAction, Vendor
from vendor_api.services.central_contract import InvalidEvent
from vendor_api.services.central_events import (
    BuiltEvent,
    EventBuildError,
    brand_profile_published,
    brand_profile_unpublished,
    load_brand_snapshot,
    load_product_snapshot,
    product_published,
    product_unpublished,
    vendor_status_changed,
    vendor_status_version,
)
from vendor_api.services.review_decisions import Decision

logger = logging.getLogger(__name__)

CANNOT_PUBLISH = "cannot_publish"
OUTBOX_CONFLICT = "outbox_conflict"

# How many aggregates one chunk of a fan-out loads, builds and inserts before it flushes and lets
# go of them. The whole fan-out is still one transaction, so it is all or nothing.
FANOUT_CHUNK = 200
# Why an aggregate was unpublished because of its vendor. A vendor that is approved again shows
# again exactly the aggregates whose latest event is an unpublish for one of these reasons.
VENDOR_REASONS = ("vendor_suspended", "rejected_after_publish")


def outbox_row(event: BuiltEvent) -> OutboxEvent:
    """The `outbox_events` row of a built event: its id is the event id and its `created_at` the
    event's `occurred_at`, so the sender can rebuild the exact envelope from the row."""
    return OutboxEvent(
        id=event.event_id,
        vendor_id=event.vendor_id,
        aggregate_type=event.aggregate_type,
        aggregate_id=event.aggregate_id,
        event_type=event.event_type,
        version=event.version,
        payload=event.payload,
        created_at=event.occurred_at,
    )


class OutboxWriter:
    """The outbox hook of the review decisions. Build one and `add_hook(writer.on_decision)`."""

    def __init__(self, enabled: bool = True) -> None:
        self._enabled = enabled
        if not enabled:
            logger.warning(
                "outbox events are off (OUTBOX_EVENTS_ENABLED=false): approvals write no "
                "central-app event"
            )

    async def on_decision(self, db: AsyncSession, decision: Decision) -> None:
        if decision.action != ReviewAction.APPROVED:
            return  # a rejection changes nothing the central app has or should have
        if not self._enabled:
            logger.warning(
                "approval written without an outbox event: publishing is off",
                extra={"review_id": str(decision.review.id)},
            )
            return
        event = await self._build(db, decision)
        # Read before the insert: after a failed flush the session cannot load anything.
        review_id = str(decision.review.id)
        await self._write(db, [event], context={"review_id": review_id})
        logger.info(
            "outbox event written",
            extra={
                "review_id": review_id,
                "event_type": event.event_type,
                "version": event.version,
            },
        )

    # --- Writing -----------------------------------------------------------------------------

    async def _write(
        self, db: AsyncSession, events: Sequence[BuiltEvent], *, context: dict[str, str]
    ) -> None:
        """Adds the rows and flushes. A refusal (a version that already exists) raises a 409: the
        caller's transaction is then rolled back, so nothing it did stays."""
        db.add_all([outbox_row(event) for event in events])
        try:
            await db.flush()
        except IntegrityError as error:
            first = events[0]
            logger.error(
                "outbox event refused",
                extra={**context, "event_type": first.event_type, "version": first.version},
            )
            raise ApiError(
                409,
                OUTBOX_CONFLICT,
                f"The central-app event for version {first.version} could not be recorded "
                "(one already exists). Nothing was saved",
            ) from error

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def write_many(
        self, db: AsyncSession, events: Sequence[BuiltEvent], context: dict[str, str]
    ) -> None:
        """Writes events built elsewhere (reconciliation), in the caller's transaction. A product's
        `version` is raised to its events' (see `_raise_product_versions`)."""
        if not events:
            return
        await self._raise_product_versions(db, events)
        await self._write(db, events, context=context)

    async def last_version(
        self, db: AsyncSession, aggregate_type: str, aggregate_id: uuid.UUID
    ) -> int | None:
        """The highest event version written for the aggregate, or None if it has no event."""
        value = await db.scalar(
            select(func.max(OutboxEvent.version)).where(
                OutboxEvent.aggregate_type == aggregate_type,
                OutboxEvent.aggregate_id == aggregate_id,
            )
        )
        return int(value) if value is not None else None

    async def _latest_per_aggregate(
        self, db: AsyncSession, vendor_id: uuid.UUID
    ) -> list[tuple[str, uuid.UUID, int, str, str | None]]:
        """For each page or product of the vendor that has events: its latest event's type,
        aggregate, version, kind and (for an unpublish) reason. Columns only: published events
        carry whole payloads and a fan-out must not load them."""
        rows = await db.execute(
            select(
                OutboxEvent.aggregate_type,
                OutboxEvent.aggregate_id,
                OutboxEvent.version,
                OutboxEvent.event_type,
                OutboxEvent.payload["reason"].astext,
            )
            .where(
                OutboxEvent.vendor_id == vendor_id,
                OutboxEvent.aggregate_type.in_(["brand_profile", "product"]),
            )
            .distinct(OutboxEvent.aggregate_type, OutboxEvent.aggregate_id)
            .order_by(
                OutboxEvent.aggregate_type, OutboxEvent.aggregate_id, OutboxEvent.version.desc()
            )
        )
        return [
            (str(kind), aggregate, int(version), str(event_type), reason)
            for kind, aggregate, version, event_type, reason in rows.tuples()
        ]

    # --- Things that stop being shown --------------------------------------------------------

    async def product_archived(self, db: AsyncSession, product: Product, at: datetime) -> None:
        """`product.unpublished` for a live product that was archived. The caller has already
        raised `product.version`; this keeps it above the last event too. A product that never had
        an event (it was never published, or events were off) writes nothing."""
        if not self._enabled:
            logger.warning(
                "archive written without an outbox event: publishing is off",
                extra={"product_id": str(product.id)},
            )
            return
        last = await self.last_version(db, "product", product.id)
        if last is None:
            return
        version = max(product.version, last + 1)
        product.version = version
        try:
            event = product_unpublished(
                product.id,
                product.vendor_id,
                version=version,
                last_published_version=last,
                reason="archived",
                unpublished_at=at,
                occurred_at=at,
            )
        except (EventBuildError, InvalidEvent) as error:
            raise self._unpublishable_aggregate("product", product.id, str(error)) from error
        await self._write(db, [event], context={"product_id": str(product.id)})

    async def vendor_status_changed(
        self,
        db: AsyncSession,
        vendor: Vendor,
        audit_event_id: int,
        status: str,
        reason: str | None,
        at: datetime,
    ) -> None:
        """`vendor.status_changed` for a change an admin made. Its version is the number of the
        change in the vendor's append-only history, so it only ever goes up."""
        if not self._enabled:
            logger.warning(
                "status change written without an outbox event: publishing is off",
                extra={"vendor_id": str(vendor.id)},
            )
            return
        # The change's number in the vendor's history, but past any event a reconciliation wrote.
        version = await vendor_status_version(db, vendor.id, audit_event_id)
        last = await self.last_version(db, "vendor", vendor.id)
        version = max(version, (last or 0) + 1)
        try:
            event = vendor_status_changed(
                vendor.id,
                status=status,
                reason=reason,
                changed_at=at,
                version=version,
                occurred_at=at,
            )
        except (EventBuildError, InvalidEvent) as error:
            raise self._unpublishable_aggregate("vendor", vendor.id, str(error)) from error
        await self._write(db, [event], context={"vendor_id": str(vendor.id)})

    async def unpublish_vendor(
        self, db: AsyncSession, vendor_id: uuid.UUID, reason: str, at: datetime
    ) -> int:
        """Hides everything of the vendor that the central app currently shows: an `unpublished`
        event for each page or product whose latest event is a `published` one. Idempotent: what
        is already unpublished gets nothing, so running it twice writes nothing the second time.
        Returns how many events it wrote. The events are inserted in chunks, in the caller's
        transaction."""
        if not self._enabled:
            logger.warning(
                "vendor change written without outbox events: publishing is off",
                extra={"vendor_id": str(vendor_id)},
            )
            return 0
        shown = [
            row
            for row in await self._latest_per_aggregate(db, vendor_id)
            if row[3].endswith(".published")
        ]
        written = 0
        for start in range(0, len(shown), FANOUT_CHUNK):
            events: list[BuiltEvent] = []
            for kind, aggregate_id, last_version, _, _ in shown[start : start + FANOUT_CHUNK]:
                version = last_version + 1
                try:
                    if kind == "brand_profile":
                        events.append(
                            brand_profile_unpublished(
                                vendor_id,
                                version=version,
                                last_published_version=last_version,
                                reason=reason,
                                unpublished_at=at,
                                occurred_at=at,
                            )
                        )
                    else:
                        events.append(
                            product_unpublished(
                                aggregate_id,
                                vendor_id,
                                version=version,
                                last_published_version=last_version,
                                reason=reason,
                                unpublished_at=at,
                                occurred_at=at,
                            )
                        )
                except (EventBuildError, InvalidEvent) as error:
                    raise self._unpublishable_aggregate(kind, aggregate_id, str(error)) from error
            await self._raise_product_versions(db, events)
            await self._write(db, events, context={"vendor_id": str(vendor_id)})
            written += len(events)
        logger.info(
            "vendor aggregates unpublished",
            extra={"vendor_id": str(vendor_id), "reason": reason, "events": written},
        )
        return written

    async def republish_vendor(self, db: AsyncSession, vendor_id: uuid.UUID, at: datetime) -> int:
        """Shows again exactly what its vendor's suspension (or rejection) hid: a `published`
        event, at the next version, for each page or product whose latest event is an unpublish for
        a vendor reason. What was withdrawn or archived for another reason stays hidden, and what
        was never published is not published now. Chunked like `unpublish_vendor`; each event
        carries the aggregate's full current state."""
        if not self._enabled:
            logger.warning(
                "vendor change written without outbox events: publishing is off",
                extra={"vendor_id": str(vendor_id)},
            )
            return 0
        hidden = [
            row
            for row in await self._latest_per_aggregate(db, vendor_id)
            if row[3].endswith(".unpublished") and row[4] in VENDOR_REASONS
        ]
        written = 0
        for start in range(0, len(hidden), FANOUT_CHUNK):
            events: list[BuiltEvent] = []
            for kind, aggregate_id, last_version, _, _ in hidden[start : start + FANOUT_CHUNK]:
                try:
                    if kind == "brand_profile":
                        brand = await load_brand_snapshot(db, vendor_id)
                        events.append(
                            brand_profile_published(brand, version=last_version + 1, occurred_at=at)
                        )
                    else:
                        product = await load_product_snapshot(db, aggregate_id)
                        events.append(
                            product_published(
                                product,
                                published_at=at,
                                version=last_version + 1,
                                occurred_at=at,
                            )
                        )
                except (EventBuildError, InvalidEvent) as error:
                    raise self._unpublishable_aggregate(kind, aggregate_id, str(error)) from error
            await self._raise_product_versions(db, events)
            await self._write(db, events, context={"vendor_id": str(vendor_id)})
            written += len(events)
        logger.info(
            "vendor aggregates published again",
            extra={"vendor_id": str(vendor_id), "events": written},
        )
        return written

    @staticmethod
    async def _raise_product_versions(db: AsyncSession, events: Sequence[BuiltEvent]) -> None:
        """A product's `version` is its aggregate's version (a later approval continues from
        it), so it must not stay below the events written for it."""
        for event in events:
            if event.aggregate_type == "product":
                await db.execute(
                    update(Product)
                    .where(Product.id == event.aggregate_id)
                    .values(version=func.greatest(Product.version, event.version))
                )

    @staticmethod
    def _unpublishable_aggregate(kind: str, aggregate_id: uuid.UUID, reason: str) -> ApiError:
        return ApiError(
            409,
            CANNOT_PUBLISH,
            f"The central-app event for the {kind.replace('_', ' ')} {aggregate_id} cannot be "
            f"built: {reason}. Nothing was saved",
        )

    async def _build(self, db: AsyncSession, decision: Decision) -> BuiltEvent:
        decided_at = decision.review.decided_at
        try:
            if decision.brand_profile is not None:
                brand = await load_brand_snapshot(db, decision.brand_profile.vendor_id)
                # The page's event versions are a counter of their own: a suspension and a
                # reinstatement write events past the profile's version, so a profile drafted
                # before them goes out after them. The decision holds the vendor lock, like the
                # fan-outs, so no other brand-page event can be written in between.
                last = await self.last_version(db, "brand_profile", brand.vendor.id)
                version = max(brand.profile.version, (last or 0) + 1)
                return brand_profile_published(brand, version=version, occurred_at=decided_at)
            if decision.product is not None and decided_at is not None:
                product = await load_product_snapshot(db, decision.product.id)
                return product_published(product, published_at=decided_at, occurred_at=decided_at)
        except EventBuildError as error:
            raise self._unpublishable(decision, str(error)) from error
        except InvalidEvent as error:
            logger.error(
                "event does not match the contract",
                extra={"review_id": str(decision.review.id), "problems": sorted(error.problems)},
            )
            raise self._unpublishable(
                decision, "it does not match the central-app contract"
            ) from error
        raise self._unpublishable(decision, "there is nothing to publish")

    @staticmethod
    def _unpublishable(decision: Decision, reason: str) -> ApiError:
        return ApiError(
            409,
            CANNOT_PUBLISH,
            f"This approval cannot be published to the central app: {reason}. Nothing was saved",
        )
