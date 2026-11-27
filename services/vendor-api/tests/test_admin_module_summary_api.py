"""The Vendors module's summary for Shazlo One, in the shell's shared shape (ADR 0011).

The words, figures and links come from `module_summary_out`, tested here without a database; the
counts behind them are `AdminSummaryService`'s, tested in test_admin_summary_api.py. The HTTP tests
check who may ask and that the route lives on the admin app only. The TypeScript side reads the
OpenAPI example with the shell's own schema (test/contracts/module-summary.test.js).
"""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

import httpx
from conftest import Tenants

from vendor_api.api.admin_module_summary import EXAMPLE, ModuleSummaryOut, module_summary_out
from vendor_api.services.admin_summary import AdminSummary, AdminSummaryService, RecentDecision

ROUTE = "/v1/admin/module-summary"
NOW = datetime(2026, 11, 12, 4, 30, tzinfo=UTC)
VENDOR = uuid.UUID("3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10")
REVIEWER = uuid.UUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")

EMPTY = AdminSummary(
    waiting_product=0,
    waiting_brand_page=0,
    waiting_application=0,
    over_24h=0,
    decided_today=0,
    median_minutes=None,
    resubmissions=0,
    commission_proposals=0,
    delivered_24h=0,
    publishing_waiting=0,
    publishing_retrying=0,
    publishing_failed=0,
    recent=[],
)


def decision(
    kind: str, verdict: str = "approved", reviewer: uuid.UUID | None = REVIEWER
) -> RecentDecision:
    return RecentDecision(
        id=f"{kind}-1",
        kind=kind,  # type: ignore[arg-type]
        review_id=None,
        subject_id=VENDOR,
        title=f"A {kind}",
        vendor_id=VENDOR,
        vendor_name="Jaipur Prints",
        decision=verdict,  # type: ignore[arg-type]
        at=NOW,
        reviewer_id=reviewer,
    )


def out(found: AdminSummary) -> dict[str, object]:
    body: dict[str, object] = module_summary_out(found).model_dump(mode="json")
    return body


def section(body: dict[str, object], title: str) -> dict[str, object]:
    sections = body["sections"]
    assert isinstance(sections, list)
    found: dict[str, object] = next(s for s in sections if s["title"] == title)
    return found


def figures(body: dict[str, object], title: str) -> dict[str, dict[str, object]]:
    listed = section(body, title)["figures"]
    assert isinstance(listed, list)
    return {f["label"]: f for f in listed}


# --- The shape -------------------------------------------------------------------------------


def test_the_example_is_a_valid_answer() -> None:
    assert ModuleSummaryOut.model_validate(EXAMPLE).model_dump(mode="json") == EXAMPLE


def test_the_badge_counts_everything_waiting_for_a_reviewer() -> None:
    found = replace(EMPTY, waiting_product=9, waiting_brand_page=2, waiting_application=3)
    assert out(found)["badge"] == {"count": 14, "label": "14 waiting"}


def test_a_large_count_reads_with_separators() -> None:
    found = replace(EMPTY, waiting_product=9_000, waiting_brand_page=500, waiting_application=500)
    body = out(found)
    assert body["badge"] == {"count": 10_000, "label": "10,000 waiting"}
    assert figures(body, "Vendors")["Waiting"]["hint"] == (
        "Products 9,000 · Brand pages 500 · Applications 500"
    )


def test_the_vendors_card_links_the_waiting_figures_into_the_queue() -> None:
    found = replace(
        EMPTY,
        waiting_product=9,
        waiting_brand_page=2,
        waiting_application=3,
        over_24h=6,
        decided_today=1,
        median_minutes=320,
    )
    vendors = section(out(found), "Vendors")
    assert vendors["icon"] == "store"
    assert vendors["action"] == {"label": "Open review queue", "path": "/queue"}
    assert vendors["alert"] is None
    assert figures(out(found), "Vendors") == {
        "Waiting": {
            "label": "Waiting",
            "value": 14,
            "unit": "count",
            "hint": "Products 9 · Brand pages 2 · Applications 3",
            "path": "/queue",
        },
        "Waiting over 24 hours": {
            "label": "Waiting over 24 hours",
            "value": 6,
            "unit": "count",
            "hint": "Oldest first in the queue",
            "path": "/queue?sort=oldest",
        },
        "Decided today": {
            "label": "Decided today",
            "value": 1,
            "unit": "count",
            "hint": "Approved or sent back since midnight",
            "path": None,
        },
        "Median time to decision": {
            "label": "Median time to decision",
            "value": 320,
            "unit": "minutes",
            "hint": "From submission to decision",
            "path": None,
        },
    }


