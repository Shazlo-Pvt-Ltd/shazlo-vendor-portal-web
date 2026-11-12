# ruff: noqa: F811
"""Phase 4 end to end: an approval reaches the central app, survives failures, and is repaired.

The real pieces: Postgres, a real Redis, the whole HTTP API (signup, brand page, import, review,
vendor account), the outbox writer, the publisher worker with its signing, and the real stub
receiver (`services/central-stub`) which checks every signature and every event against the
contract. A recording transport sits between the worker and the stub so a test can see what went
over the wire, and can make one aggregate fail.

It needs `DATABASE_URL` and `REDIS_URL` (CI sets both) and skips without them, or without the stub
installed (`pip install -e ../central-stub`, which the CI job does).
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from import_files import csv_bytes, good_row
from redis.asyncio import Redis  # noqa: F401  (a fixture's annotation)
from shazlo_security.signing import RequestSigner, SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from test_e2e_auth import (  # noqa: F401  (pytest fixtures, used by name)
    real_redis,
    stack_settings,
)
from test_e2e_catalog import (  # noqa: F401  (pytest fixtures, used by name)
    World,
    body_of,
    decide,
    onboard,
    product,
    queue,
    upload_image,
    world,
)
from test_publisher import Clock, shared
from test_reconciliation import shared as unlocked

from vendor_api.db.models import OutboxEvent, OutboxEventLog
from vendor_api.services.outbox import OutboxWriter
from vendor_api.services.publisher import CentralClient, Claimed, Publisher
from vendor_api.services.reconciliation import Reconciler

central_stub = pytest.importorskip("central_stub.app")
stub_settings = pytest.importorskip("central_stub.settings")

SECRET = "e2e-publishing-secret-0123456789-abcdef"
KEY = SigningKey("e2e", SECRET.encode())
CSV = "text/csv"


class Wire(httpx.AsyncBaseTransport):
    """The network between the worker and the stub: it records what crosses, and can refuse one
    aggregate's events (a 500) without the stub knowing."""

    def __init__(self, app: Any) -> None:
        self._inner = httpx.ASGITransport(app=app)
        self.sent: list[tuple[str, str, int, str]] = []  # type, aggregate id, version, event id
        self.answers: list[str] = []  # what the stub said to each event
        self.fail_for: set[str] = set()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        event: dict[str, Any] | None = None
        if request.method == "POST":
            event = json.loads(request.content)
            if event is not None and event["aggregate"]["id"] in self.fail_for:
                return httpx.Response(500, json={"message": "down", "extra": {"code": "boom"}})
        response = await self._inner.handle_async_request(request)
        if event is not None and response.status_code == 200:
            # What the stub took in (accepted, duplicate or stale): a refused try is not "sent".
            await response.aread()
            self.sent.append(
                (event["type"], event["aggregate"]["id"], event["version"], event["event_id"])
            )
            self.answers.append(str(response.json().get("status")))
        return response


class Central:
    """The stub, the wire to it, and a worker that talks to it with a clock the test moves."""

    def __init__(self, session: AsyncSession) -> None:
        self.app = central_stub.create_app(
            stub_settings.Settings(stub_signing_keys=f"e2e:{SECRET}")
        )
        self.wire = Wire(self.app)
        self.client = CentralClient("http://central.test", RequestSigner(KEY), transport=self.wire)
        self.clock = Clock()
        self.clock.now = datetime.now(UTC) + timedelta(minutes=1)  # past every event's time
        self.session = session
        self.publisher = Publisher(shared(session), self.client, clock=self.clock)

    @property
    def store(self) -> Any:
        return self.app.state.store

    @property
    def behaviour(self) -> dict[str, Any]:
        return self.app.state.behaviour  # type: ignore[no-any-return]

    async def drain(self) -> int:
        """Runs the worker until nothing is due. Returns how many events it handled."""
        handled = 0
        for _ in range(20):
            count = await self.publisher.run_once()
            if count == 0:
                return handled
            handled += count
        raise AssertionError("the worker never went idle")

    def held(self, kind: str, aggregate_id: Any) -> Any:
        return self.store.held.get((kind, str(aggregate_id)))


