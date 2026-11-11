"""Writes the central-app event of an approval, inside the approval's transaction (ADR 0003, 5).

`OutboxWriter.on_decision` is the hook `ReviewDecisionService` runs after the changes and the audit
event and before the commit. On an **approval** it builds `brand_profile.published` or
`product.published` from the rows as they now stand (the profile that just became published, the
revision that just went live) and inserts one `outbox_events` row. So:

- an approval and its event are saved together or not at all: if anything here fails, the hook
  raises, the decision service rolls the transaction back and the approval did not happen;
- a rejection writes nothing (nothing was published or changed for the central app);
- the event's `version` is the aggregate's version: the profile's own, or `Product.version` (which
  the decision raises when the live content changes). Two approvals therefore give versions in
  order, and the table's unique key refuses a second event for the same version.

The row's `id` is the event id the central app de-duplicates on, and its `created_at` is the
event's `occurred_at` (the moment of the decision), so the sender can rebuild the exact envelope
from the row. The `payload` column holds the contract's payload, validated by the builder.
"""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import OutboxEvent, ReviewAction
from vendor_api.services.central_contract import InvalidEvent
from vendor_api.services.central_events import (
    BuiltEvent,
    EventBuildError,
    brand_profile_published,
    load_brand_snapshot,
    load_product_snapshot,
    product_published,
)
from vendor_api.services.review_decisions import Decision

logger = logging.getLogger(__name__)

CANNOT_PUBLISH = "cannot_publish"
OUTBOX_CONFLICT = "outbox_conflict"


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
        db.add(outbox_row(event))
        try:
            await db.flush()
        except IntegrityError as error:
            # Most likely an event for this version already exists. Raising undoes the approval.
            logger.error(
                "outbox event refused",
                extra={
                    "review_id": review_id,
                    "event_type": event.event_type,
                    "version": event.version,
                },
            )
            raise ApiError(
                409,
                OUTBOX_CONFLICT,
                f"The central-app event for version {event.version} could not be recorded "
                "(one already exists), so the approval did not happen. Nothing was saved",
            ) from error
        logger.info(
            "outbox event written",
            extra={
                "review_id": review_id,
                "event_type": event.event_type,
                "version": event.version,
            },
        )

    async def _build(self, db: AsyncSession, decision: Decision) -> BuiltEvent:
        decided_at = decision.review.decided_at
        try:
            if decision.brand_profile is not None:
                brand = await load_brand_snapshot(db, decision.brand_profile.vendor_id)
                return brand_profile_published(brand, occurred_at=decided_at)
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
