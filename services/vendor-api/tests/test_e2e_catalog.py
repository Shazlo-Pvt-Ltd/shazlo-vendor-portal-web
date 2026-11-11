"""The whole Phase 3 flow with the real pieces: Postgres, a real Redis, the real JWKS client
fetching identity-api's keys over HTTP (a mock transport stands in for the network), the real
emails' tokens, and a fake image host standing in for Cloudinary.

A vendor signs up and builds its brand page and catalog, and a reviewer works the queue, all
through the HTTP API: brand profile (edit, submit, approve, reject, revise), image uploads, bulk
import, product review and the revision of a live product, and a vendor account being approved,
suspended and reinstated. Each part starts from a fresh signup. Every approval also writes its
central-app event to the outbox (the writer runs in the decision's transaction), so the flow checks
those too: one valid event per approval, none per rejection, versions in order.

It needs `DATABASE_URL` and `REDIS_URL` (CI sets both) and skips without them.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from import_files import csv_bytes, good_row, more_variant
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import (
    ADMIN_ID,
    Api,
    Identity,
    RecordingSender,
    make_api,
    record_emails,
    token_of,
)
from test_assets_api import FakeHost
from test_e2e_auth import (  # noqa: F401  (pytest fixtures, used by name)
    PASSWORD,
    SIGNUP,
    Network,
    bearer,
    real_redis,
    refresh,
    stack_settings,
)
from test_outbox_writer import envelope

from vendor_api.core.settings import Settings
from vendor_api.db.models import BrandProfile, OutboxEvent, Product, Review
from vendor_api.services.assets import AssetService
from vendor_api.services.central_contract import contract
from vendor_api.services.email import EmailTemplate

OWNER = SIGNUP["email"]
CSV = "text/csv"


@dataclass
class World:
    api: Api
    sender: RecordingSender
    identity: Identity
    host: FakeHost
    admin: dict[str, str]  # headers of a reviewer

    @property
    def http(self) -> httpx.AsyncClient:
        return self.api.http


@pytest.fixture
async def world(
    stack_settings: Settings,  # noqa: F811
    session: AsyncSession,
    real_redis: Redis,  # noqa: F811
    override: Any,
) -> AsyncIterator[World]:
    identity = Identity()
    network = Network(identity)
    settings: Settings = override(
        stack_settings,
        cloudinary_cloud_name="democloud",
        cloudinary_api_key="123456789012345",
        cloudinary_api_secret="cloudinary-secret-value",
        upload_max_bytes=1_000_000,
    )
    async for api in make_api(settings, session, real_redis, network.client):
        host = FakeHost()
        api.app.state.assets = AssetService(settings, host)  # Cloudinary is the one fake
        yield World(
            api, record_emails(api), identity, host, bearer(identity.token(["vendor_reviewer"]))
        )


# --- Steps both sides share --------------------------------------------------------------


async def onboard(w: World) -> dict[str, str]:
    """Signs a vendor up, follows the link in the email, signs in. Returns the vendor's headers."""
    assert (await w.http.post("/v1/auth/signup", json=SIGNUP)).status_code == 202
    token = w.sender.tokens()[-1]
    assert (await w.http.post("/v1/auth/verify-email", json={"token": token})).status_code == 204
    login = await w.api.login(OWNER, PASSWORD)
    assert login.status_code == 200
    return bearer(login.json()["access_token"])


async def upload_image(w: World, vendor: dict[str, str], kind: str) -> str:
    """Signs an upload, "uploads" the file to the fake host, registers it. Returns the asset id."""
    signed = await w.http.post(
        "/v1/vendor/assets/sign",
        json={"kind": kind, "content_type": "image/jpeg", "size_bytes": 200_000},
        headers=vendor,
    )
    assert signed.status_code == 201, signed.text
    public_id = signed.json()["public_id"]
    assert signed.json()["fields"]["public_id"] == public_id
    w.host.upload(public_id)  # the browser's upload to Cloudinary
    registered = await w.http.post(
        "/v1/vendor/assets", json={"public_id": public_id}, headers=vendor
    )
    assert registered.status_code == 201, registered.text
    assert registered.json()["status"] == "ready"
    return str(registered.json()["id"])


