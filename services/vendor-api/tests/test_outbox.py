"""The outbox table: what it refuses, what it allows, and that the worker's claim works on it.

Every refusal runs inside a savepoint, which the error rolls back, so the next attempt in the
same test can run (the shared session would otherwise be unusable after a failed statement).
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from factories import saved_vendor
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import OutboxEvent

NOW = datetime.now(UTC)


@pytest.fixture(autouse=True)
async def vendor(session: AsyncSession) -> uuid.UUID:
    """Every event is a vendor's: this test's vendor, made before anything can roll back."""
    vendor_row = await saved_vendor(session)
    session.info["vendor_id"] = vendor_row.id
    vendor_id: uuid.UUID = vendor_row.id
    return vendor_id


def make_event(**changes: Any) -> OutboxEvent:
    values: dict[str, Any] = {
        "aggregate_type": "product",
        "aggregate_id": uuid.uuid4(),
        "event_type": "product.published",
        "version": 1,
        "payload": {"sku": "KURTA-01"},
    }
    return OutboxEvent(**{**values, **changes})


async def saved(session: AsyncSession, **changes: Any) -> OutboxEvent:
    event = make_event(**{"vendor_id": session.info["vendor_id"], **changes})
    session.add(event)
    await session.flush()
    return event


async def reload(session: AsyncSession, event: OutboxEvent) -> OutboxEvent:
    result = await session.scalars(
        select(OutboxEvent)
        .where(OutboxEvent.id == event.id)
        .execution_options(populate_existing=True)
    )
    return result.one()


async def refused(session: AsyncSession, action: Callable[[], Awaitable[Any]], match: str) -> None:
    with pytest.raises(IntegrityError, match=match):
        async with session.begin_nested():
            await action()


async def update(
    session: AsyncSession, event: OutboxEvent, assignments: str, **params: Any
) -> None:
    await session.execute(
        # The assignments are constants of these tests; the values travel as parameters.
        text(f"UPDATE outbox_events SET {assignments} WHERE id = :id"),  # noqa: S608
        {"id": event.id, **params},
    )


async def in_status(session: AsyncSession, status: str, **changes: Any) -> OutboxEvent:
    """A row that is already in `status`, with the columns that status requires."""
    required: dict[str, dict[str, Any]] = {
        "sending": {"locked_at": NOW},
        "sent": {"sent_at": NOW},
        "dead": {"last_error": "the central app answered 422"},
    }
    extra = required.get(status, {})
    return await saved(session, status=status, **{**extra, **changes})


# --- A new event -------------------------------------------------------------------------


async def test_a_new_event_is_pending_and_due_at_once(session: AsyncSession) -> None:
    event = await saved(session)
    assert isinstance(event.id, uuid.UUID)
    assert (event.status, event.attempts) == ("pending", 0)
    assert event.next_attempt_at is not None and event.created_at is not None
    assert (event.locked_at, event.last_error, event.sent_at) == (None, None, None)
    assert event.payload == {"sku": "KURTA-01"}


@pytest.mark.parametrize(
    ("aggregate_type", "event_type"),
    [
        ("brand_profile", "brand_profile.published"),
        ("brand_profile", "brand_profile.unpublished"),
        ("product", "product.published"),
        ("product", "product.unpublished"),
        ("vendor", "vendor.status_changed"),
    ],
)
async def test_every_event_type_of_the_contract_is_accepted(
    session: AsyncSession, aggregate_type: str, event_type: str
) -> None:
    about = {"aggregate_id": session.info["vendor_id"]} if aggregate_type == "vendor" else {}
    event = await saved(session, aggregate_type=aggregate_type, event_type=event_type, **about)
    assert (event.aggregate_type, event.event_type) == (aggregate_type, event_type)
    assert event.vendor_id == session.info["vendor_id"]


# --- One event per aggregate version ------------------------------------------------------


async def test_an_aggregate_version_can_have_only_one_event(session: AsyncSession) -> None:
    first = await saved(session, version=3)
    await refused(
        session,
        lambda: saved(session, aggregate_id=first.aggregate_id, version=3),
        "uq_outbox_events_aggregate_type_aggregate_id_version",
    )


async def test_other_versions_and_other_aggregates_may_share_a_number(
    session: AsyncSession,
) -> None:
    first = await saved(session, version=1)
    await saved(session, aggregate_id=first.aggregate_id, version=2)  # the next version
    await saved(session, version=1)  # another product
    # The same id and version but another kind of aggregate is a different aggregate.
    await saved(
        session,
        aggregate_type="brand_profile",
        event_type="brand_profile.published",
        aggregate_id=first.aggregate_id,
        version=1,
    )


# --- What a row must look like ------------------------------------------------------------


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"aggregate_type": "order"}, "aggregate_type_values"),
        # An unknown type breaks two rules; the database reports the first by name.
        ({"event_type": "product.deleted"}, "event_type_(values|matches_aggregate)"),
        ({"status": "queued"}, "status_values"),
        # An event is about its own kind of aggregate.
        ({"aggregate_type": "vendor", "event_type": "product.published"}, "matches_aggregate"),
        ({"aggregate_type": "product", "event_type": "vendor.status_changed"}, "matches_aggregate"),
        (
            {"aggregate_type": "brand_profile", "event_type": "product.published"},
            "matches_aggregate",
        ),
        # A vendor event is about the vendor itself, never another aggregate.
        (
            {"aggregate_type": "vendor", "event_type": "vendor.status_changed"},
            "vendor_event_is_about_the_vendor",
        ),
        ({"version": 0}, "version_positive"),
        ({"version": -2}, "version_positive"),
        ({"attempts": -1}, "attempts_not_negative"),
        ({"payload": [1, 2]}, "payload_is_object"),
        ({"payload": "text"}, "payload_is_object"),
        ({"payload": {"blob": "x" * 262_144}}, "payload_size"),
        ({"last_error": "x" * 1001}, "last_error_bounded"),
        ({"status": "dead"}, "dead_has_reason"),
        ({"status": "sent"}, "sent_at_matches_status"),
        ({"sent_at": NOW}, "sent_at_matches_status"),
        ({"status": "sending"}, "locked_at_matches_status"),
        ({"locked_at": NOW}, "locked_at_matches_status"),
    ],
)
async def test_a_row_that_breaks_a_rule_is_refused(
    session: AsyncSession, changes: dict[str, Any], constraint: str
) -> None:
    await refused(session, lambda: saved(session, **changes), constraint)


async def test_an_event_belongs_to_a_vendor_that_exists(session: AsyncSession) -> None:
    await refused(
        session,
        lambda: saved(session, vendor_id=uuid.uuid4()),
        "fk_outbox_events_vendor_id_vendors",
    )


async def test_a_vendor_with_events_cannot_be_deleted(session: AsyncSession) -> None:
    event = await saved(session)
    await refused(
        session,
        lambda: session.execute(
            text("DELETE FROM vendors WHERE id = :id"), {"id": event.vendor_id}
        ),
        "fk_outbox_events_vendor_id_vendors",
    )


async def test_a_vendor_event_may_be_about_the_vendor(session: AsyncSession) -> None:
    event = await saved(
        session,
        aggregate_type="vendor",
        event_type="vendor.status_changed",
        aggregate_id=session.info["vendor_id"],
    )
    assert event.aggregate_id == event.vendor_id


async def test_a_payload_at_the_size_limit_is_accepted(session: AsyncSession) -> None:
    overhead = len('{"blob": ""}')  # how jsonb prints it
    await saved(session, payload={"blob": "x" * (262_144 - overhead)})


async def test_a_long_error_up_to_the_bound_is_kept(session: AsyncSession) -> None:
    event = await in_status(session, "dead", last_error="e" * 1000)
    assert len(event.last_error or "") == 1000


# --- What never changes -------------------------------------------------------------------


@pytest.mark.parametrize(
    "assignment",
    [
        'payload = \'{"sku": "OTHER"}\'::jsonb',
        "version = version + 1",
        "event_type = 'product.unpublished'",
        "aggregate_id = gen_random_uuid()",
        "aggregate_type = 'brand_profile', event_type = 'brand_profile.published'",
        "created_at = created_at + interval '1 day'",
        "id = gen_random_uuid()",
    ],
)
async def test_the_content_of_an_event_never_changes(
    session: AsyncSession, assignment: str
) -> None:
    event = await saved(session)
    await refused(session, lambda: update(session, event, assignment), "content of an outbox event")
    assert (await reload(session, event)).payload == {"sku": "KURTA-01"}


async def test_delivery_state_may_change_without_a_status_change(session: AsyncSession) -> None:
    event = await saved(session)
    later = NOW + timedelta(hours=1)
    await update(
        session,
        event,
        "attempts = 2, next_attempt_at = :later, last_error = 'the central app answered 503'",
        later=later,
    )
    changed = await reload(session, event)
    assert (changed.status, changed.attempts, changed.last_error) == (
        "pending",
        2,
        "the central app answered 503",
    )
    assert changed.next_attempt_at == later


# --- The worker's path through the statuses ----------------------------------------------


async def test_an_event_can_be_claimed_retried_and_delivered(session: AsyncSession) -> None:
    event = await saved(session)
    await update(session, event, "status = 'sending', locked_at = now(), attempts = attempts + 1")
    assert (await reload(session, event)).status == "sending"
    # It failed with a temporary error: back to pending, with a later attempt.
    await update(
        session,
        event,
        "status = 'pending', locked_at = NULL, last_error = 'timeout', "
        "next_attempt_at = now() + interval '30 seconds'",
    )
    assert (await reload(session, event)).status == "pending"
    await update(session, event, "status = 'sending', locked_at = now(), attempts = attempts + 1")
    await update(session, event, "status = 'sent', locked_at = NULL, sent_at = now()")
    done = await reload(session, event)
    assert (done.status, done.attempts) == ("sent", 2)
    assert done.sent_at is not None and done.locked_at is None


async def test_an_event_can_fail_for_good_and_be_retried_by_an_admin(session: AsyncSession) -> None:
    event = await in_status(session, "sending")
    await update(
        session,
        event,
        "status = 'dead', locked_at = NULL, last_error = 'the central app answered 422'",
    )
    assert (await reload(session, event)).status == "dead"
    await update(session, event, "status = 'pending', attempts = 0, next_attempt_at = now()")
    retried = await reload(session, event)
    assert (retried.status, retried.attempts) == ("pending", 0)
    assert retried.last_error == "the central app answered 422"  # the history stays


async def test_a_stuck_claim_can_be_released(session: AsyncSession) -> None:
    event = await in_status(session, "sending")
    await update(session, event, "status = 'pending', locked_at = NULL")  # the sweeper
    assert (await reload(session, event)).status == "pending"


@pytest.mark.parametrize(
    ("start", "target", "assignment"),
    [
        ("pending", "sent", "status = 'sent', sent_at = now()"),
        ("pending", "dead", "status = 'dead', last_error = 'nope'"),
        ("dead", "sending", "status = 'sending', locked_at = now()"),
        ("dead", "sent", "status = 'sent', sent_at = now()"),
    ],
)
async def test_a_status_can_only_follow_the_workers_path(
    session: AsyncSession, start: str, target: str, assignment: str
) -> None:
    event = await in_status(session, start)
    await refused(
        session,
        lambda: update(session, event, assignment),
        f"cannot go from {start} to {target}",
    )
    assert (await reload(session, event)).status == start


@pytest.mark.parametrize(
    "assignment",
    [
        "status = 'pending', sent_at = NULL",
        "status = 'sending', sent_at = NULL, locked_at = now()",
        "status = 'dead', sent_at = NULL, last_error = 'x'",
        "attempts = attempts + 1",
        "last_error = 'edited'",
        "next_attempt_at = now()",
    ],
)
async def test_a_sent_event_is_final(session: AsyncSession, assignment: str) -> None:
    event = await in_status(session, "sent")
    await refused(session, lambda: update(session, event, assignment), "sent outbox event")
    assert (await reload(session, event)).status == "sent"


# --- Retention ----------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["pending", "sent", "dead"])
async def test_events_can_be_deleted_by_the_retention_job(
    session: AsyncSession, status: str
) -> None:
    event = await in_status(session, status)
    await session.execute(text("DELETE FROM outbox_events WHERE id = :id"), {"id": event.id})
    assert (
        await session.scalars(select(OutboxEvent.id).where(OutboxEvent.id == event.id))
    ).all() == []


# --- The claim ----------------------------------------------------------------------------


async def test_the_due_index_serves_the_workers_claim(session: AsyncSession) -> None:
    for version in range(1, 4):
        await saved(session, version=version)
    await session.execute(text("SET LOCAL enable_seqscan = off"))
    plan = await session.execute(
        text(
            "EXPLAIN SELECT id FROM outbox_events WHERE status = 'pending' "
            "AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20"
        )
    )
    assert "ix_outbox_events_due" in "\n".join(row[0] for row in plan)


# The claim exactly as ADR 0003 (section 5) gives it.
CLAIM = text(
    """
    UPDATE outbox_events o
    SET status = 'sending', locked_at = now(), attempts = attempts + 1
    WHERE o.id IN (
      SELECT d.id
      FROM outbox_events d
      WHERE d.status = 'pending'
        AND d.next_attempt_at <= now()
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events e
          WHERE e.aggregate_type = d.aggregate_type
            AND e.aggregate_id = d.aggregate_id
            AND e.version < d.version
            AND e.status IN ('pending', 'sending')
        )
      ORDER BY d.next_attempt_at
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id
    """
)


async def test_the_claim_takes_only_due_events_one_version_per_aggregate(
    session: AsyncSession,
) -> None:
    waiting = await saved(session, version=1)
    behind = await saved(session, aggregate_id=waiting.aggregate_id, version=2)
    other = await saved(session)
    not_due = await saved(session, next_attempt_at=NOW + timedelta(hours=1))
    delivered = await in_status(session, "sent", version=1)
    after_delivered = await saved(session, aggregate_id=delivered.aggregate_id, version=2)

    claimed = {row[0] for row in await session.execute(CLAIM)}
    assert claimed == {waiting.id, other.id, after_delivered.id}
    assert behind.id not in claimed  # its earlier version is still unsent
    assert not_due.id not in claimed

    won = await reload(session, waiting)
    assert (won.status, won.attempts) == ("sending", 1) and won.locked_at is not None
    assert (await reload(session, behind)).status == "pending"
    # Claimed once: a second claim finds nothing new.
    assert [row[0] for row in await session.execute(CLAIM)] == []


async def test_the_next_version_becomes_claimable_once_the_first_is_sent(
    session: AsyncSession,
) -> None:
    first = await saved(session, version=1)
    second = await saved(session, aggregate_id=first.aggregate_id, version=2)
    assert {row[0] for row in await session.execute(CLAIM)} == {first.id}
    await update(session, first, "status = 'sent', locked_at = NULL, sent_at = now()")
    assert {row[0] for row in await session.execute(CLAIM)} == {second.id}
