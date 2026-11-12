"""The outbox for admins: find a stuck event, see why it died, retry it (ADR 0003, section 4).

Events are built straight in the table. A refused request rolls the shared test session back, so
each test commits what it sets up, keeps ids instead of rows, and reads results again.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import Tenants
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_publisher import Clock, Receiver, build

from vendor_api.db.models import OutboxEvent, OutboxEventLog
from vendor_api.services.publisher import CLAIM

OUTBOX = "/v1/admin/outbox"


def now() -> datetime:
    return datetime.now(UTC)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, path: str = "", token: str | None = None) -> httpx.Response:
    return await tenants.api.http.get(OUTBOX + path, headers=bearer(token or tenants.admin_token))


async def retry(
    tenants: Tenants, event_id: uuid.UUID | str, token: str | None = None
) -> httpx.Response:
    return await tenants.api.http.post(
        f"{OUTBOX}/{event_id}/retry", headers=bearer(token or tenants.admin_token)
    )


async def add(
    session: AsyncSession, vendor_id: uuid.UUID, status: str = "pending", **changes: Any
) -> uuid.UUID:
    values: dict[str, Any] = {
        "vendor_id": vendor_id,
        "aggregate_type": "product",
        "aggregate_id": uuid.uuid4(),
        "event_type": "product.published",
        "version": 1,
        "payload": {"sku": "KURTA-01", "title": "Block-print kurta"},
        "status": status,
        "created_at": now() - timedelta(hours=1),
        "next_attempt_at": now() - timedelta(hours=1),
    }
    if status == "sent":
        values["sent_at"] = now() - timedelta(minutes=30)
    if status == "sending":
        values["locked_at"] = now() - timedelta(seconds=5)
    if status == "dead":
        values.update(attempts=8, last_error="HTTP 503 (after 8 attempts)")
    row = OutboxEvent(**{**values, **changes})
    session.add(row)
    await session.flush()
    event_id: uuid.UUID = row.id
    return event_id


async def row(session: AsyncSession, event_id: uuid.UUID) -> OutboxEvent:
    result = await session.scalars(
        select(OutboxEvent)
        .where(OutboxEvent.id == event_id)
        .execution_options(populate_existing=True)
    )
    return result.one()


async def log_of(session: AsyncSession, event_id: uuid.UUID) -> list[OutboxEventLog]:
    result = await session.scalars(
        select(OutboxEventLog)
        .where(OutboxEventLog.event_id == event_id)
        .order_by(OutboxEventLog.id)
        .execution_options(populate_existing=True)
    )
    return list(result)


# --- Who can ------------------------------------------------------------------------------------


@pytest.mark.parametrize("roles", [[], ["other_role"], ["vendor"]])
async def test_an_admin_without_the_reviewer_role_is_refused(
    tenants: Tenants, session: AsyncSession, roles: list[str]
) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    await session.commit()
    token = tenants.identity.token(roles)
    assert (await get(tenants, token=token)).status_code == 403
    assert (await get(tenants, "/stats", token=token)).status_code == 403
    assert (await get(tenants, f"/{dead}", token=token)).status_code == 403
    assert (await retry(tenants, dead, token=token)).status_code == 403
    assert (await row(session, dead)).status == "dead"  # nothing was changed
    assert await log_of(session, dead) == []


@pytest.mark.parametrize("role", ["vendor_reviewer", "super_admin"])
async def test_reviewers_and_super_admins_can_use_it(tenants: Tenants, role: str) -> None:
    token = tenants.identity.token([role])
    assert (await get(tenants, token=token)).status_code == 200
    assert (await get(tenants, "/stats", token=token)).status_code == 200


async def test_vendor_tokens_and_no_token_never_reach_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    await session.commit()
    http = tenants.api.http
    for method, path in (
        ("get", ""),
        ("get", "/stats"),
        ("get", f"/{dead}"),
        ("post", f"/{dead}/retry"),
    ):
        assert (await http.request(method, OUTBOX + path)).status_code == 401
        for token in (tenants.a.owner_token, tenants.a.staff_token, tenants.b.owner_token):
            response = await http.request(method, OUTBOX + path, headers=bearer(token))
            assert response.status_code == 401, (method, path)
    assert (await row(session, dead)).status == "dead"


# --- Finding events -----------------------------------------------------------------------------


async def test_dead_events_come_first_and_the_list_has_no_bodies(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor = tenants.a.vendor.id
    sent = await add(session, vendor, "sent", created_at=now() - timedelta(minutes=1))
    pending = await add(session, vendor, "pending", created_at=now() - timedelta(minutes=2))
    dead = await add(session, vendor, "dead", created_at=now() - timedelta(days=2))
    await session.commit()

    body = (await get(tenants)).json()
    assert [item["id"] for item in body["items"]] == [str(dead), str(sent), str(pending)]
    assert (body["total"], body["limit"], body["offset"]) == (3, 25, 0)
    first = body["items"][0]
    assert first["status"] == "dead"
    assert first["attempts"] == 8
    assert first["last_error"] == "HTTP 503 (after 8 attempts)"
    assert {"next_attempt_at", "locked_at", "created_at", "sent_at", "version"} <= set(first)
    assert all("payload" not in item for item in body["items"])


async def test_the_list_can_be_filtered(tenants: Tenants, session: AsyncSession) -> None:
    a, b = tenants.a.vendor.id, tenants.b.vendor.id
    a_dead = await add(session, a, "dead")
    a_brand = await add(
        session,
        a,
        "pending",
        aggregate_type="brand_profile",
        aggregate_id=a,
        event_type="brand_profile.published",
    )
    b_dead = await add(session, b, "dead")
    await add(session, b, "sent")
    await session.commit()

    async def ids(query: str) -> set[str]:
        response = await get(tenants, query)
        assert response.status_code == 200, response.text
        return {item["id"] for item in response.json()["items"]}

    assert await ids("?status=dead") == {str(a_dead), str(b_dead)}
    assert await ids(f"?vendor_id={a}") == {str(a_dead), str(a_brand)}
    assert await ids("?aggregate_type=brand_profile") == {str(a_brand)}
    assert await ids(f"?status=dead&vendor_id={b}") == {str(b_dead)}
    assert await ids(f"?status=sent&vendor_id={a}") == set()
    assert len(await ids("")) == 4


async def test_the_list_is_paged(tenants: Tenants, session: AsyncSession) -> None:
    vendor = tenants.a.vendor.id
    for minutes in range(5):
        await add(session, vendor, "pending", created_at=now() - timedelta(minutes=minutes))
    await session.commit()
    pages = [(await get(tenants, f"?limit=2&offset={offset}")).json() for offset in (0, 2, 4)]
    assert [len(p["items"]) for p in pages] == [2, 2, 1]
    assert {p["total"] for p in pages} == {5}
    seen = [item["id"] for p in pages for item in p["items"]]
    assert len(set(seen)) == 5  # no event twice, none missing


@pytest.mark.parametrize(
    "query",
    [
        "?status=lost",
        "?aggregate_type=order",
        "?vendor_id=nope",
        "?limit=0",
        "?limit=101",
        "?offset=-1",
    ],
)
async def test_a_bad_filter_is_a_422(tenants: Tenants, query: str) -> None:
    assert (await get(tenants, query)).status_code == 422


# --- One event ----------------------------------------------------------------------------------


async def test_an_event_shows_its_body_and_what_happened_to_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    for minutes, outcome in (
        (5, "failed, will try again in 30 s: HTTP 503"),
        (1, "failed for good: HTTP 422: schema_invalid"),
    ):
        session.add(
            OutboxEventLog(
                event_id=dead,
                kind="attempt",
                outcome=outcome,
                created_at=now() - timedelta(minutes=minutes),
            )
        )
    await session.commit()

    response = await get(tenants, f"/{dead}")
    assert response.status_code == 200
    body = response.json()
    assert body["payload"] == {"sku": "KURTA-01", "title": "Block-print kurta"}
    assert body["status"] == "dead" and body["last_error"]
    assert [(h["kind"], h["outcome"]) for h in body["history"]] == [
        ("attempt", "failed, will try again in 30 s: HTTP 503"),
        ("attempt", "failed for good: HTTP 422: schema_invalid"),
    ]
    assert all(h["actor_id"] is None for h in body["history"])


async def test_an_unknown_event_is_a_404(tenants: Tenants) -> None:
    missing = uuid.uuid4()
    for response in (await get(tenants, f"/{missing}"), await retry(tenants, missing)):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "outbox_event_not_found"
    assert (await get(tenants, "/not-a-uuid")).status_code == 422


# --- Retrying -----------------------------------------------------------------------------------


async def test_retrying_a_dead_event_puts_it_back_and_records_the_admin(
    tenants: Tenants, session: AsyncSession
) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    await session.commit()
    admin = uuid.uuid4()
    token = tenants.identity.token(["vendor_reviewer"], subject=admin)

    response = await retry(tenants, dead, token=token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["attempts"]) == ("pending", 0)
    assert body["last_error"] == "HTTP 503 (after 8 attempts)"  # why it died stays on record
    assert body["history"][-1]["kind"] == "retry"
    assert body["history"][-1]["actor_id"] == str(admin)

    after = await row(session, dead)
    assert (after.status, after.attempts, after.locked_at) == ("pending", 0, None)
    assert after.next_attempt_at <= datetime.now(UTC) + timedelta(seconds=5)  # due now
    (entry,) = await log_of(session, dead)
    assert (entry.kind, entry.actor_id) == ("retry", admin)
    # The body of the event is what it always was.
    assert after.payload == {"sku": "KURTA-01", "title": "Block-print kurta"}


async def test_the_admin_comes_from_the_token_and_nothing_else(
    tenants: Tenants, session: AsyncSession
) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    await session.commit()
    pretender = uuid.uuid4()
    response = await tenants.api.http.post(
        f"{OUTBOX}/{dead}/retry?actor_id={pretender}",
        headers={**bearer(tenants.admin_token), "X-Actor-Id": str(pretender)},
    )
    assert response.status_code == 200
    (entry,) = await log_of(session, dead)
    assert entry.actor_id != pretender


@pytest.mark.parametrize("status", ["pending", "sending", "sent"])
async def test_only_a_dead_event_can_be_retried(
    tenants: Tenants, session: AsyncSession, status: str
) -> None:
    event = await add(session, tenants.a.vendor.id, status)
    await session.commit()
    response = await retry(tenants, event)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invalid_outbox_status"
    assert status in response.json()["error"]["message"]
    after = await row(session, event)
    assert after.status == status
    assert await log_of(session, event) == []


async def test_a_double_click_retries_once(tenants: Tenants, session: AsyncSession) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    await session.commit()
    assert (await retry(tenants, dead)).status_code == 200
    assert (await retry(tenants, dead)).status_code == 409
    assert len(await log_of(session, dead)) == 1


async def test_a_retried_event_does_not_jump_an_earlier_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor, aggregate = tenants.a.vendor.id, uuid.uuid4()
    first = await add(session, vendor, "pending", aggregate_id=aggregate, version=1)
    second = await add(session, vendor, "dead", aggregate_id=aggregate, version=2)
    await session.commit()
    assert (await retry(tenants, second)).status_code == 200

    soon = datetime.now(UTC) + timedelta(minutes=1)
    claimed = {r[0] for r in await session.execute(CLAIM, {"now": soon, "limit": 10})}
    assert claimed == {first}  # version 1 still goes first; version 2 waits behind it


# --- What the worker records ----------------------------------------------------------------------


async def test_the_worker_leaves_a_log_of_every_attempt(
    tenants: Tenants, session: AsyncSession
) -> None:
    event = await add(
        session,
        tenants.a.vendor.id,
        "pending",
        next_attempt_at=datetime(2026, 11, 11, 11, 0, tzinfo=UTC),
    )
    clock = Clock()
    receiver = Receiver(503, 200)
    publisher = build(session, receiver, clock)
    await publisher.run_once()
    clock.advance(hours=1)
    await publisher.run_once()
    entries = await log_of(session, event)
    assert [e.kind for e in entries] == ["attempt", "attempt"]
    assert entries[0].outcome.startswith("failed, will try again in ")
    assert "HTTP 503" in entries[0].outcome
    assert entries[1].outcome == "sent (HTTP 200)"


async def test_a_permanent_failure_is_logged_with_its_reason(
    tenants: Tenants, session: AsyncSession
) -> None:
    event = await add(
        session,
        tenants.a.vendor.id,
        "pending",
        next_attempt_at=datetime(2026, 11, 11, 11, 0, tzinfo=UTC),
    )
    receiver = Receiver((422, {}, {"error": {"code": "schema_invalid"}}))
    await build(session, receiver, Clock()).run_once()
    (entry,) = await log_of(session, event)
    assert entry.outcome == "failed for good: HTTP 422: schema_invalid"
    assert (await row(session, event)).status == "dead"


# --- Monitoring -----------------------------------------------------------------------------------


async def test_the_counts_for_monitoring(tenants: Tenants, session: AsyncSession) -> None:
    empty = (await get(tenants, "/stats")).json()
    assert empty == {"pending": 0, "sending": 0, "dead": 0, "oldest_due_age_seconds": None}

    vendor = tenants.a.vendor.id
    await add(session, vendor, "pending", next_attempt_at=now() - timedelta(minutes=10))
    await add(session, vendor, "pending", next_attempt_at=now() - timedelta(minutes=2))
    await add(session, vendor, "pending", next_attempt_at=now() + timedelta(hours=2))  # not due
    await add(session, vendor, "sending")
    await add(session, vendor, "dead")
    await add(session, vendor, "dead")
    await add(session, vendor, "sent")
    await session.commit()

    stats = (await get(tenants, "/stats")).json()
    assert (stats["pending"], stats["sending"], stats["dead"]) == (3, 1, 2)
    assert 590 <= stats["oldest_due_age_seconds"] <= 700  # the one due ten minutes ago


async def test_the_readiness_probe_carries_the_counts_without_changing_its_verdict(
    tenants: Tenants,
) -> None:
    response = await tenants.api.http.get("/ready")
    body = response.json()
    assert set(body) == {"status", "checks", "outbox"}
    assert body["outbox"] is None or set(body["outbox"]) == {
        "pending",
        "sending",
        "dead",
        "oldest_due_age_seconds",
    }


async def test_no_answer_carries_a_signature_or_a_secret(
    tenants: Tenants, session: AsyncSession
) -> None:
    dead = await add(session, tenants.a.vendor.id, "dead")
    session.add(OutboxEventLog(event_id=dead, kind="attempt", outcome="failed for good: HTTP 401"))
    await session.commit()
    texts = [
        (await get(tenants)).text,
        (await get(tenants, f"/{dead}")).text,
        (await get(tenants, "/stats")).text,
        (await retry(tenants, dead)).text,
    ]
    secret = tenants.api.app.state.settings.central_signing_secret
    for text in texts:
        lowered = text.lower()
        for forbidden in (
            "x-shazlo-signature",
            "x-shazlo-key-id",
            "v1=",
            "secret",
            "authorization",
        ):
            assert forbidden not in lowered, forbidden
        if secret is not None:
            assert secret.get_secret_value() not in text


async def test_the_log_goes_with_its_event(tenants: Tenants, session: AsyncSession) -> None:
    event = await add(session, tenants.a.vendor.id, "sent")
    session.add(OutboxEventLog(event_id=event, kind="attempt", outcome="sent (HTTP 200)"))
    await session.flush()
    await session.execute(delete(OutboxEvent).where(OutboxEvent.id == event))
    assert await session.scalar(select(func.count()).select_from(OutboxEventLog)) == 0
