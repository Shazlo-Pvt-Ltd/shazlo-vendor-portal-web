"""The review queue for reviewers: what is waiting, and what exactly changed.

Part of the admin group (`/v1/admin/*`, identity-api tokens only, role `vendor_reviewer` or
`super_admin`): the router-level dependency in `api/admin.py` protects every route here. Reviewers
see every vendor's submissions, so there is no vendor scoping. These endpoints only read.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.admin import reviewer_dependency
from vendor_api.api.auth import no_store
from vendor_api.db.models import Review, ReviewEvent, ReviewStatus, ReviewSubject
from vendor_api.db.session import get_session
from vendor_api.services.review_queue import (
    MAX_PAGE_SIZE,
    ReviewDetail,
    ReviewQueueService,
    ReviewRow,
    Version,
)

router = APIRouter(
    prefix="/admin/reviews", tags=["admin-reviews"], dependencies=[Depends(reviewer_dependency)]
)

Db = Annotated[AsyncSession, Depends(get_session)]


def get_review_queue(request: Request) -> ReviewQueueService:
    return cast(ReviewQueueService, request.app.state.review_queue)


Queue = Annotated[ReviewQueueService, Depends(get_review_queue)]


class VendorOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str


class ReviewOut(BaseModel):
    id: uuid.UUID
    subject: str
    status: str
    vendor: VendorOut
    submitted_by: uuid.UUID
    submitted_by_email: str
    submitted_at: datetime
    # The version under review: a brand profile version, or a product revision.
    version: int
    # The brand name, or the product title.
    title: str
    product_id: uuid.UUID | None
    sku: str | None
    # Set once decided.
    reviewer_id: uuid.UUID | None
    decided_at: datetime | None
    reason: str | None


class ReviewPageOut(BaseModel):
    items: list[ReviewOut]
    total: int
    limit: int
    offset: int


class EventOut(BaseModel):
    action: str
    actor_type: str
    actor_id: uuid.UUID | None
    reason: str | None
    created_at: datetime


class ChangeOut(BaseModel):
    # A field of the content (`tagline`, `categories`, `logo`, ...). For a product also
    # `variants[<sku>]` (a whole variant added or removed), `variants[<sku>].<field>` and
    # `images[<position>]`.
    field: str
    before: Any
    after: Any


class VersionOut(BaseModel):
    version: int
    published_at: datetime | None
    content: dict[str, Any]


class ReviewDetailOut(ReviewOut):
    events: list[EventOut]
    # The version under review, in full.
    content: VersionOut
    # What it is compared with: the last version that went live before it (null for a first
    # submission, when every field with a value is a change).
    base: VersionOut | None
    # Exactly the fields that differ between `base` and `content`; unchanged fields are absent.
    changes: list[ChangeOut]


def review_out(row: ReviewRow) -> dict[str, Any]:
    review: Review = row.review
    return {
        "id": review.id,
        "subject": review.subject,
        "status": review.status,
        "vendor": VendorOut(
            id=review.vendor_id,
            name=row.vendor_name,
            slug=row.vendor_slug,
            status=row.vendor_status,
        ),
        "submitted_by": review.submitted_by,
        "submitted_by_email": row.submitted_by_email,
        "submitted_at": review.submitted_at,
        "version": row.version,
        "title": row.title,
        "product_id": row.product_id,
        "sku": row.sku,
        "reviewer_id": review.reviewer_id,
        "decided_at": review.decided_at,
        "reason": review.reason,
    }


def _version(version: Version) -> VersionOut:
    return VersionOut(
        version=version.version, published_at=version.published_at, content=version.content
    )


def _event(event: ReviewEvent) -> EventOut:
    return EventOut(
        action=event.action,
        actor_type=event.actor_type,
        actor_id=event.actor_id,
        reason=event.reason,
        created_at=event.created_at,
    )


def detail_out(detail: ReviewDetail) -> ReviewDetailOut:
    return ReviewDetailOut(
        **review_out(detail.row),
        events=[_event(e) for e in detail.events],
        content=_version(detail.content),
        base=_version(detail.base) if detail.base is not None else None,
        changes=[ChangeOut(field=c.field, before=c.before, after=c.after) for c in detail.changes],
    )


@router.get("")
async def list_reviews(
    response: Response,
    db: Db,
    queue: Queue,
    status: Annotated[
        Literal["pending", "approved", "rejected", "withdrawn", "all"],
        Query(description="`pending` (default), `approved`, `rejected`, `withdrawn` or `all`"),
    ] = "pending",
    subject: Annotated[ReviewSubject | None, Query()] = None,
    vendor_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> ReviewPageOut:
    """The queue: what vendors have submitted, filterable and paged. Pending reviews come oldest
    first, so the one that has waited longest is on top; other statuses come newest first."""
    no_store(response)
    page = await queue.list_reviews(
        db,
        status=None if status == "all" else ReviewStatus(status),
        subject=subject,
        vendor_id=vendor_id,
        limit=limit,
        offset=offset,
    )
    return ReviewPageOut(
        items=[ReviewOut(**review_out(row)) for row in page.items],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{review_id}")
async def get_review(
    review_id: uuid.UUID, response: Response, db: Db, queue: Queue
) -> ReviewDetailOut:
    """One review with the version under review, the version it is compared with, **the fields
    that changed**, and its audit trail."""
    no_store(response)
    return detail_out(await queue.get_review(db, review_id))
