"""Approving and rejecting reviews over HTTP.

A refused decision rolls the shared test session back, so each test commits what it sets up
first, keeps ids instead of rows, and reads the result again from the database afterwards.
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from review_builders import (
    product_review,
    profile,
    profile_review,
    submitted_product,
    two_revisions,
)
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import ADMIN_ID

from vendor_api.db.models import (
    BrandProfile,
    Product,
    ProductRevision,
    Review,
    ReviewEvent,
)
from vendor_api.services.review_decisions import Decision

QUEUE = "/v1/admin/reviews"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def decide(
    tenants: Tenants,
    review_id: uuid.UUID | str,
    action: str,
    body: dict[str, Any] | None,
    token: str | None = None,
    suffix: str = "",
) -> httpx.Response:
    return await tenants.api.http.post(
        f"{QUEUE}/{review_id}/{action}{suffix}",
        json=body,
        headers=bearer(token or tenants.admin_token),
    )


async def reload[T](session: AsyncSession, model: type[T], row_id: uuid.UUID) -> T:
    """A row read again from the database (a rolled-back session has expired what it held)."""
    id_column = getattr(model, "id")  # noqa: B009
    result = await session.scalars(
        select(model).where(id_column == row_id).execution_options(populate_existing=True)
    )
    return result.one()


async def events_of(session: AsyncSession, review_id: uuid.UUID) -> list[ReviewEvent]:
    result = await session.scalars(
        select(ReviewEvent).where(ReviewEvent.review_id == review_id).order_by(ReviewEvent.id)
    )
    return list(result)


async def decision_events(session: AsyncSession, review_id: uuid.UUID) -> list[ReviewEvent]:
    return [e for e in await events_of(session, review_id) if e.action in {"approved", "rejected"}]


async def count_events(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(ReviewEvent)) or 0


# --- Reviews to decide -------------------------------------------------------------------


async def pending_profile(
    session: AsyncSession, tenant: Tenant, version: int = 1, **changes: Any
) -> tuple[uuid.UUID, uuid.UUID]:
    """A brand profile version in review, with the submission event a real one would have.
    Returns (profile id, review id), committed."""
    version_row = await profile(session, tenant, version, "pending_review", **changes)
    review = await profile_review(session, tenant, version_row, version)
    session.add(
        ReviewEvent(
            review_id=review.id, action="submitted", actor_type="vendor", actor_id=tenant.owner.id
        )
    )
    await session.flush()
    ids = (version_row.id, review.id)
    await session.commit()
    return ids


async def pending_first_product(
    session: AsyncSession, tenant: Tenant, sku: str = "NEW-1"
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A product whose first revision is in review. Returns (product, revision, review ids)."""
    product, revision = await submitted_product(session, tenant, sku, 1)
    product.pending_revision_id = revision.id
    product.status = "pending_review"
    await session.flush()
    review = await product_review(session, tenant, revision, 2)
    ids = (product.id, revision.id, review.id)
    await session.commit()
    return ids


