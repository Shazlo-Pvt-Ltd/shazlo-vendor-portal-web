"""The Vendors module's summary for Shazlo One, in the shell's shared shape (ADR 0011).

Shazlo One draws every module's sidebar badge and Home cards from one shape (`ModuleSummary`,
`packages/shell-protocol/src/summary.ts`) and knows nothing about vendors. This route says what the
Vendors module wants shown there: its words, its figures and links to its own pages (paths inside
the module, which the shell puts under the module's base path). The figures are the ones
`GET /v1/admin/summary` counts (#299), from the same service; that route stays for the module.

Part of the admin group (`/v1/admin/*`, identity-api tokens only, role `vendor_reviewer` or
`super_admin`). Activity names its admins by identity-api id; the shell asks identity-api for
the names.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from vendor_api.api.admin import reviewer_dependency
from vendor_api.api.admin_summary import Db, Summarizer
from vendor_api.api.common import no_store
from vendor_api.services.admin_summary import AdminSummary, RecentDecision

router = APIRouter(
    prefix="/admin/module-summary",
    tags=["admin-summary"],
    dependencies=[Depends(reviewer_dependency)],
)

# Pages of the Vendors module (apps/vendor-admin), as the shell links to them.
QUEUE = "/queue"
QUEUE_OLDEST = "/queue?sort=oldest"
PUBLISHING = "/publishing"


def publishing_status(status: str) -> str:
    return f"{PUBLISHING}?status={status}"


def brand_review(vendor_id: uuid.UUID) -> str:
    return f"/review/brand/{vendor_id}"


def vendor_page(vendor_id: uuid.UUID) -> str:
    return f"/vendors/{vendor_id}"


KIND_LABELS = {
    "product": "Product",
    "brand_page": "Brand page",
    "application": "Application",
    "commission": "Commission",
}


def plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


# The shell's limits for an activity item's lines (summary.ts). A vendor's name may be 200
# characters, so "Commission: <name>" or "<name> · Application" can pass them; the shell refuses
# the whole summary for one line too long, so a long line is cut here instead.
MAX_ACTIVITY_TEXT = 200


def js_length(value: str) -> int:
    """The length JavaScript (and so the shell's schema) counts: UTF-16 code units, so an emoji
    counts two."""
    return len(value.encode("utf-16-le")) // 2


def clip(value: str, limit: int = MAX_ACTIVITY_TEXT) -> str:
    """`value`, cut to `limit` characters as JavaScript counts them, with an ellipsis when it is
    longer."""
    value = value.strip()
    if js_length(value) <= limit:
        return value
    cut = value[: limit - 1]
    while js_length(cut) > limit - 1:
        cut = cut[:-1]
    return cut.rstrip() + "…"


class SummaryLinkOut(BaseModel):
    label: str
    # A path inside the module ("/queue"); the shell adds the module's base path.
    path: str


class SummaryFigureOut(BaseModel):
    label: str
    # None when there is nothing to measure (no decisions today, so no median): the shell shows a
    # dash rather than a 0.
    value: int | None
    unit: Literal["count", "minutes"] = "count"
    hint: str | None = None
    path: str | None = None


class SummaryAlertOut(BaseModel):
    tone: Literal["warning", "error"]
    text: str
    action: SummaryLinkOut | None = None


class SummarySectionOut(BaseModel):
    title: str
    # A name from the shell's icon list (MODULE_ICONS); an unknown one shows as a box.
    icon: str | None = None
    action: SummaryLinkOut | None = None
    alert: SummaryAlertOut | None = None
    figures: list[SummaryFigureOut]


class SummaryBadgeOut(BaseModel):
    count: int
    # What a screen reader says after the module's name: "14 waiting".
    label: str


class ActivityStatusOut(BaseModel):
    tone: Literal["positive", "attention"]
    label: str


class ActivityItemOut(BaseModel):
    id: str
    title: str
    subtitle: str | None = None
    status: ActivityStatusOut
    at: datetime
    # The deciding admin's identity-api id; None only if it was never recorded.
    actor_id: uuid.UUID | None
    path: str | None = None


class ActivityEmptyOut(BaseModel):
    title: str
    body: str | None = None


class ActivityOut(BaseModel):
    title: str
    icon: str | None = None
    empty: ActivityEmptyOut
    items: list[ActivityItemOut]


# Typed loosely: pydantic's json_schema_extra wants plain JSON values.
EXAMPLE: dict[str, Any] = {
    "v": 1,
    "badge": {"count": 7, "label": "7 waiting"},
    "sections": [
        {
            "title": "Vendors",
            "icon": "store",
            "action": {"label": "Open review queue", "path": "/queue"},
            "alert": None,
            "figures": [
                {
                    "label": "Waiting",
                    "value": 7,
                    "unit": "count",
                    "hint": "Products 4 · Brand pages 1 · Applications 2",
                    "path": "/queue",
                },
                {
                    "label": "Median time to decision",
                    "value": 95,
                    "unit": "minutes",
                    "hint": "From submission to decision",
                    "path": None,
                },
            ],
        },
        {
            "title": "Publishing to the app",
            "icon": "send",
            "action": {"label": "Open publishing", "path": "/publishing"},
            "alert": {
                "tone": "warning",
                "text": "1 event did not reach the app. It retries automatically, "
                "or you can retry it now.",
                "action": {"label": "Open publishing", "path": "/publishing"},
            },
            "figures": [
                {
                    "label": "Failed",
                    "value": 1,
                    "unit": "count",
                    "hint": "Needs a look",
                    "path": "/publishing?status=failed",
                }
            ],
        },
    ],
    "activity": {
        "title": "Recent decisions",
        "icon": "clipboard-check",
        "empty": {
            "title": "No decisions yet",
            "body": "Approvals and send-backs show here as reviewers make them.",
        },
        "items": [
            {
                "id": "6f1d2c3b-4a59-4c7e-8b10-2d3e4f5a6b7c",
                "title": "Block-print cotton kurta",
                "subtitle": "Jaipur Prints · Product",
                "status": {"tone": "positive", "label": "Approved"},
                "at": "2026-11-10T09:30:00Z",
                "actor_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "path": "/queue",
            }
        ],
    },
}


class ModuleSummaryOut(BaseModel):
    """`ModuleSummary` v1 (packages/shell-protocol/src/summary.ts); the shell refuses anything
    else, so a change here is a change to that schema first."""

    model_config = ConfigDict(json_schema_extra={"examples": [EXAMPLE]})

    v: Literal[1] = 1
    # The count on the module's row in the sidebar: everything waiting for a reviewer.
    badge: SummaryBadgeOut | None
    sections: list[SummarySectionOut]
    activity: ActivityOut | None = None


def _vendors(found: AdminSummary, waiting: int) -> SummarySectionOut:
    return SummarySectionOut(
        title="Vendors",
        icon="store",
        action=SummaryLinkOut(label="Open review queue", path=QUEUE),
        figures=[
            SummaryFigureOut(
                label="Waiting",
                value=waiting,
                hint=f"Products {found.waiting_product:,} · "
                f"Brand pages {found.waiting_brand_page:,} · "
                f"Applications {found.waiting_application:,}",
                path=QUEUE,
            ),
            # The queue filters by "24-48 h" or "older than 48 h", not "over 24 h"; oldest first
            # puts these on top.
            SummaryFigureOut(
                label="Waiting over 24 hours",
                value=found.over_24h,
                hint="Oldest first in the queue",
                path=QUEUE_OLDEST,
            ),
            SummaryFigureOut(
                label="Decided today",
                value=found.decided_today,
                hint="Approved or sent back since midnight",
            ),
            SummaryFigureOut(
                label="Median time to decision",
                value=found.median_minutes,
                unit="minutes",
                hint="From submission to decision",
            ),
        ],
    )


def _publishing(found: AdminSummary) -> SummarySectionOut:
    failed = found.publishing_failed
    open_publishing = SummaryLinkOut(label="Open publishing", path=PUBLISHING)
    alert = None
    if failed > 0:
        alert = SummaryAlertOut(
            tone="warning",
            text=f"{failed} {plural(failed, 'event did', 'events did')} not reach the app. "
            f"{plural(failed, 'It retries', 'They retry')} automatically, "
            f"or you can retry {plural(failed, 'it', 'them')} now.",
            action=open_publishing,
        )
    return SummarySectionOut(
        title="Publishing to the app",
        icon="send",
        action=open_publishing,
        alert=alert,
        figures=[
            SummaryFigureOut(
                label="Delivered in the last 24 h",
                value=found.delivered_24h,
                hint="Reached the Shazlo app",
                path=publishing_status("delivered"),
            ),
            SummaryFigureOut(
                label="Waiting",
                value=found.publishing_waiting,
                hint="Sent within a minute",
                path=publishing_status("waiting"),
            ),
            SummaryFigureOut(
                label="Retrying",
                value=found.publishing_retrying,
                hint="The app did not answer yet",
                path=publishing_status("retrying"),
            ),
            SummaryFigureOut(
                label="Failed",
                value=failed,
                hint="Needs a look" if failed > 0 else "Nothing failed",
                path=publishing_status("failed"),
            ),
        ],
    )


def _decision_path(decision: RecentDecision) -> str:
    # Brand pages are reviewed per vendor, and applications and commission open the vendor. A
    # product opens the queue until the module's review URLs are settled (#295).
    if decision.kind == "brand_page":
        return brand_review(decision.vendor_id)
    if decision.kind in ("application", "commission"):
        return vendor_page(decision.vendor_id)
    return QUEUE


def _activity_item(decision: RecentDecision) -> ActivityItemOut:
    approved = decision.decision == "approved"
    return ActivityItemOut(
        id=decision.id,
        title=clip(decision.title),
        subtitle=clip(f"{decision.vendor_name} · {KIND_LABELS[decision.kind]}"),
        status=ActivityStatusOut(
            tone="positive" if approved else "attention",
            label="Approved" if approved else "Sent back",
        ),
        at=decision.at,
        actor_id=decision.reviewer_id,
        path=_decision_path(decision),
    )


def module_summary_out(found: AdminSummary) -> ModuleSummaryOut:
    waiting = found.waiting_product + found.waiting_brand_page + found.waiting_application
    return ModuleSummaryOut(
        badge=SummaryBadgeOut(count=waiting, label=f"{waiting:,} waiting"),
        sections=[_vendors(found, waiting), _publishing(found)],
        activity=ActivityOut(
            title="Recent decisions",
            icon="clipboard-check",
            empty=ActivityEmptyOut(
                title="No decisions yet",
                body="Approvals and send-backs show here as reviewers make them.",
            ),
            items=[_activity_item(d) for d in found.recent],
        ),
    )


@router.get("")
async def get_module_summary(
    response: Response, db: Db, summarizer: Summarizer
) -> ModuleSummaryOut:
    """What Shazlo One shows for the Vendors module: the badge (everything waiting), a Vendors
    card and a Publishing card with figures that open the module's pages, and the latest
    decisions. The same counts as `GET /v1/admin/summary`, in the shell's shared shape."""
    no_store(response)
    return module_summary_out(await summarizer.summary(db))