async def queue(w: World, query: str = "") -> list[dict[str, Any]]:
    response = await w.http.get(f"/v1/admin/reviews{query}", headers=w.admin)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def review_detail(w: World, review_id: str) -> dict[str, Any]:
    response = await w.http.get(f"/v1/admin/reviews/{review_id}", headers=w.admin)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def decide(
    w: World, review: dict[str, Any], action: str, reason: str | None = None
) -> httpx.Response:
    version = (await review_detail(w, review["id"]))["content"]["version"]
    body: dict[str, Any] = {"version": version}
    if reason is not None:
        body["reason"] = reason
    return await w.http.post(
        f"/v1/admin/reviews/{review['id']}/{action}", json=body, headers=w.admin
    )


def fields_of(detail: dict[str, Any]) -> list[str]:
    return [change["field"] for change in detail["changes"]]


async def outbox(session: AsyncSession) -> list[OutboxEvent]:
    """Every event the approvals wrote, each checked against the contract as the receiver will."""
    events = list(
        await session.scalars(
            select(OutboxEvent).order_by(OutboxEvent.aggregate_id, OutboxEvent.version)
        )
    )
    for event in events:
        assert event.status == "pending"
        contract().validate(envelope(event))
    return events


# --- The brand page ----------------------------------------------------------------------