def test_with_no_decisions_today_the_median_is_empty_not_zero() -> None:
    median = figures(out(EMPTY), "Vendors")["Median time to decision"]
    assert median["value"] is None


def test_publishing_links_each_figure_to_its_status() -> None:
    found = replace(
        EMPTY, delivered_24h=324, publishing_waiting=2, publishing_retrying=1, publishing_failed=1
    )
    listed = figures(out(found), "Publishing to the app")
    assert {label: (f["value"], f["path"]) for label, f in listed.items()} == {
        "Delivered in the last 24 h": (324, "/publishing?status=delivered"),
        "Waiting": (2, "/publishing?status=waiting"),
        "Retrying": (1, "/publishing?status=retrying"),
        "Failed": (1, "/publishing?status=failed"),
    }


def test_a_failed_event_raises_a_warning_that_opens_publishing() -> None:
    one = section(out(replace(EMPTY, publishing_failed=1)), "Publishing to the app")
    assert one["alert"] == {
        "tone": "warning",
        "text": "1 event did not reach the app. It retries automatically, or you can retry it now.",
        "action": {"label": "Open publishing", "path": "/publishing"},
    }
    two = section(out(replace(EMPTY, publishing_failed=2)), "Publishing to the app")
    assert isinstance(two["alert"], dict)
    assert two["alert"]["text"] == (
        "2 events did not reach the app. They retry automatically, or you can retry them now."
    )


def test_nothing_failed_means_no_warning() -> None:
    publishing = section(out(EMPTY), "Publishing to the app")
    assert publishing["alert"] is None
    assert publishing["action"] == {"label": "Open publishing", "path": "/publishing"}
    assert figures(out(EMPTY), "Publishing to the app")["Failed"]["hint"] == "Nothing failed"


# --- Recent decisions ------------------------------------------------------------------------


def test_no_decisions_says_so() -> None:
    activity = out(EMPTY)["activity"]
    assert activity == {
        "title": "Recent decisions",
        "icon": "clipboard-check",
        "empty": {
            "title": "No decisions yet",
            "body": "Approvals and send-backs show here as reviewers make them.",
        },
        "items": [],
    }


def test_each_decision_opens_where_the_old_home_opened_it() -> None:
    found = replace(
        EMPTY,
        recent=[
            decision("product"),
            decision("brand_page", "rejected"),
            decision("application"),
            decision("commission", "rejected", reviewer=None),
        ],
    )
    activity = out(found)["activity"]
    assert isinstance(activity, dict)
    items = activity["items"]
    assert [(i["subtitle"], i["status"], i["path"], i["actor_id"]) for i in items] == [
        (
            "Jaipur Prints · Product",
            {"tone": "positive", "label": "Approved"},
            "/queue",
            str(REVIEWER),
        ),
        (
            "Jaipur Prints · Brand page",
            {"tone": "attention", "label": "Sent back"},
            f"/review/brand/{VENDOR}",
            str(REVIEWER),
        ),
        (
            "Jaipur Prints · Application",
            {"tone": "positive", "label": "Approved"},
            f"/vendors/{VENDOR}",
            str(REVIEWER),
        ),
        (
            "Jaipur Prints · Commission",
            {"tone": "attention", "label": "Sent back"},
            f"/vendors/{VENDOR}",
            None,
        ),
    ]
    assert items[0]["at"] == "2026-11-12T04:30:00Z"


# --- Over HTTP -------------------------------------------------------------------------------


async def get(tenants: Tenants, token: str | None = None) -> httpx.Response:
    tenants.api.admin.state.admin_summary = AdminSummaryService(clock=lambda: NOW)
    headers = {"Authorization": f"Bearer {token or tenants.admin_token}"}
    return await tenants.api.http.get(ROUTE, headers=headers)


async def test_a_reviewer_gets_the_summary_uncached(tenants: Tenants) -> None:
    response = await get(tenants)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["v"] == 1
    assert [s["title"] for s in body["sections"]] == ["Vendors", "Publishing to the app"]
    ModuleSummaryOut.model_validate(body)


async def test_only_reviewers_and_super_admins_may_ask(tenants: Tenants) -> None:
    assert (await get(tenants, tenants.identity.token(["super_admin"]))).status_code == 200
    assert (await get(tenants, tenants.identity.token([]))).status_code == 403
    assert (await tenants.api.http.get(ROUTE)).status_code == 401
    assert (await get(tenants, tenants.a.owner_token)).status_code == 401


async def test_the_seller_app_does_not_serve_it(tenants: Tenants) -> None:
    seller = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=tenants.api.app), base_url="http://test"
    )
    async with seller:
        response = await seller.get(
            ROUTE, headers={"Authorization": f"Bearer {tenants.admin_token}"}
        )
    assert response.status_code == 404
