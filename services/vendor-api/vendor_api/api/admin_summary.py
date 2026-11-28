"""The figures on the admins' home: what waits, what was decided, how publishing is doing (#299).

Part of the admin group (`/v1/admin/*`, identity-api tokens only, role `vendor_reviewer` or
`super_admin`): the router-level dependency protects it. Read only, and the same for every
reviewer. A decision names its admin by identity-api id; the shell asks identity-api
(`GET /v1/admins/names`) for the names.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.admin import reviewer_dependency
from vendor_api.api.common import no_store
from vendor_api.db.session import get_session
from vendor_api.services.admin_summary import AdminSummary, AdminSummaryService, RecentDecision

router = APIRouter(
    prefix="/admin/summary", tags=["admin-summary"], dependencies=[Depends(reviewer_dependency)]
)

Db = Annotated[AsyncSession, Depends(get_session)]


def get_admin_summary(request: Request) -> AdminSummaryService:
    return cast(AdminSummaryService, request.app.state.admin_summary)


Summarizer = Annotated[AdminSummaryService, Depends(get_admin_summary)]


class WaitingOut(BaseModel):
    product: int
    brand_page: int
    application: int
    # Waiting more than 24 hours, of all three kinds.
    over_24h: int


class DecisionsOut(BaseModel):
    # Approved or sent back since midnight IST.
    decided_today: int
    # Median minutes from submission to decision over those; None when there were none.
    median_minutes: int | None


class PublishingOut(BaseModel):
    delivered_24h: int
    # Not tried yet.
    waiting: int
    # Failed, and will be tried again.
    retrying: int
    # Gave up: needs a person.
    failed: int


class RecentDecisionOut(BaseModel):
    id: str
    kind: Literal["product", "brand_page", "application", "commission"]
    # The review to open for a product or brand page; None for the other kinds.
    review_id: uuid.UUID | None
    # The product's id for a product, the vendor's id for everything else.
    subject_id: uuid.UUID
    title: str
    vendor_id: uuid.UUID
    vendor_name: str
    decision: Literal["approved", "rejected"]
    at: datetime
    # The deciding admin's identity-api id; None only if it was never recorded.
    reviewer_id: uuid.UUID | None


class AdminSummaryOut(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "waiting": {"product": 4, "brand_page": 1, "application": 2, "over_24h": 3},
                    "decisions": {"decided_today": 6, "median_minutes": 95},
                    "resubmissions": 2,
                    "commission_proposals": 1,
                    "publishing": {"delivered_24h": 38, "waiting": 2, "retrying": 1, "failed": 0},
                    "recent": [
                        {
                            "id": "6f1d2c3b-4a59-4c7e-8b10-2d3e4f5a6b7c",
                            "kind": "product",
                            "review_id": "6f1d2c3b-4a59-4c7e-8b10-2d3e4f5a6b7c",
                            "subject_id": "9b1c2d3e-4f50-4a61-8b72-c3d4e5f60718",
                            "title": "Block-print cotton kurta",
                            "vendor_id": "3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10",
                            "vendor_name": "Jaipur Prints",
                            "decision": "approved",
                            "at": "2026-11-10T09:30:00Z",
                            "reviewer_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                        }
                    ],
                }
            ]
        }
    )

    waiting: WaitingOut
    decisions: DecisionsOut
    # Waiting reviews of a second or later version.
    resubmissions: int
    # Vendors whose proposed commission waits for Shazlo.
    commission_proposals: int
    publishing: PublishingOut
    # The latest few decisions (reviews, applications, commission), newest first.
    recent: list[RecentDecisionOut]


def _recent(decision: RecentDecision) -> RecentDecisionOut:
    return RecentDecisionOut(
        id=decision.id,
        kind=decision.kind,
        review_id=decision.review_id,
        subject_id=decision.subject_id,
        title=decision.title,
        vendor_id=decision.vendor_id,
        vendor_name=decision.vendor_name,
        decision=decision.decision,
        at=decision.at,
        reviewer_id=decision.reviewer_id,
    )


def summary_out(found: AdminSummary) -> AdminSummaryOut:
    return AdminSummaryOut(
        waiting=WaitingOut(
            product=found.waiting_product,
            brand_page=found.waiting_brand_page,
            application=found.waiting_application,
            over_24h=found.over_24h,
        ),
        decisions=DecisionsOut(
            decided_today=found.decided_today, median_minutes=found.median_minutes
        ),
        resubmissions=found.resubmissions,
        commission_proposals=found.commission_proposals,
        publishing=PublishingOut(
            delivered_24h=found.delivered_24h,
            waiting=found.publishing_waiting,
            retrying=found.publishing_retrying,
            failed=found.publishing_failed,
        ),
        recent=[_recent(d) for d in found.recent],
    )


@router.get("")
async def get_summary(response: Response, db: Db, summarizer: Summarizer) -> AdminSummaryOut:
    """What waits for a reviewer, what was decided today (midnight IST), the outbox in four
    numbers, and the latest decisions. Every figure is a count, so the cost does not grow with
    the queue."""
    no_store(response)
    return summary_out(await summarizer.summary(db))