async def pending_edit(
    session: AsyncSession, tenant: Tenant
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """An approved product (revision 1 live) whose revision 2 is in review. Returns the product,
    both revisions and the review."""
    product, first, second = await two_revisions(session, tenant)
    product.pending_revision_id = second.id
    await session.flush()
    review = await product_review(session, tenant, second, 3)
    ids = (product.id, first.id, second.id, review.id)
    await session.commit()
    return ids


# --- Who may decide ----------------------------------------------------------------------


@pytest.mark.parametrize("action", ["approve", "reject"])
async def test_only_a_reviewer_or_super_admin_can_decide(
    tenants: Tenants, session: AsyncSession, action: str
) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    body = {"version": 1, "reason": "No"} if action == "reject" else {"version": 1}
    http = tenants.api.http
    assert (await http.post(f"{QUEUE}/{review_id}/{action}", json=body)).status_code == 401
    for token in (tenants.a.owner_token, tenants.a.staff_token):
        assert (await decide(tenants, review_id, action, body, token=token)).status_code == 401
    for roles in ([], ["other_role"]):
        refused = await decide(
            tenants, review_id, action, body, token=tenants.identity.token(roles)
        )
        assert refused.status_code == 403
    still = await reload(session, Review, review_id)
    assert still.status == "pending" and still.reviewer_id is None
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"

    allowed = await decide(
        tenants, review_id, action, body, token=tenants.identity.token(["super_admin"])
    )
    assert allowed.status_code == 200


async def test_the_reviewer_is_the_token_never_the_request(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, review_id = await pending_profile(session, tenants.a)
    other = uuid.uuid4()
    attempts: list[dict[str, Any]] = [
        {"version": 1, "reviewer_id": str(other)},
        {"version": 1, "decided_by": str(other)},
        {"version": 1, "status": "rejected"},
    ]
    for body in attempts:
        assert (await decide(tenants, review_id, "approve", body)).status_code == 422
    assert (await reload(session, Review, review_id)).status == "pending"

    # A reviewer id in the query or a header is never read.
    response = await decide(
        tenants,
        review_id,
        "approve",
        {"version": 1},
        suffix=f"?reviewer_id={other}",
    )
    assert response.status_code == 200
    review = await reload(session, Review, review_id)
    assert review.reviewer_id == ADMIN_ID != other
    (event,) = await decision_events(session, review_id)
    assert event.actor_id == ADMIN_ID and event.actor_type == "admin"
    assert response.json()["reviewer_id"] == str(ADMIN_ID)


async def test_each_admin_is_recorded_as_themselves(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, first = await pending_profile(session, tenants.a)
    _, second = await pending_profile(session, tenants.b)
    one, two = uuid.uuid4(), uuid.uuid4()
    await decide(
        tenants,
        first,
        "approve",
        {"version": 1},
        token=tenants.identity.token(["vendor_reviewer"], subject=one),
    )
    await decide(
        tenants,
        second,
        "approve",
        {"version": 1},
        token=tenants.identity.token(["vendor_reviewer"], subject=two),
    )
    assert (await reload(session, Review, first)).reviewer_id == one
    assert (await reload(session, Review, second)).reviewer_id == two


# --- Approving a brand profile -----------------------------------------------------------


async def test_approving_the_first_version_publishes_it(
    tenants: Tenants, session: AsyncSession
) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    response = await decide(tenants, review_id, "approve", {"version": 1})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert (body["status"], body["reviewer_id"], body["reason"]) == (
        "approved",
        str(ADMIN_ID),
        None,
    )
    assert body["decided_at"] is not None

    published = await reload(session, BrandProfile, profile_id)
    assert published.state == "published" and published.published_at is not None
    review = await reload(session, Review, review_id)
    assert (review.status, review.reviewer_id) == ("approved", ADMIN_ID)
    assert review.decided_at is not None and review.reason is None


async def test_approving_a_newer_version_supersedes_the_live_one(
    tenants: Tenants, session: AsyncSession
) -> None:
    live = await profile(session, tenants.a, 2, "published", tagline="Old")
    live_id, published_at = live.id, live.published_at
    new_id, review_id = await pending_profile(session, tenants.a, 3, tagline="New")
    response = await decide(tenants, review_id, "approve", {"version": 3})
    assert response.status_code == 200

    old = await reload(session, BrandProfile, live_id)
    new = await reload(session, BrandProfile, new_id)
    assert (old.state, new.state) == ("superseded", "published")
    assert old.published_at == published_at  # history is not rewritten
    assert new.published_at is not None
    states = (
        await session.scalars(
            select(BrandProfile.state).where(BrandProfile.vendor_id == new.vendor_id)
        )
    ).all()
    assert sorted(states) == ["published", "superseded"]  # never two published


async def test_approving_records_what_changed_before_and_after(
    tenants: Tenants, session: AsyncSession
) -> None:
    await profile(session, tenants.a, 2, "published")
    profile_id, review_id = await pending_profile(session, tenants.a, 3)
    response = await decide(tenants, review_id, "approve", {"version": 3})
    events = response.json()["events"]
    assert [e["action"] for e in events] == ["submitted", "approved"]
    approved = events[1]
    assert (approved["actor_type"], approved["actor_id"], approved["reason"]) == (
        "admin",
        str(ADMIN_ID),
        None,
    )
    assert approved["detail"] == {
        "subject": "brand_profile",
        "brand_profile_id": str(profile_id),
        "version": 3,
        "before": {"state": "pending_review", "published_version": 2},
        "after": {"state": "published", "superseded_version": 2},
    }
    assert events[0]["detail"] is None  # a submission needs no more than its row
    stored = (await decision_events(session, review_id))[0]
    assert stored.detail == approved["detail"] and stored.created_at is not None


async def test_the_answer_is_the_review_as_it_now_stands(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, review_id = await pending_profile(session, tenants.a, tagline="Made slowly")
    body = (await decide(tenants, review_id, "approve", {"version": 1})).json()
    again = (
        await tenants.api.http.get(f"{QUEUE}/{review_id}", headers=bearer(tenants.admin_token))
    ).json()
    assert body == again
    assert body["content"]["version"] == 1 and body["status"] == "approved"


# --- Rejecting a brand profile -----------------------------------------------------------


async def test_rejecting_needs_a_reason(tenants: Tenants, session: AsyncSession) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    for body in (
        {"version": 1},
        {"version": 1, "reason": ""},
        {"version": 1, "reason": "   "},
        {"version": 1, "reason": "\n\t "},
        {"version": 1, "reason": None},
        {"version": 1, "reason": "x" * 2001},
        {"version": 1, "reason": 5},
    ):
        response = await decide(tenants, review_id, "reject", body)
        assert response.status_code == 422, body
        assert response.json()["error"]["code"] == "validation_error"
    review = await reload(session, Review, review_id)
    assert (review.status, review.reason) == ("pending", None)
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"
    assert await decision_events(session, review_id) == []


async def test_rejecting_records_the_reason_and_turns_the_version_down(
    tenants: Tenants, session: AsyncSession
) -> None:
    live = await profile(session, tenants.a, 1, "published", tagline="Live")
    live_id = live.id
    profile_id, review_id = await pending_profile(session, tenants.a, 2)
    response = await decide(
        tenants, review_id, "reject", {"version": 2, "reason": "  Needs a better logo  "}
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["status"], body["reason"], body["reviewer_id"]) == (
        "rejected",
        "Needs a better logo",
        str(ADMIN_ID),
    )
    assert (await reload(session, BrandProfile, profile_id)).state == "rejected"
    assert (await reload(session, BrandProfile, live_id)).state == "published"  # untouched
    (event,) = await decision_events(session, review_id)
    assert (event.action, event.actor_id, event.reason) == (
        "rejected",
        ADMIN_ID,
        "Needs a better logo",
    )
    assert event.detail is not None and event.detail["after"] == {
        "state": "rejected",
        "published_version": 1,
    }


# --- Stale and repeated decisions --------------------------------------------------------


async def test_a_decision_on_a_different_version_than_the_reviewer_saw_is_a_409(
    tenants: Tenants, session: AsyncSession
) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    for action, body in (
        ("approve", {"version": 2}),
        ("reject", {"version": 2, "reason": "No"}),
        ("approve", {"version": 99}),
    ):
        response = await decide(tenants, review_id, action, body)
        assert response.status_code == 409, action
        assert response.json()["error"]["code"] == "stale_review"
    assert (await reload(session, Review, review_id)).status == "pending"
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"
    assert await decision_events(session, review_id) == []


async def test_a_review_is_decided_once(tenants: Tenants, session: AsyncSession) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    assert (await decide(tenants, review_id, "approve", {"version": 1})).status_code == 200
    for action, body in (
        ("approve", {"version": 1}),
        ("reject", {"version": 1, "reason": "Changed my mind"}),
    ):
        again = await decide(tenants, review_id, action, body)
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "review_already_decided"
        assert "approved" in again.json()["error"]["message"]
    assert len(await decision_events(session, review_id)) == 1  # exactly one audit entry
    assert (await reload(session, BrandProfile, profile_id)).state == "published"
    assert (await reload(session, Review, review_id)).status == "approved"


async def test_a_rejected_review_cannot_then_be_approved(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, review_id = await pending_profile(session, tenants.a)
    await decide(tenants, review_id, "reject", {"version": 1, "reason": "No"})
    again = await decide(tenants, review_id, "approve", {"version": 1})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "review_already_decided"
    assert len(await decision_events(session, review_id)) == 1


async def test_an_older_version_cannot_replace_a_newer_one_that_is_live(
    tenants: Tenants, session: AsyncSession
) -> None:
    old_id, review_id = await pending_profile(session, tenants.a, 1)
    newer = await profile(session, tenants.a, 2, "published", tagline="Newer")
    newer_id = newer.id
    await session.commit()
    refused = await decide(tenants, review_id, "approve", {"version": 1})
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "stale_review"
    assert (await reload(session, BrandProfile, newer_id)).state == "published"
    assert (await reload(session, BrandProfile, old_id)).state == "pending_review"
    # Turning it down is still fine.
    assert (
        await decide(tenants, review_id, "reject", {"version": 1, "reason": "Superseded"})
    ).status_code == 200


async def test_a_version_that_is_no_longer_waiting_is_a_409(
    tenants: Tenants, session: AsyncSession
) -> None:
    profile_id, review_id = await pending_profile(session, tenants.a)
    await session.execute(
        update(BrandProfile).where(BrandProfile.id == profile_id).values(state="rejected")
    )
    await session.commit()
    response = await decide(tenants, review_id, "approve", {"version": 1})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "stale_review"
    assert (await reload(session, Review, review_id)).status == "pending"


async def test_an_unknown_review_is_a_404_and_a_bad_request_is_a_422(tenants: Tenants) -> None:
    missing = uuid.uuid4()
    for action, body in (("approve", {"version": 1}), ("reject", {"version": 1, "reason": "x"})):
        response = await decide(tenants, missing, action, body)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "review_not_found"
    assert (await decide(tenants, "not-a-uuid", "approve", {"version": 1})).status_code == 422
    bad_bodies: list[dict[str, Any] | None] = [
        None,
        {},
        {"version": 0},
        {"version": "one"},
        {"version": 1.5},
        {"version": -1},
    ]
    for bad in bad_bodies:
        assert (await decide(tenants, missing, "approve", bad)).status_code == 422, bad


# --- Products ----------------------------------------------------------------------------


async def test_approving_the_first_revision_puts_the_product_live(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, revision_id, review_id = await pending_first_product(session, tenants.a)
    response = await decide(tenants, review_id, "approve", {"version": 1})
    assert response.status_code == 200
    product = await reload(session, Product, product_id)
    assert product.status == "approved"
    assert product.live_revision_id == revision_id and product.pending_revision_id is None
    assert product.version == 1  # it was never live before: the first live content is version 1
    approved = response.json()["events"][-1]
    assert approved["detail"] == {
        "subject": "product",
        "product_id": str(product_id),
        "sku": "NEW-1",
        "revision_id": str(revision_id),
        "version": 1,
        "before": {"status": "pending_review", "product_version": 1, "live_revision_version": None},
        "after": {"status": "approved", "product_version": 1, "live_revision_version": 1},
    }


async def test_approving_an_edit_replaces_the_live_revision_and_raises_the_version(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, first_id, second_id, review_id = await pending_edit(session, tenants.a)
    response = await decide(tenants, review_id, "approve", {"version": 2})
    assert response.status_code == 200
    product = await reload(session, Product, product_id)
    assert (product.status, product.version) == ("approved", 2)
    assert product.live_revision_id == second_id and product.pending_revision_id is None
    assert (await reload(session, ProductRevision, first_id)).version == 1  # history is kept
    detail = response.json()["events"][-1]["detail"]
    assert detail["before"] == {
        "status": "approved",
        "product_version": 1,
        "live_revision_version": 1,
    }
    assert detail["after"] == {
        "status": "approved",
        "product_version": 2,
        "live_revision_version": 2,
    }


async def test_rejecting_the_first_revision_marks_the_product_rejected(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, revision_id, review_id = await pending_first_product(session, tenants.a)
    response = await decide(tenants, review_id, "reject", {"version": 1, "reason": "Blurry photos"})
    assert response.status_code == 200
    product = await reload(session, Product, product_id)
    assert (product.status, product.live_revision_id) == ("rejected", None)
    assert product.pending_revision_id == revision_id  # the vendor still sees what was rejected
    assert response.json()["reason"] == "Blurry photos"
    detail = response.json()["events"][-1]["detail"]
    assert (
        detail["after"]["status"] == "rejected" and detail["after"]["live_revision_version"] is None
    )


async def test_rejecting_an_edit_leaves_the_live_product_live(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, first_id, second_id, review_id = await pending_edit(session, tenants.a)
    response = await decide(tenants, review_id, "reject", {"version": 2, "reason": "Wrong price"})
    assert response.status_code == 200
    product = await reload(session, Product, product_id)
    assert (product.status, product.version) == ("approved", 1)
    assert product.live_revision_id == first_id  # shoppers still see revision 1
    assert product.pending_revision_id == second_id
    detail = response.json()["events"][-1]["detail"]
    assert detail["after"] == {
        "status": "approved",
        "product_version": 1,
        "live_revision_version": 1,
    }


async def test_a_stale_product_decision_is_a_409_and_changes_nothing(
    tenants: Tenants, session: AsyncSession
) -> None:
    product_id, _, review_id = await pending_first_product(session, tenants.a)
    assert (await decide(tenants, review_id, "approve", {"version": 2})).status_code == 409

    await session.execute(update(Product).where(Product.id == product_id).values(status="archived"))
    await session.commit()
    archived = await decide(tenants, review_id, "approve", {"version": 1})
    assert archived.status_code == 409 and archived.json()["error"]["code"] == "stale_review"
    assert "archived" in archived.json()["error"]["message"]

    await session.execute(
        update(Product)
        .where(Product.id == product_id)
        .values(status="draft", pending_revision_id=None)  # the slot moved on
    )
    await session.commit()
    moved = await decide(tenants, review_id, "reject", {"version": 1, "reason": "No"})
    assert moved.status_code == 409 and moved.json()["error"]["code"] == "stale_review"

    review = await reload(session, Review, review_id)
    assert review.status == "pending"
    assert (await reload(session, Product, product_id)).live_revision_id is None
    assert await decision_events(session, review_id) == []


# --- The audit trail and the hook --------------------------------------------------------


async def test_every_decision_writes_exactly_one_event(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, approve_id = await pending_profile(session, tenants.a)
    _, reject_id = await pending_profile(session, tenants.b)
    before = await count_events(session)  # the two submissions
    await decide(tenants, approve_id, "approve", {"version": 1})
    await decide(tenants, reject_id, "reject", {"version": 1, "reason": "No"})
    assert await count_events(session) == before + 2
    for review_id, action in ((approve_id, "approved"), (reject_id, "rejected")):
        events = await events_of(session, review_id)
        assert [e.action for e in events] == ["submitted", action]
        assert events[-1].actor_type == "admin" and events[-1].created_at is not None


async def test_a_refused_decision_leaves_no_event_behind(
    tenants: Tenants, session: AsyncSession
) -> None:
    _, review_id = await pending_profile(session, tenants.a)
    before = await count_events(session)
    for action, body in (
        ("approve", {"version": 7}),
        ("reject", {"version": 1}),  # no reason
        ("reject", {"version": 7, "reason": "No"}),
    ):
        await decide(tenants, review_id, action, body)
    assert await count_events(session) == before


async def test_a_hook_runs_inside_the_decision_and_sees_what_it_did(
    tenants: Tenants, session: AsyncSession
) -> None:
    seen: list[tuple[str, str, str | None]] = []

    async def hook(db: AsyncSession, outcome: Decision) -> None:
        # Inside the transaction: the changes and the audit event are already there.
        status = await db.scalar(select(Review.status).where(Review.id == outcome.review.id))
        events = await db.scalar(
            select(func.count())
            .select_from(ReviewEvent)
            .where(ReviewEvent.review_id == outcome.review.id, ReviewEvent.action == outcome.action)
        )
        assert events == 1
        seen.append((outcome.action, str(status), outcome.detail["after"].get("state")))

    tenants.api.app.state.review_decisions.add_hook(hook)
    _, approve_id = await pending_profile(session, tenants.a)
    _, reject_id = await pending_profile(session, tenants.b)
    await decide(tenants, approve_id, "approve", {"version": 1})
    await decide(tenants, reject_id, "reject", {"version": 1, "reason": "No"})
    assert seen == [("approved", "approved", "published"), ("rejected", "rejected", "rejected")]


async def test_a_hook_that_fails_undoes_the_whole_decision(
    tenants: Tenants, session: AsyncSession
) -> None:
    async def broken(db: AsyncSession, outcome: Decision) -> None:
        raise RuntimeError("the outbox is down")

    tenants.api.app.state.review_decisions.add_hook(broken)
    profile_id, review_id = await pending_profile(session, tenants.a)
    with pytest.raises(RuntimeError, match="outbox"):
        await decide(tenants, review_id, "approve", {"version": 1})
    review = await reload(session, Review, review_id)
    assert (review.status, review.reviewer_id, review.decided_at) == ("pending", None, None)
    assert (await reload(session, BrandProfile, profile_id)).state == "pending_review"
    assert await decision_events(session, review_id) == []


async def test_a_hook_is_told_what_was_published_and_what_it_replaced(
    tenants: Tenants, session: AsyncSession
) -> None:
    told: list[Decision] = []

    async def hook(db: AsyncSession, outcome: Decision) -> None:
        told.append(outcome)

    tenants.api.app.state.review_decisions.add_hook(hook)
    live = await profile(session, tenants.a, 1, "published")
    live_id = live.id
    new_id, review_id = await pending_profile(session, tenants.a, 2)
    await decide(tenants, review_id, "approve", {"version": 2})
    (outcome,) = told
    assert outcome.reviewer_id == ADMIN_ID and outcome.action == "approved"
    assert outcome.brand_profile is not None and outcome.brand_profile.id == new_id
    assert outcome.superseded is not None and outcome.superseded.id == live_id
    assert outcome.product is None