# --- Setting a vendor up and approved, with a live brand page and product ------------------------


class Ids:
    def __init__(self, vendor_headers: dict[str, str], vendor_id: str, product_id: str) -> None:
        self.headers = vendor_headers
        self.vendor = vendor_id
        self.product = product_id


async def vendor_action(w: World, vendor_id: str, action: str, reason: str | None = None) -> None:
    body = {"reason": reason} if reason else {}
    response = await w.http.post(
        f"/v1/admin/vendors/{vendor_id}/{action}", json=body, headers=w.admin
    )
    assert response.status_code == 200, response.text


async def approve_next(w: World) -> None:
    (review,) = await queue(w)
    assert (await decide(w, review, "approve")).status_code == 200


async def go_live(w: World) -> Ids:
    """A signed-up vendor, approved, with its brand page and one product approved. Every approval
    wrote its event to the outbox; nothing has been sent."""
    vendor = await onboard(w)
    me = (await w.http.get("/v1/vendor/me", headers=vendor)).json()
    vendor_id = str(me["vendor"]["id"])
    await vendor_action(w, vendor_id, "approve")

    logo = await upload_image(w, vendor, "brand_logo")
    page = {
        "brand_name": "Atelier Rouge",
        "tagline": "Block prints, made slowly",
        "about": "A small studio in Jaipur.",
        "logo_asset_id": logo,
        "website_url": "https://atelier.example",
        "instagram_handle": "@atelier.rouge",
        "categories": ["kurtas", "dupattas"],
        "price_min_paise": 99_900,
        "price_max_paise": 499_900,
    }
    assert (
        await w.http.put("/v1/vendor/brand-profile", json=page, headers=vendor)
    ).status_code == 200
    assert (await w.http.post("/v1/vendor/brand-profile/submit", headers=vendor)).status_code == 200
    await approve_next(w)

    sheet = csv_bytes(
        [good_row(sku="KURTA-001", title="Block-print cotton kurta", variant_sku="KURTA-001-M")]
    )
    imported = await w.http.post(
        "/v1/vendor/products/import?mode=import",
        content=sheet,
        headers={**vendor, "Content-Type": CSV},
    )
    assert imported.status_code == 200, imported.text
    product_id = imported.json()["products"][0]["product_id"]
    image = await upload_image(w, vendor, "product_image")
    working = body_of(
        await product(w, vendor, product_id), images=[{"asset_id": image, "alt_text": "Front"}]
    )
    assert (
        await w.http.put(f"/v1/vendor/products/{product_id}", json=working, headers=vendor)
    ).status_code == 200
    assert (
        await w.http.post(f"/v1/vendor/products/{product_id}/submit", headers=vendor)
    ).status_code == 200
    await approve_next(w)
    return Ids(vendor, vendor_id, product_id)


async def events(session: AsyncSession) -> list[OutboxEvent]:
    rows = await session.scalars(
        select(OutboxEvent)
        .order_by(OutboxEvent.aggregate_id, OutboxEvent.version)
        .execution_options(populate_existing=True)
    )
    return list(rows)


def once_each_in_order(wire: Wire) -> None:
    """No event twice, and an aggregate's versions only ever go up."""
    assert len({event_id for *_, event_id in wire.sent}) == len(wire.sent)
    # A vendor's page and its status are two aggregates that share the vendor's id.
    latest: dict[tuple[str, str], int] = {}
    for kind, aggregate, version, _ in wire.sent:
        key = (kind.split(".")[0], aggregate)
        assert version > latest.get(key, 0), (key, version)
        latest[key] = version


# --- Publish, withdraw, recover ------------------------------------------------------------------


