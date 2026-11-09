import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from factories import (
    make_event,
    make_review,
    saved_profile,
    saved_review,
    saved_user,
    saved_vendor,
    submittable_revision,
)
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import BrandProfile, Review, ReviewEvent, ReviewStatus

EARLIER = datetime(2000, 1, 1, tzinfo=UTC)  # before any row's `submitted_at` (now)
LATER = datetime(2099, 1, 1, tzinfo=UTC)
ADMIN = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


async def setup_vendor(session: AsyncSession, name: str = "first") -> tuple[Any, Any]:
    vendor = await saved_vendor(session, slug=name, email=f"owner@{name}.test")
    return vendor, await saved_user(session, vendor, email=f"asha@{name}.test")


async def submitted_profile(session: AsyncSession, vendor: Any, version: int = 1) -> BrandProfile:
    return await saved_profile(
        session,
        vendor,
        version=version,
        state="pending_review",
        categories=["dresses"],
        submitted_at=datetime(2026, 11, 8, tzinfo=UTC),
    )


async def pending_profile_review(
    session: AsyncSession, vendor: Any, user: Any, version: int = 1
) -> tuple[BrandProfile, Review]:
    profile = await submitted_profile(session, vendor, version)
    return profile, await saved_review(session, vendor, user, profile=profile)


# --- A pending review --------------------------------------------------------------------