async def test_the_brand_page_from_first_draft_to_a_revised_live_version(
    world: World, session: AsyncSession
) -> None:
    w = world
    vendor = await onboard(w)

    # The first draft starts from what the vendor typed at signup.
    draft = (await w.http.get("/v1/vendor/brand-profile", headers=vendor)).json()
    assert (draft["state"], draft["version"], draft["brand_name"]) == ("draft", 1, "Atelier Rouge")
    assert (draft["price_min_paise"], draft["price_max_paise"]) == (99_900, 499_900)
    assert (
        await w.http.get("/v1/vendor/brand-profile/published", headers=vendor)
    ).status_code == 404

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
    saved = await w.http.put("/v1/vendor/brand-profile", json=page, headers=vendor)
    assert saved.status_code == 200
    assert (
        saved.json()["logo_url"].startswith("https://")
        and saved.json()["instagram_handle"] == "atelier.rouge"
    )

    submitted = await w.http.post("/v1/vendor/brand-profile/submit", headers=vendor)
    assert (submitted.status_code, submitted.json()["state"]) == (200, "pending_review")
    nothing = await w.http.post("/v1/vendor/brand-profile/submit", headers=vendor)
    assert (nothing.status_code, nothing.json()["error"]["code"]) == (409, "nothing_to_submit")

    # --- The reviewer sees it, in full, as a first submission
    (waiting,) = await queue(w)
    assert (waiting["subject"], waiting["status"], waiting["title"]) == (
        "brand_profile",
        "pending",
        "Atelier Rouge",
    )
    assert waiting["vendor"]["name"] == "Atelier Rouge" and waiting["vendor"]["status"] == "pending"
    first = await review_detail(w, waiting["id"])
    assert first["base"] is None and "tagline" in fields_of(first) and "logo" in fields_of(first)

    stale = await w.http.post(
        f"/v1/admin/reviews/{waiting['id']}/approve", json={"version": 2}, headers=w.admin
    )
    assert (stale.status_code, stale.json()["error"]["code"]) == (409, "stale_review")
    approved = await decide(w, waiting, "approve")
    assert approved.status_code == 200
    assert [e["action"] for e in approved.json()["events"]] == ["submitted", "approved"]
    assert approved.json()["reviewer_id"] == str(ADMIN_ID)
    live = (await w.http.get("/v1/vendor/brand-profile/published", headers=vendor)).json()
    assert (live["version"], live["tagline"], live["state"]) == (
        1,
        "Block prints, made slowly",
        "published",
    )
    assert await queue(w) == []

    # --- The vendor revises it: the reviewer sees exactly what changed, and turns it down
    draft = (await w.http.get("/v1/vendor/brand-profile", headers=vendor)).json()
    assert (draft["version"], draft["tagline"]) == (
        2,
        "Block prints, made slowly",
    )  # from the live one
    second = {**page, "tagline": "Hand block prints from Jaipur"}
    await w.http.put("/v1/vendor/brand-profile", json=second, headers=vendor)
    assert (await w.http.post("/v1/vendor/brand-profile/submit", headers=vendor)).status_code == 200
    (waiting,) = await queue(w)
    revision = await review_detail(w, waiting["id"])
    assert fields_of(revision) == ["tagline"]  # exactly the field that changed
    assert (revision["changes"][0]["before"], revision["changes"][0]["after"]) == (
        "Block prints, made slowly",
        "Hand block prints from Jaipur",
    )
    assert revision["base"]["version"] == 1
    no_reason = await w.http.post(
        f"/v1/admin/reviews/{waiting['id']}/reject", json={"version": 2}, headers=w.admin
    )
    assert no_reason.status_code == 422
    rejected = await decide(w, waiting, "reject", "Keep the tagline short")
    assert (rejected.status_code, rejected.json()["reason"]) == (200, "Keep the tagline short")
    still = (await w.http.get("/v1/vendor/brand-profile/published", headers=vendor)).json()
    assert still["tagline"] == "Block prints, made slowly"  # what shoppers see did not change

    # --- A third attempt goes live, replacing the first
    draft = (await w.http.get("/v1/vendor/brand-profile", headers=vendor)).json()
    assert draft["version"] == 3  # a new draft, not the rejected one
    third = {**page, "tagline": "Hand block prints, Jaipur"}
    await w.http.put("/v1/vendor/brand-profile", json=third, headers=vendor)
    await w.http.post("/v1/vendor/brand-profile/submit", headers=vendor)
    (waiting,) = await queue(w)
    detail = await review_detail(w, waiting["id"])
    assert detail["base"]["version"] == 1  # the rejected version never went live: it is skipped
    assert fields_of(detail) == ["tagline"]
    assert (await decide(w, waiting, "approve")).status_code == 200
    live = (await w.http.get("/v1/vendor/brand-profile/published", headers=vendor)).json()
    assert (live["version"], live["tagline"]) == (3, "Hand block prints, Jaipur")

    # --- Every decision left exactly one audit event, and the history stayed
    states = (
        await session.execute(
            select(BrandProfile.version, BrandProfile.state).order_by(BrandProfile.version)
        )
    ).all()
    assert [(v, s) for v, s in states] == [(1, "superseded"), (2, "rejected"), (3, "published")]
    decided = await queue(w, "?status=all")
    assert [(r["status"], r["reason"]) for r in reversed(decided)] == [
        ("approved", None),
        ("rejected", "Keep the tagline short"),
        ("approved", None),
    ]
    final = await review_detail(w, decided[0]["id"])
    assert [e["action"] for e in final["events"]] == ["submitted", "approved"]
    assert final["events"][1]["detail"]["after"] == {"state": "published", "superseded_version": 1}

    # --- Each approval wrote the page's event, the rejection none: versions 1 and 3
    events = await outbox(session)
    assert [(e.event_type, e.version) for e in events] == [
        ("brand_profile.published", 1),
        ("brand_profile.published", 3),
    ]
    assert events[-1].payload["tagline"] == "Hand block prints, Jaipur"
    assert events[-1].payload["logo_url"].startswith("https://")


# --- Products ----------------------------------------------------------------------------


