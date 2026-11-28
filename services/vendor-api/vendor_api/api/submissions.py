import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import Scope
from vendor_api.db.models import ReviewStatus, ReviewSubject
from vendor_api.db.session import get_session
from vendor_api.services.submissions import MAX_PAGE_SIZE, SubmissionService

router = APIRouter(prefix="/vendor/submissions", tags=["submissions"])

Db = Annotated[AsyncSession, Depends(get_session)]


def get_submissions(request: Request) -> SubmissionService:
    return cast(SubmissionService, request.app.state.submissions)


Submissions = Annotated[SubmissionService, Depends(get_submissions)]


class SubmissionOut(BaseModel):
    """One review of something the vendor submitted. There is no reviewer in it: who decided
    is private to the admins."""

    subject: Literal["brand_profile", "product"]
    # The brand page's id, or the product's id.
    id: uuid.UUID
    # Only for a product.
    sku: str | None
    title: str | None
    version: int
    status: Literal["pending", "approved", "rejected", "withdrawn"]
    reason: str | None
    # The kind of problem the reviewer picked, if any.
    reason_code: str | None
    submitted_at: datetime
    decided_at: datetime | None


class SubmissionPageOut(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "items": [
                        {
                            "subject": "product",
                            "id": "3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c",
                            "sku": "KRT-001",
                            "title": "Indigo block-print kurta",
                            "version": 2,
                            "status": "rejected",
                            "reason": "The photos are too dark to see the print.",
                            "reason_code": "photos",
                            "submitted_at": "2026-11-10T09:30:00Z",
                            "decided_at": "2026-11-11T12:00:00Z",
                        },
                        {
                            "subject": "brand_profile",
                            "id": "7a1c2d3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d",
                            "sku": None,
                            "title": None,
                            "version": 3,
                            "status": "pending",
                            "reason": None,
                            "reason_code": None,
                            "submitted_at": "2026-11-09T08:00:00Z",
                            "decided_at": None,
                        },
                    ],
                    "total": 2,
                    "limit": 25,
                    "offset": 0,
                }
            ]
        }
    )

    items: list[SubmissionOut]
    total: int
    limit: int
    offset: int


@router.get("")
async def list_submissions(
    response: Response,
    db: Db,
    submissions: Submissions,
    scope: Scope,
    status: Annotated[
        Literal["pending", "approved", "rejected", "withdrawn", "all"],
        Query(description="Only reviews in this status; `all` (the default) lists every one."),
    ] = "all",
    subject: Annotated[
        Literal["brand_profile", "product"] | None,
        Query(description="Only the brand page's reviews, or only the products'."),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> SubmissionPageOut:
    """Everything the vendor submitted for review and what came of it, newest first. A rejected
    version carries the admin's reason. Any active user of the vendor can read it."""
    no_store(response)
    page = await submissions.list_submissions(
        db,
        scope.vendor_id,
        status=None if status == "all" else ReviewStatus(status),
        subject=ReviewSubject(subject) if subject else None,
        limit=limit,
        offset=offset,
    )
    return SubmissionPageOut.model_validate(
        {
            "items": [
                {
                    "subject": item.subject.value,
                    "id": item.item_id,
                    "sku": item.sku,
                    "title": item.title,
                    "version": item.version,
                    "status": item.status,
                    "reason": item.reason,
                    "reason_code": item.reason_code,
                    "submitted_at": item.submitted_at,
                    "decided_at": item.decided_at,
                }
                for item in page.items
            ],
            "total": page.total,
            "limit": page.limit,
            "offset": page.offset,
        }
    )