async def test_review_defaults(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    profile, review = await pending_profile_review(session, vendor, user)
    await session.refresh(review)
    assert isinstance(review.id, uuid.UUID)
    assert review.subject == "brand_profile"
    assert review.brand_profile_id == profile.id
    assert review.product_revision_id is None
    assert review.status == ReviewStatus.PENDING
    assert review.submitted_by == user.id
    assert review.submitted_at is not None
    assert (review.reviewer_id, review.decided_at, review.reason) == (None, None, None)
    assert review.created_at is not None
    assert review.updated_at is not None


async def test_a_product_revision_can_be_reviewed(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, revision = await submittable_revision(session, vendor, user)
    review = await saved_review(session, vendor, user, revision=revision)
    assert review.subject == "product"
    assert review.product_revision_id == revision.id
    assert review.brand_profile_id is None


async def test_the_version_reviewed_is_the_versions_own_row(session: AsyncSession) -> None:
    """A review names one exact version row, so a later edit cannot change what was reviewed."""
    vendor, user = await setup_vendor(session)
    await pending_profile_review(session, vendor, user, version=3)
    version = await session.scalar(
        select(BrandProfile.version).join(Review, Review.brand_profile_id == BrandProfile.id)
    )
    assert version == 3


# --- Subjects ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "case", ["none", "both", "product_with_a_profile", "profile_with_a_revision"]
)
async def test_a_review_needs_exactly_one_subject_of_the_named_kind(
    session: AsyncSession, case: str
) -> None:
    vendor, user = await setup_vendor(session)
    profile = await submitted_profile(session, vendor)
    _, revision = await submittable_revision(session, vendor, user)
    cases: dict[str, dict[str, Any]] = {
        "none": {"subject": "brand_profile"},
        "both": {
            "subject": "brand_profile",
            "brand_profile_id": profile.id,
            "product_revision_id": revision.id,
        },
        "product_with_a_profile": {"subject": "product", "brand_profile_id": profile.id},
        "profile_with_a_revision": {"subject": "brand_profile", "product_revision_id": revision.id},
    }
    session.add(make_review(vendor, user, **cases[case]))
    with pytest.raises(IntegrityError, match="ck_reviews_one_subject"):
        await session.flush()


async def test_an_unknown_subject_is_refused(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    profile = await submitted_profile(session, vendor)
    session.add(make_review(vendor, user, subject="page", brand_profile_id=profile.id))
    with pytest.raises(IntegrityError, match="ck_reviews_(one_subject|subject_values)"):
        await session.flush()


async def test_an_unknown_status_is_refused(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    profile = await submitted_profile(session, vendor)
    session.add(make_review(vendor, user, profile=profile, status="cancelled"))
    with pytest.raises(IntegrityError, match="ck_reviews_status_values"):
        await session.flush()


async def test_a_review_cannot_name_another_vendors_brand_profile(
    session: AsyncSession,
) -> None:
    first, first_user = await setup_vendor(session, "first")
    second, _ = await setup_vendor(session, "second")
    profile = await submitted_profile(session, second)
    session.add(make_review(first, first_user, profile=profile))
    with pytest.raises(IntegrityError, match="fk_reviews_brand_profile_id_brand_profiles"):
        await session.flush()


async def test_a_review_cannot_name_another_vendors_product_revision(
    session: AsyncSession,
) -> None:
    first, first_user = await setup_vendor(session, "first")
    second, second_user = await setup_vendor(session, "second")
    _, revision = await submittable_revision(session, second, second_user)
    session.add(make_review(first, first_user, revision=revision))
    with pytest.raises(IntegrityError, match="fk_reviews_product_revision_id_product_revisions"):
        await session.flush()


async def test_a_review_cannot_name_a_version_that_does_not_exist(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    session.add(make_review(vendor, user, subject="brand_profile", brand_profile_id=uuid.uuid4()))
    with pytest.raises(IntegrityError, match="fk_reviews_brand_profile_id_brand_profiles"):
        await session.flush()


async def test_a_reviewed_version_cannot_be_deleted(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    profile, _ = await pending_profile_review(session, vendor, user)
    with pytest.raises(IntegrityError, match="fk_reviews_brand_profile_id_brand_profiles"):
        await session.execute(text("DELETE FROM brand_profiles WHERE id = :id"), {"id": profile.id})


async def test_a_reviewed_revision_cannot_be_deleted(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, revision = await submittable_revision(session, vendor, user)
    await saved_review(session, vendor, user, revision=revision)
    with pytest.raises(IntegrityError, match="fk_reviews_product_revision_id_product_revisions"):
        await session.execute(
            text("DELETE FROM product_revisions WHERE id = :id"), {"id": revision.id}
        )


# --- Decisions ---------------------------------------------------------------------------


async def decide(session: AsyncSession, review: Review, **values: Any) -> None:
    await session.execute(update(Review).where(Review.id == review.id).values(**values))


async def test_an_approval_names_the_admin_and_the_time(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    await decide(session, review, status="approved", reviewer_id=ADMIN, decided_at=LATER)
    stored = (await session.scalars(select(Review).execution_options(populate_existing=True))).one()
    assert (stored.status, stored.reviewer_id, stored.decided_at) == ("approved", ADMIN, LATER)


async def test_a_rejection_with_a_reason_is_accepted(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    await decide(
        session,
        review,
        status="rejected",
        reviewer_id=ADMIN,
        decided_at=LATER,
        reason="The logo is blurry",
    )


@pytest.mark.parametrize("reason", [None, "", "   ", "\n\t"])
async def test_a_rejection_needs_a_reason(session: AsyncSession, reason: str | None) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    with pytest.raises(IntegrityError, match="ck_reviews_rejected_needs_reason"):
        await decide(
            session, review, status="rejected", reviewer_id=ADMIN, decided_at=LATER, reason=reason
        )


@pytest.mark.parametrize("status", ["approved", "rejected"])
@pytest.mark.parametrize("missing", ["reviewer_id", "decided_at"])
async def test_a_decision_needs_a_reviewer_and_a_time(
    session: AsyncSession, status: str, missing: str
) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    values: dict[str, Any] = {
        "status": status,
        "reviewer_id": ADMIN,
        "decided_at": LATER,
        "reason": "because",
    }
    values[missing] = None
    with pytest.raises(IntegrityError, match="ck_reviews_decision_needs_reviewer"):
        await decide(session, review, **values)


async def test_a_decision_cannot_come_before_the_submission(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    with pytest.raises(IntegrityError, match="ck_reviews_decided_after"):
        await decide(session, review, status="approved", reviewer_id=ADMIN, decided_at=EARLIER)


async def test_a_withdrawal_is_the_vendors_and_has_a_time(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    await decide(session, review, status="withdrawn", decided_at=LATER)


@pytest.mark.parametrize(
    "values",
    [
        {"status": "withdrawn", "decided_at": LATER, "reviewer_id": ADMIN},
        {"status": "withdrawn", "decided_at": None},
    ],
    ids=["with-a-reviewer", "without-a-time"],
)
async def test_a_withdrawal_has_no_reviewer_but_a_time(
    session: AsyncSession, values: dict[str, Any]
) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    with pytest.raises(IntegrityError, match="ck_reviews_withdrawn_shape"):
        await decide(session, review, **values)


@pytest.mark.parametrize("values", [{"reviewer_id": ADMIN}, {"decided_at": LATER}])
async def test_a_pending_review_has_no_decision_yet(
    session: AsyncSession, values: dict[str, Any]
) -> None:
    vendor, user = await setup_vendor(session)
    profile = await submitted_profile(session, vendor)
    session.add(make_review(vendor, user, profile=profile, **values))
    with pytest.raises(IntegrityError, match="ck_reviews_pending_shape"):
        await session.flush()


async def test_the_reviewer_is_not_a_foreign_key(session: AsyncSession) -> None:
    """The admin lives in identity-api's database: only the id is stored."""
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    await decide(session, review, status="approved", reviewer_id=uuid.uuid4(), decided_at=LATER)


# --- At most one pending review per version ----------------------------------------------


async def test_a_second_pending_review_of_a_brand_profile_version_is_refused(
    session: AsyncSession,
) -> None:
    vendor, user = await setup_vendor(session)
    profile, _ = await pending_profile_review(session, vendor, user)
    session.add(make_review(vendor, user, profile=profile))
    with pytest.raises(IntegrityError, match="uq_reviews_one_pending_per_brand_profile"):
        await session.flush()


async def test_a_second_pending_review_of_a_revision_is_refused(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, revision = await submittable_revision(session, vendor, user)
    await saved_review(session, vendor, user, revision=revision)
    session.add(make_review(vendor, user, revision=revision))
    with pytest.raises(IntegrityError, match="uq_reviews_one_pending_per_product_revision"):
        await session.flush()


@pytest.mark.parametrize(
    "outcome",
    [
        {"status": "approved", "reviewer_id": ADMIN, "decided_at": LATER},
        {"status": "rejected", "reviewer_id": ADMIN, "decided_at": LATER, "reason": "no"},
        {"status": "withdrawn", "decided_at": LATER},
    ],
    ids=["approved", "rejected", "withdrawn"],
)
async def test_a_decided_version_can_be_reviewed_again(
    session: AsyncSession, outcome: dict[str, Any]
) -> None:
    vendor, user = await setup_vendor(session)
    profile, first = await pending_profile_review(session, vendor, user)
    await decide(session, first, **outcome)
    await saved_review(session, vendor, user, profile=profile)  # a new pending one


async def test_each_version_can_have_its_own_pending_review(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    await pending_profile_review(session, vendor, user, version=1)
    await pending_profile_review(session, vendor, user, version=2)
    _, revision = await submittable_revision(session, vendor, user)
    await saved_review(session, vendor, user, revision=revision)
    assert len((await session.scalars(select(Review))).all()) == 3


async def test_two_vendors_each_have_their_own_pending_review(session: AsyncSession) -> None:
    first, first_user = await setup_vendor(session, "first")
    second, second_user = await setup_vendor(session, "second")
    await pending_profile_review(session, first, first_user)
    await pending_profile_review(session, second, second_user)


async def test_a_decided_review_cannot_be_reopened(session: AsyncSession) -> None:
    # Was "reopening cannot create a second pending review" (the partial unique index).
    # Migration 0006 freezes a decided review, so reopening the row is refused outright; the
    # version is reviewed again with a new row instead.
    vendor, user = await setup_vendor(session)
    profile, first = await pending_profile_review(session, vendor, user)
    await decide(session, first, status="withdrawn", decided_at=LATER)
    await saved_review(session, vendor, user, profile=profile)
    with pytest.raises(IntegrityError, match="a decided review cannot be changed"):
        await decide(session, first, status="pending", decided_at=None, reviewer_id=None)


# --- Indexes -----------------------------------------------------------------------------


async def test_the_queue_indexes_exist(session: AsyncSession) -> None:
    rows = await session.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'reviews'")
    )
    definitions = {str(row[0]): str(row[1]) for row in rows}
    pending = definitions["ix_reviews_pending_submitted_at"]
    assert "(submitted_at)" in pending
    assert "status" in pending.split("WHERE")[1]
    assert "(vendor_id, status)" in definitions["ix_reviews_vendor_id_status"]
    assert "(status, submitted_at)" in definitions["ix_reviews_status_submitted_at"]


# --- The audit trail ---------------------------------------------------------------------


async def test_events_record_each_step(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    session.add_all(
        [
            make_event(review),
            make_event(review, action="approved", actor_type="admin", actor_id=ADMIN),
            make_event(
                review, action="rejected", actor_type="admin", actor_id=ADMIN, reason="blurry"
            ),
            make_event(review, action="withdrawn"),
            make_event(review, action="reopened", actor_type="system", actor_id=None),
        ]
    )
    await session.flush()
    events = (await session.scalars(select(ReviewEvent).order_by(ReviewEvent.id))).all()
    assert [event.action for event in events] == [
        "submitted",
        "approved",
        "rejected",
        "withdrawn",
        "reopened",
    ]
    assert events[0].id < events[-1].id
    assert all(event.created_at is not None for event in events)


@pytest.mark.parametrize("actor_type", ["admin", "vendor"])
async def test_an_event_by_a_person_names_them(session: AsyncSession, actor_type: str) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    session.add(make_event(review, actor_type=actor_type, actor_id=None))
    with pytest.raises(IntegrityError, match="ck_review_events_actor_id_required"):
        await session.flush()


async def test_a_rejection_event_needs_a_reason(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    session.add(
        make_event(review, action="rejected", actor_type="admin", actor_id=ADMIN, reason=" ")
    )
    with pytest.raises(IntegrityError, match="ck_review_events_rejected_needs_reason"):
        await session.flush()


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"action": "deleted"}, "action_values"),
        ({"actor_type": "robot"}, "actor_type_values"),
    ],
)
async def test_unknown_actions_and_actors_are_refused(
    session: AsyncSession, changes: dict[str, str], constraint: str
) -> None:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    session.add(make_event(review, **changes))
    with pytest.raises(IntegrityError, match=f"ck_review_events_{constraint}"):
        await session.flush()


async def test_an_event_needs_an_existing_review(session: AsyncSession) -> None:
    session.add(ReviewEvent(review_id=uuid.uuid4(), action="submitted", actor_type="system"))
    with pytest.raises(IntegrityError, match="fk_review_events_review_id_reviews"):
        await session.flush()


async def event_for_a_review(session: AsyncSession) -> tuple[Review, ReviewEvent]:
    vendor, user = await setup_vendor(session)
    _, review = await pending_profile_review(session, vendor, user)
    event = make_event(review)
    session.add(event)
    await session.flush()
    return review, event


async def test_an_event_cannot_be_updated(session: AsyncSession) -> None:
    _, event = await event_for_a_review(session)
    with pytest.raises(IntegrityError, match="review_events is append-only"):
        await session.execute(
            text("UPDATE review_events SET reason = 'edited' WHERE id = :id"), {"id": event.id}
        )


async def test_an_event_cannot_be_updated_through_the_orm(session: AsyncSession) -> None:
    _, event = await event_for_a_review(session)
    event.reason = "edited later"
    with pytest.raises(IntegrityError, match="review_events is append-only"):
        await session.flush()


async def test_an_event_cannot_be_deleted(session: AsyncSession) -> None:
    _, event = await event_for_a_review(session)
    with pytest.raises(IntegrityError, match="review_events is append-only"):
        await session.execute(text("DELETE FROM review_events WHERE id = :id"), {"id": event.id})


async def test_the_trail_cannot_be_truncated(session: AsyncSession) -> None:
    await event_for_a_review(session)
    with pytest.raises(IntegrityError, match="review_events is append-only"):
        await session.execute(text("TRUNCATE review_events"))


async def test_every_event_stays_after_all_the_attempts(session: AsyncSession) -> None:
    _, event = await event_for_a_review(session)
    for statement in (
        "UPDATE review_events SET action = 'approved'",
        "DELETE FROM review_events",
        "TRUNCATE review_events",
    ):
        # The savepoint is rolled back by the error leaving it, so the next try can run.
        with pytest.raises(IntegrityError, match="append-only"):
            async with session.begin_nested():
                await session.execute(text(statement))
    assert (await session.scalars(select(ReviewEvent.id))).all() == [event.id]


async def test_a_review_with_events_cannot_be_deleted(session: AsyncSession) -> None:
    review, _ = await event_for_a_review(session)
    # Migration 0006 refuses every review DELETE before the foreign key is even checked.
    with pytest.raises(IntegrityError, match="reviews cannot be deleted"):
        await session.execute(text("DELETE FROM reviews WHERE id = :id"), {"id": review.id})


async def test_a_vendor_with_reviews_cannot_be_deleted(session: AsyncSession) -> None:
    vendor, user = await setup_vendor(session)
    await pending_profile_review(session, vendor, user)
    with pytest.raises(IntegrityError, match="violates foreign key"):
        await session.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor.id})
