"""The reviewers' queue as one list (#294): products, brand pages and vendor applications.

Part of the admin group (`/v1/admin/*`, identity-api tokens only, role `vendor_reviewer` or
`super_admin`): the router-level dependency protects every route here. It only reads; each kind
of item is decided on its own route (`/admin/reviews/{id}/approve`, `/admin/vendors/{id}/approve`).
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.admin import reviewer_dependency
from vendor_api.api.auth import no_store
from vendor_api.db.session import get_session
from vendor_api.services.admin_queue import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    MAX_TEXT,
    AdminQueueService,
    QueuePage,
)

router = APIRouter(
    prefix="/admin/queue", tags=["admin-queue"], dependencies=[Depends(reviewer_dependency)]
)

Db = Annotated[AsyncSession, Depends(get_session)]


def get_admin_queue(request: Request) -> AdminQueueService:
    return cast(AdminQueueService, request.app.state.admin_queue)


Queue = Annotated[AdminQueueService, Depends(get_admin_queue)]


class QueueVendorOut(BaseModel):
    id: uuid.UUID
    name: str


class QueueCountsOut(BaseModel):
    all: int
    product: int
    brand_page: int
    application: int


class QueueItemOut(BaseModel):
    # A review's id (product, brand page) or the vendor's id (application).
    id: uuid.UUID
    kind: Literal["product", "brand_page", "application"]
    # The product's id, or the vendor's id for a brand page and an application.
    subject_id: uuid.UUID
    title: str
    # The short second line: the SKU, "First brand page" / "Edit to a live page", or the vendor
    # application's product type.
    detail: str
    vendor: QueueVendorOut
    submitted_at: datetime
    change: Literal["new", "edit", "application"]
    # How many reviews of the same subject were rejected before this one (0 for a first
    # submission, and always 0 for an application).
    resubmission: int
    # A product's first photo, a brand page's banner (else logo); null for an application.
    thumbnail_url: str | None


class QueuePageOut(BaseModel):
    items: list[QueueItemOut]
    # How many items match the filters.
    total: int
    limit: int
    offset: int
    # The whole waiting queue by kind and every vendor with something waiting: neither follows
    # the filters, so the tabs and the vendor filter keep every choice.
    counts: QueueCountsOut
    vendors: list[QueueVendorOut]


def page_out(page: QueuePage) -> QueuePageOut:
    return QueuePageOut(
        items=[
            QueueItemOut(
                id=i.id,
                kind=i.kind,
                subject_id=i.subject_id,
                title=i.title,
                detail=i.detail,
                vendor=QueueVendorOut(id=i.vendor.id, name=i.vendor.name),
                submitted_at=i.submitted_at,
                change=i.change,
                resubmission=i.resubmission,
                thumbnail_url=i.thumbnail_url,
            )
            for i in page.items
        ],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
        counts=QueueCountsOut(**page.counts),
        vendors=[QueueVendorOut(id=v.id, name=v.name) for v in page.vendors],
    )


@router.get("")
async def list_queue(
    response: Response,
    db: Db,
    queue: Queue,
    kind: Annotated[
        Literal["product", "brand_page", "application"] | None,
        Query(description="Only this kind of item"),
    ] = None,
    vendor_id: Annotated[
        uuid.UUID | None, Query(alias="vendor", description="Only this vendor's items")
    ] = None,
    q: Annotated[
        str | None,
        Query(
            max_length=MAX_TEXT,
            description="Text in the title, the detail or the vendor name, ignoring case",
        ),
    ] = None,
    submitted: Annotated[
        Literal["today", "24h", "older"] | None,
        Query(
            description="How long ago: `today` is under 24 hours, `24h` is 24 to 48 hours, "
            "`older` is 48 hours or more"
        ),
    ] = None,
    resubmissions: Annotated[
        bool, Query(description="`true`: only what was sent back before")
    ] = False,
    sort: Annotated[
        Literal["oldest", "newest"], Query(description="`oldest` (default) or `newest` first")
    ] = "oldest",
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> QueuePageOut:
    """Everything waiting for a reviewer in one list: products and brand pages under review and
    vendor applications. Filtered, sorted and paged on the server."""
    no_store(response)
    page = await queue.list_queue(
        db,
        kind=kind,
        vendor_id=vendor_id,
        text=(q or "").strip() or None,
        submitted=submitted,
        resubmissions=resubmissions,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return page_out(page)