async def test_an_approval_reaches_the_central_app_is_withdrawn_and_comes_back(
    world: World, session: AsyncSession
) -> None:
    w = world
    ids = await go_live(w)
    central = Central(session)
    assert central.store.received == 0  # approving sent nothing: the outbox only holds it

    # A request without the signature is refused: only the signed ones below count.
    unsigned = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=central.app), base_url="http://c"
    )
    assert (await unsigned.post("/internal/v1/events", content=b"{}")).status_code == 401

    # --- The worker delivers the page, the product and the vendor's status, once each
    assert await central.drain() == 3
    sent = {(kind, version) for kind, _, version, _ in central.wire.sent}
    assert ("brand_profile.published", 1) in sent
    assert ("product.published", 1) in sent
    assert any(kind == "vendor.status_changed" for kind, _, _, _ in central.wire.sent)
    assert central.store.received == 3
    assert central.wire.answers == ["accepted"] * 3
    brand = central.held("brand_profile", ids.vendor)
    item = central.held("product", ids.product)
    assert (brand.state, brand.version, item.state, item.version) == (
        "published",
        1,
        "published",
        1,
    )
    assert item.data["title"] == "Block-print cotton kurta"
    assert {e.status for e in await events(session)} == {"sent"}
    assert await central.drain() == 0  # and nothing is sent twice

    # --- Suspending the vendor withdraws everything it showed
    await vendor_action(w, ids.vendor, "suspend", "Quality complaints")
    assert await central.drain() == 3
    brand = central.held("brand_profile", ids.vendor)
    item = central.held("product", ids.product)
    assert (brand.state, brand.version, item.state, item.version) == (
        "unpublished",
        2,
        "unpublished",
        2,
    )
    assert central.held("vendor", ids.vendor).state == "unpublished"

    # --- Reinstating shows exactly that again, at newer versions
    await vendor_action(w, ids.vendor, "approve", "Resolved")
    assert await central.drain() == 3
    brand = central.held("brand_profile", ids.vendor)
    item = central.held("product", ids.product)
    assert (brand.state, brand.version, item.state, item.version) == (
        "published",
        3,
        "published",
        3,
    )
    assert item.data["title"] == "Block-print cotton kurta"  # the full current state
    assert central.held("vendor", ids.vendor).state == "published"
    once_each_in_order(central.wire)
    assert central.store.received == len(central.wire.sent) == 9

    # --- Reconciliation, asking the real versions endpoint, finds nothing to repair
    rows = await events(session)
    assert {e.status for e in rows} == {"sent"}
    # The reconciler holds one session for its lock and opens others: no one-at-a-time wrapper.
    reconciler = Reconciler(
        unlocked(session), OutboxWriter(True), central.client, pause=0, clock=central.clock
    )
    report = await reconciler.reconcile()
    assert (report.total, report.in_flight) == (0, 0)
    logs = list(await session.scalars(select(OutboxEventLog)))
    assert len(logs) == len(rows)  # one attempt each, all delivered the first time


# --- Failure cases -------------------------------------------------------------------------------


async def test_a_central_app_that_fails_then_recovers_gets_each_event_once(
    world: World, session: AsyncSession
) -> None:
    await go_live(world)
    central = Central(session)
    central.behaviour.update(mode="error_500", remaining=None)  # down until told otherwise

    assert await central.drain() == 3
    assert central.store.received == 0
    failing = await events(session)
    assert {(e.status, e.attempts) for e in failing} == {("pending", 1)}
    assert {e.last_error for e in failing} == {"HTTP 500: stub_error"}

    # Not before its time: the first wait is 30 seconds, give or take a fifth.
    central.behaviour.update(mode="ok", remaining=None)
    central.clock.advance(seconds=10)
    assert await central.drain() == 0
    central.clock.advance(seconds=60)
    assert await central.drain() == 3

    assert central.store.received == 3  # delivered once, not three times
    assert {(e.status, e.attempts) for e in await events(session)} == {("sent", 2)}
    once_each_in_order(central.wire)
    outcomes = [
        e.outcome for e in await session.scalars(select(OutboxEventLog).order_by(OutboxEventLog.id))
    ]
    assert sum(o.startswith("failed, will try again") for o in outcomes) == 3
    assert sum(o == "sent (HTTP 200)" for o in outcomes) == 3