def body_of(product: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """A `PUT` body that says what the product's working revision already says, plus changes."""
    working = product["working"]
    body: dict[str, Any] = {
        key: working[key]
        for key in (
            "title",
            "description",
            "category",
            "subcategory",
            "gender",
            "fabric",
            "weight_grams",
            "returnable",
            "return_window_days",
        )
    }
    body["variants"] = [
        {k: v[k] for k in ("sku", "size", "color", "price_paise", "mrp_paise", "is_active")}
        for v in working["variants"]
    ]
    body["images"] = [
        {"asset_id": i["asset_id"], "alt_text": i["alt_text"]} for i in working["images"]
    ]
    body.update(changes)
    return body


def repriced(body: dict[str, Any], sku: str, price_paise: int) -> list[dict[str, Any]]:
    """The body's variants with the price of one of them changed (its MRP stays)."""
    return [
        {**v, "price_paise": price_paise if v["sku"] == sku else v["price_paise"]}
        for v in body["variants"]
    ]


async def product(w: World, vendor: dict[str, str], product_id: str) -> dict[str, Any]:
    response = await w.http.get(f"/v1/vendor/products/{product_id}", headers=vendor)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_products_from_import_to_live_and_through_a_revision(
    world: World, session: AsyncSession
) -> None:
    w = world
    vendor = await onboard(w)
    me = (await w.http.get("/v1/vendor/me", headers=vendor)).json()
    approve_vendor = await w.http.post(
        f"/v1/admin/vendors/{me['vendor']['id']}/approve", json={}, headers=w.admin
    )
    assert approve_vendor.json()["status"] == "approved"
    assert w.sender.sent[-1][:2] == (OWNER, EmailTemplate.VENDOR_APPROVED)

    # --- Bulk import: check the file, import it, import it again
    sheet = csv_bytes(
        [
            good_row(sku="KURTA-001", title="Block-print cotton kurta", variant_sku="KURTA-001-M"),
            more_variant(sku="KURTA-001", variant_sku="KURTA-001-L"),
            good_row(
                sku="SCARF-014",
                title="Silk scarf",
                category="accessories",
                gender="unisex",
                returnable="no",
                return_window_days="",
                variant_sku="SCARF-014-OS",
                size="",
            ),
        ]
    )

    async def import_sheet(mode: str) -> dict[str, Any]:
        response = await w.http.post(
            f"/v1/vendor/products/import?mode={mode}",
            content=sheet,
            headers={**vendor, "Content-Type": CSV},
        )
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    checked = await import_sheet("validate")
    assert (checked["summary"]["valid"], checked["summary"]["created"], checked["errors"]) == (
        2,
        0,
        [],
    )
    listing = (await w.http.get("/v1/vendor/products", headers=vendor)).json()
    assert listing["total"] == 0  # validating wrote nothing
    imported = await import_sheet("import")
    assert (imported["summary"]["created"], imported["committed"]) == (2, True)
    ids = {p["sku"]: p["product_id"] for p in imported["products"]}
    again = await import_sheet("import")
    assert (again["summary"]["created"], again["summary"]["unchanged"]) == (0, 2)
    assert {p["sku"]: p["product_id"] for p in again["products"]} == ids  # no duplicates
    listing = (await w.http.get("/v1/vendor/products", headers=vendor)).json()
    assert (listing["total"], {i["status"] for i in listing["items"]}) == (2, {"draft"})

    kurta, scarf = ids["KURTA-001"], ids["SCARF-014"]

    # --- A product needs an image before it can be submitted
    bare = await product(w, vendor, kurta)
    refused = await w.http.post(f"/v1/vendor/products/{kurta}/submit", headers=vendor)
    assert (refused.status_code, refused.json()["error"]["code"]) == (422, "product_incomplete")
    image = await upload_image(w, vendor, "product_image")
    with_image = body_of(bare, images=[{"asset_id": image, "alt_text": "Front"}])
    assert (
        await w.http.put(f"/v1/vendor/products/{kurta}", json=with_image, headers=vendor)
    ).status_code == 200
    submitted = await w.http.post(f"/v1/vendor/products/{kurta}/submit", headers=vendor)
    assert (submitted.status_code, submitted.json()["status"]) == (200, "pending_review")
    in_review = await w.http.put(f"/v1/vendor/products/{kurta}", json=with_image, headers=vendor)
    assert (in_review.status_code, in_review.json()["error"]["code"]) == (409, "product_in_review")

    # --- The reviewer approves it: it goes live
    (waiting,) = await queue(w)
    assert (waiting["subject"], waiting["sku"], waiting["title"]) == (
        "product",
        "KURTA-001",
        "Block-print cotton kurta",
    )
    first = await review_detail(w, waiting["id"])
    assert first["base"] is None and fields_of(first)[0] == "title"
    assert (await decide(w, waiting, "approve")).status_code == 200
    live = await product(w, vendor, kurta)
    assert (live["status"], live["version"], live["live"]["title"], live["working"]) == (
        "approved",
        1,
        "Block-print cotton kurta",
        None,
    )

    # --- A rejected product is reworked and approved
    scarf_image = await upload_image(w, vendor, "product_image")
    bare_scarf = await product(w, vendor, scarf)
    await w.http.put(
        f"/v1/vendor/products/{scarf}",
        json=body_of(bare_scarf, images=[{"asset_id": scarf_image, "alt_text": None}]),
        headers=vendor,
    )
    await w.http.post(f"/v1/vendor/products/{scarf}/submit", headers=vendor)
    (waiting,) = await queue(w)
    assert (await decide(w, waiting, "reject", "Blurry photos")).status_code == 200
    rejected = await product(w, vendor, scarf)
    assert rejected["status"] == "rejected" and rejected["live"] is None
    assert (rejected["working"]["state"], rejected["working"]["review"]["reason"]) == (
        "rejected",
        "Blurry photos",
    )
    redo = await w.http.put(
        f"/v1/vendor/products/{scarf}",
        json=body_of(rejected, title="Silk scarf, hand-rolled edges"),
        headers=vendor,
    )
    assert (redo.json()["status"], redo.json()["working"]["version"]) == ("draft", 2)
    await w.http.post(f"/v1/vendor/products/{scarf}/submit", headers=vendor)
    (waiting,) = await queue(w)
    assert (await decide(w, waiting, "approve")).status_code == 200
    scarf_live = await product(w, vendor, scarf)
    assert (scarf_live["status"], scarf_live["version"]) == ("approved", 1)  # first time live

    # --- Editing a live product leaves it live until the edit is approved
    before = (await product(w, vendor, kurta))["live"]
    live_body = body_of({"working": before})  # what the live revision says, as a PUT body
    edited = await w.http.put(
        f"/v1/vendor/products/{kurta}",
        json={
            **live_body,
            "title": "Block-print cotton kurta, new cut",
            "variants": repriced(live_body, "KURTA-001-M", 129_900),
        },
        headers=vendor,
    )
    assert edited.status_code == 200
    pending = edited.json()
    assert (
        pending["status"] == "approved" and pending["live"] == before
    )  # shoppers still see the old
    assert (pending["working"]["version"], pending["working"]["state"]) == (2, "editing")
    assert (
        await w.http.post(f"/v1/vendor/products/{kurta}/submit", headers=vendor)
    ).status_code == 200

    (waiting,) = await queue(w)
    revision = await review_detail(w, waiting["id"])
    assert fields_of(revision) == ["title", "variants[KURTA-001-M].price_paise"]  # exactly these
    assert revision["base"]["version"] == 1
    assert (await decide(w, waiting, "reject", "Price too low for the fabric")).status_code == 200
    after_reject = await product(w, vendor, kurta)
    assert (after_reject["status"], after_reject["version"]) == ("approved", 1)
    assert after_reject["live"] == before  # a rejected edit never touches what is live
    assert after_reject["working"]["state"] == "rejected"

    rejected_body = body_of(after_reject)
    third_edit = await w.http.put(
        f"/v1/vendor/products/{kurta}",
        json={**rejected_body, "variants": repriced(rejected_body, "KURTA-001-M", 139_900)},
        headers=vendor,
    )
    assert (third_edit.json()["working"]["version"], third_edit.json()["live"]) == (3, before)
    await w.http.post(f"/v1/vendor/products/{kurta}/submit", headers=vendor)
    (waiting,) = await queue(w)
    assert (await decide(w, waiting, "approve")).status_code == 200
    final = await product(w, vendor, kurta)
    assert (final["status"], final["version"]) == ("approved", 2)  # live content changed once
    assert final["live"]["title"] == "Block-print cotton kurta, new cut"
    assert {v["sku"]: v["price_paise"] for v in final["live"]["variants"]}["KURTA-001-M"] == 139_900
    assert final["working"] is None

    # --- The audit trail of the products: five reviews, in the order they happened
    reviews = (
        await session.scalars(
            select(Review).where(Review.subject == "product").order_by(Review.submitted_at)
        )
    ).all()
    assert len(reviews) == 5  # kurta x3, scarf x2
    assert await session.scalar(select(Product.version).where(Product.sku == "KURTA-001")) == 2

    # --- Three approvals, three events; the two rejections wrote none
    versions: dict[str, list[int]] = {}
    for event in await outbox(session):
        assert event.event_type == "product.published"
        versions.setdefault(event.payload["sku"], []).append(event.version)
    assert versions == {"KURTA-001": [1, 2], "SCARF-014": [1]}


# --- A vendor account --------------------------------------------------------------------


async def test_a_vendor_is_approved_suspended_and_reinstated(world: World) -> None:
    w = world
    vendor = await onboard(w)
    me = (await w.http.get("/v1/vendor/me", headers=vendor)).json()
    vendor_id = me["vendor"]["id"]
    assert me["vendor"]["status"] == "pending"

    # The application is in the admin's list, oldest first; a pending vendor cannot be suspended.
    pending = (await w.http.get("/v1/admin/vendors", headers=w.admin)).json()
    assert [v["id"] for v in pending["items"]] == [vendor_id]
    too_early = await w.http.post(
        f"/v1/admin/vendors/{vendor_id}/suspend", json={"reason": "x"}, headers=w.admin
    )
    assert (too_early.status_code, too_early.json()["error"]["code"]) == (
        409,
        "invalid_status_transition",
    )

    approved = await w.http.post(f"/v1/admin/vendors/{vendor_id}/approve", json={}, headers=w.admin)
    assert approved.json()["status"] == "approved"
    assert w.sender.sent[-1][:2] == (OWNER, EmailTemplate.VENDOR_APPROVED)

    # Sign in as an approved vendor, then get suspended.
    login = await w.api.login(OWNER, PASSWORD)
    access, old_refresh = login.json()["access_token"], token_of(login)
    assert (await w.http.get("/v1/vendor/me", headers=bearer(access))).status_code == 200
    no_reason = await w.http.post(
        f"/v1/admin/vendors/{vendor_id}/suspend", json={"reason": "  "}, headers=w.admin
    )
    assert no_reason.status_code == 422
    suspended = await w.http.post(
        f"/v1/admin/vendors/{vendor_id}/suspend",
        json={"reason": "Repeated chargebacks"},
        headers=w.admin,
    )
    assert (suspended.json()["status"], suspended.json()["status_reason"]) == (
        "suspended",
        "Repeated chargebacks",
    )
    to, template, context = w.sender.sent[-1]
    assert (to, template, context["reason"]) == (
        OWNER,
        EmailTemplate.VENDOR_SUSPENDED,
        "Repeated chargebacks",
    )

    # Right away: the token, the refresh and a new sign-in are all refused.
    me = await w.http.get("/v1/vendor/me", headers=bearer(access))
    assert (me.status_code, me.json()["error"]["code"]) == (403, "vendor_not_allowed")
    assert (await refresh(w.api, old_refresh)).status_code == 401
    login = await w.api.login(OWNER, PASSWORD)
    assert (login.status_code, login.json()["error"]["code"]) == (403, "vendor_not_allowed")
    # ...and the catalog endpoints are closed to it.
    assert (await w.http.get("/v1/vendor/products", headers=bearer(access))).status_code == 403

    # Reinstated: it signs in again, but the old session does not come back.
    reinstated = await w.http.post(
        f"/v1/admin/vendors/{vendor_id}/approve", json={"reason": "Resolved"}, headers=w.admin
    )
    assert reinstated.json()["status"] == "approved"
    assert (await refresh(w.api, old_refresh)).status_code == 401
    assert (await w.api.login(OWNER, PASSWORD)).status_code == 200

    # An approved vendor is suspended, never rejected; the history shows every change.
    refused = await w.http.post(
        f"/v1/admin/vendors/{vendor_id}/reject", json={"reason": "x"}, headers=w.admin
    )
    assert refused.status_code == 409
    history = (await w.http.get(f"/v1/admin/vendors/{vendor_id}", headers=w.admin)).json()["events"]
    assert [(e["from_status"], e["to_status"], e["actor_type"]) for e in history] == [
        (None, "pending", "vendor"),
        ("pending", "approved", "admin"),
        ("approved", "suspended", "admin"),
        ("suspended", "approved", "admin"),
    ]
    assert history[2]["reason"] == "Repeated chargebacks" and history[2]["actor_id"] == str(
        ADMIN_ID
    )
    assert uuid.UUID(history[2]["actor_id"]) == ADMIN_ID