async def test_a_refused_signature_pauses_publishing_without_killing_the_events(
    world: World, session: AsyncSession
) -> None:
    await go_live(world)
    central = Central(session)
    central.behaviour.update(mode="unauthorized", remaining=None)

    await central.drain()
    central.clock.advance(seconds=61)
    await central.drain()  # five refusals in a row by now
    assert central.publisher.paused
    waiting = await events(session)
    # No event is dead, and the refusals did not use up their attempts: the key is the problem.
    assert {(e.status, e.attempts) for e in waiting} == {("pending", 0)}
    assert central.store.received == 0

    # The key is fixed. Nothing goes out until the next probe, then everything does.
    central.behaviour.update(mode="ok", remaining=None)
    central.clock.advance(seconds=61)
    assert await central.publisher.run_once() == 0  # paused: a probe only every five minutes
    central.clock.advance(seconds=300)
    assert await central.drain() == 3
    assert not central.publisher.paused
    assert central.store.received == 3
    assert {e.status for e in await events(session)} == {"sent"}


async def test_an_aggregate_that_fails_does_not_block_another(
    world: World, session: AsyncSession
) -> None:
    ids = await go_live(world)
    central = Central(session)
    central.wire.fail_for = {ids.product}  # only the product's events are refused

    await central.drain()
    assert central.held("brand_profile", ids.vendor).state == "published"
    assert central.held("vendor", ids.vendor).state == "published"
    assert central.held("product", ids.product) is None
    product_event = next(e for e in await events(session) if e.aggregate_type == "product")
    assert (product_event.status, product_event.attempts) == ("pending", 1)

    central.wire.fail_for = set()
    central.clock.advance(minutes=1)
    assert await central.drain() == 1
    assert central.held("product", ids.product).state == "published"
    once_each_in_order(central.wire)


async def test_a_worker_that_crashes_mid_send_is_recovered_and_the_repeat_is_a_duplicate(
    world: World, session: AsyncSession
) -> None:
    ids = await go_live(world)
    central = Central(session)

    # A worker claims the events and sends one of them, then dies before it writes any result.
    claimed: list[Claimed] = await central.publisher._claim(central.clock.now, 20)
    assert len(claimed) == 3
    delivered = next(c for c in claimed if c.aggregate_type == "product")
    assert (await central.client.send(delivered)).status == 200
    assert central.store.received == 1
    assert {e.status for e in await events(session)} == {"sending"}

    # Nothing happens while the claim is fresh; two minutes on, the sweeper gives the rows back.
    central.clock.advance(seconds=90)
    assert await central.publisher.maintain() == (0, 0)
    central.clock.advance(seconds=60)
    assert await central.publisher.maintain() == (3, 0)
    assert {e.status for e in await events(session)} == {"pending"}

    # The next worker sends all three again: the one that already arrived is a duplicate.
    assert await central.drain() == 3
    assert sorted(central.wire.answers) == ["accepted", "accepted", "accepted", "duplicate"]
    assert central.store.received == 3  # not four: the duplicate was recognised, not applied
    assert {e.status for e in await events(session)} == {"sent"}
    assert central.held("product", ids.product).state == "published"


async def test_a_dead_event_is_found_retried_and_delivered(
    world: World, session: AsyncSession
) -> None:
    ids = await go_live(world)
    central = Central(session)
    central.wire.fail_for = {ids.product}
    for _ in range(8):  # eight failed attempts make the event dead
        await central.drain()
        central.clock.advance(days=2)
    dead = [e for e in await events(session) if e.status == "dead"]
    assert [e.aggregate_type for e in dead] == ["product"]
    assert (dead[0].last_error or "").startswith("HTTP 500: boom")

    # An admin finds it, sees why it died, and retries it.
    listing = await world.http.get("/v1/admin/outbox?status=dead", headers=world.admin)
    assert [item["id"] for item in listing.json()["items"]] == [str(dead[0].id)]
    detail = (await world.http.get(f"/v1/admin/outbox/{dead[0].id}", headers=world.admin)).json()
    assert detail["history"][-1]["outcome"].startswith("failed for good")
    retried = await world.http.post(f"/v1/admin/outbox/{dead[0].id}/retry", headers=world.admin)
    assert retried.status_code == 200 and retried.json()["status"] == "pending"

    central.wire.fail_for = set()
    assert await central.drain() == 1
    assert central.held("product", ids.product).state == "published"
    assert {e.status for e in await events(session)} == {"sent"}
