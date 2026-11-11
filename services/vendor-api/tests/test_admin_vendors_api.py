"""Vendor accounts for admins: find them, approve, reject and suspend them.

A refused change rolls the shared test session back, so each test keeps ids instead of rows,
commits what it sets up, and reads results again from the database.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import Tenants
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import ADMIN_ID, ORIGIN, PASSWORD, RecordingSender, record_emails, token_of

from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorStatusEvent
from vendor_api.services.email import EmailTemplate

VENDORS = "/v1/admin/vendors"
T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)

# (status the vendor is in, action) -> whether it is allowed
MATRIX = {
    ("pending", "approve"): True,
    ("rejected", "approve"): True,
    ("suspended", "approve"): True,
    ("approved", "approve"): False,
    ("pending", "reject"): True,
    ("approved", "reject"): False,
    ("rejected", "reject"): False,
    ("suspended", "reject"): False,
    ("approved", "suspend"): True,
    ("pending", "suspend"): False,
    ("rejected", "suspend"): False,
    ("suspended", "suspend"): False,
}
TARGET = {"approve": "approved", "reject": "rejected", "suspend": "suspended"}
TEMPLATE = {
    "approve": EmailTemplate.VENDOR_APPROVED,
    "reject": EmailTemplate.VENDOR_REJECTED,
    "suspend": EmailTemplate.VENDOR_SUSPENDED,
}


@pytest.fixture(autouse=True)
def portal_origin(tenants: Tenants, override: Callable[..., Settings]) -> None:
    """The test client sends the portal's Origin; the refresh endpoint (cookie-authenticated)
    refuses an origin that is not allowed, so allow it, as the session tests do."""
    tenants.api.app.state.settings = override(
        tenants.api.app.state.settings, cors_allowed_origins=[ORIGIN]
    )


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get(tenants: Tenants, path: str = "", token: str | None = None) -> httpx.Response:
    return await tenants.api.http.get(VENDORS + path, headers=bearer(token or tenants.admin_token))


async def act(
    tenants: Tenants,
    vendor_id: uuid.UUID | str,
    action: str,
    reason: str | None = "Because",
    *,
    body: dict[str, Any] | None = None,
    token: str | None = None,
    suffix: str = "",
) -> httpx.Response:
    payload = body if body is not None else ({"reason": reason} if reason is not None else {})
    return await tenants.api.http.post(
        f"{VENDORS}/{vendor_id}/{action}{suffix}",
        json=payload,
        headers=bearer(token or tenants.admin_token),
    )


async def put_status(session: AsyncSession, vendor_id: uuid.UUID, status: str) -> None:
    await session.execute(update(Vendor).where(Vendor.id == vendor_id).values(status=status))
    await session.commit()


async def vendor_row(session: AsyncSession, vendor_id: uuid.UUID) -> Vendor:
    result = await session.scalars(
        select(Vendor).where(Vendor.id == vendor_id).execution_options(populate_existing=True)
    )
    return result.one()


async def events_of(session: AsyncSession, vendor_id: uuid.UUID) -> list[VendorStatusEvent]:
    result = await session.scalars(
        select(VendorStatusEvent)
        .where(VendorStatusEvent.vendor_id == vendor_id)
        .order_by(VendorStatusEvent.id)
    )
    return list(result)


async def count_events(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(VendorStatusEvent)) or 0


async def sign_in(tenants: Tenants, email: str) -> tuple[str, str]:
    """(access token, refresh token) of a vendor user."""
    response = await tenants.api.login(email, PASSWORD)
    assert response.status_code == 200, response.text
    return response.json()["access_token"], token_of(response)


# --- Who may call ------------------------------------------------------------------------


async def test_a_reviewer_and_a_super_admin_can_use_every_endpoint(tenants: Tenants) -> None:
    a_id = tenants.a.vendor.id
    for roles in (["vendor_reviewer"], ["super_admin"]):
        token = tenants.identity.token(roles)
        assert (await get(tenants, token=token)).status_code == 200
        assert (await get(tenants, f"/{a_id}", token=token)).status_code == 200
    token = tenants.identity.token(["super_admin"])
    assert (await act(tenants, a_id, "approve", token=token)).status_code == 200
    assert (await act(tenants, a_id, "suspend", token=token)).status_code == 200


@pytest.mark.parametrize("roles", [[], ["other_role"], ["vendor"]])
async def test_an_admin_without_the_reviewer_role_is_refused(
    tenants: Tenants, session: AsyncSession, roles: list[str]
) -> None:
    a_id = tenants.a.vendor.id
    token = tenants.identity.token(roles)
    assert (await get(tenants, token=token)).status_code == 403
    assert (await get(tenants, f"/{a_id}", token=token)).status_code == 403
    for action in ("approve", "reject", "suspend"):
        response = await act(tenants, a_id, action, token=token)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"
    assert (await vendor_row(session, a_id)).status == "pending"
    assert await events_of(session, a_id) == []


async def test_vendor_tokens_and_no_token_never_reach_these_endpoints(tenants: Tenants) -> None:
    http, a_id = tenants.api.http, tenants.a.vendor.id
    for method, path in (
        ("get", ""),
        ("get", f"/{a_id}"),
        ("post", f"/{a_id}/approve"),
        ("post", f"/{a_id}/reject"),
        ("post", f"/{a_id}/suspend"),
    ):
        assert (await http.request(method, VENDORS + path, json={})).status_code == 401
        for token in (tenants.a.owner_token, tenants.a.staff_token, tenants.b.owner_token):
            response = await http.request(method, VENDORS + path, json={}, headers=bearer(token))
            assert response.status_code == 401, (method, path)


async def test_the_admin_is_the_token_never_the_request(
    tenants: Tenants, session: AsyncSession
) -> None:
    a_id, other = tenants.a.vendor.id, uuid.uuid4()
    for extra in ({"reviewer_id": str(other)}, {"changed_by": str(other)}, {"status": "approved"}):
        response = await act(tenants, a_id, "suspend", body={"reason": "x", **extra})
        assert response.status_code == 422
    assert (await vendor_row(session, a_id)).status == "pending"

    await put_status(session, a_id, "approved")
    response = await act(tenants, a_id, "suspend", suffix=f"?admin_id={other}")
    assert response.status_code == 200
    vendor = await vendor_row(session, a_id)
    assert vendor.status_changed_by == ADMIN_ID != other
    (event,) = await events_of(session, a_id)
    assert (event.actor_type, event.actor_id) == ("admin", ADMIN_ID)

    someone = uuid.uuid4()
    token = tenants.identity.token(["vendor_reviewer"], subject=someone)
    await act(tenants, a_id, "approve", token=token)
    assert (await vendor_row(session, a_id)).status_changed_by == someone


# --- Listing and reading -----------------------------------------------------------------


async def test_pending_vendors_come_oldest_first_and_all_newest_first(
    tenants: Tenants, session: AsyncSession
) -> None:
    a_id, b_id = tenants.a.vendor.id, tenants.b.vendor.id
    await session.execute(update(Vendor).where(Vendor.id == a_id).values(created_at=T0))
    await session.execute(
        update(Vendor).where(Vendor.id == b_id).values(created_at=T0 + timedelta(hours=1))
    )
    await session.commit()
    pending = (await get(tenants)).json()
    assert [v["id"] for v in pending["items"]] == [str(a_id), str(b_id)]
    assert pending["total"] == 2
    everything = (await get(tenants, "?status=all")).json()
    assert [v["id"] for v in everything["items"]] == [str(b_id), str(a_id)]


async def test_the_list_filters_by_status_and_text(tenants: Tenants, session: AsyncSession) -> None:
    a_id, b_id = tenants.a.vendor.id, tenants.b.vendor.id
    await put_status(session, b_id, "suspended")

    def ids(response: httpx.Response) -> list[str]:
        assert response.status_code == 200, response.text
        return [v["id"] for v in response.json()["items"]]

    assert ids(await get(tenants)) == [str(a_id)]
    assert ids(await get(tenants, "?status=suspended")) == [str(b_id)]
    assert ids(await get(tenants, "?status=approved")) == []
    assert sorted(ids(await get(tenants, "?status=all"))) == sorted([str(a_id), str(b_id)])
    assert ids(await get(tenants, "?status=all&q=brand a")) == [str(a_id)]
    assert ids(await get(tenants, "?status=all&q=BRAND-B")) == [str(b_id)]
    assert ids(await get(tenants, "?status=all&q=owner@b")) == [str(b_id)]
    assert ids(await get(tenants, "?status=all&q=nothing-like-this")) == []
    # A wildcard is text, not a pattern.
    assert ids(await get(tenants, "?status=all&q=%25")) == []
    assert ids(await get(tenants, "?status=all&q=_")) == []


async def test_the_list_is_paged_with_a_total(tenants: Tenants) -> None:
    first = (await get(tenants, "?status=all&limit=1")).json()
    rest = (await get(tenants, "?status=all&limit=1&offset=1")).json()
    assert (first["total"], first["limit"], first["offset"], len(first["items"])) == (2, 1, 0, 1)
    assert len(rest["items"]) == 1 and rest["items"][0]["id"] != first["items"][0]["id"]
    assert (await get(tenants, "?status=all&offset=9")).json()["items"] == []


@pytest.mark.parametrize(
    "query", ["?status=bogus", "?status=ALL", "?limit=0", "?limit=101", "?offset=-1"]
)
async def test_bad_list_parameters_are_a_422(tenants: Tenants, query: str) -> None:
    assert (await get(tenants, query)).status_code == 422


async def test_a_vendor_is_shown_with_its_details_and_no_secrets(tenants: Tenants) -> None:
    body = (await get(tenants, f"/{tenants.a.vendor.id}")).json()
    assert body["name"] == "Brand A" and body["slug"] == "brand-a"
    assert body["email"] == "owner@a.test" and body["status"] == "pending"
    assert (body["status_reason"], body["status_changed_at"], body["status_changed_by"]) == (
        None,
        None,
        None,
    )
    assert body["events"] == []
    text = str(body).lower()
    assert "password" not in text and "hash" not in text and "token" not in text


async def test_an_unknown_vendor_is_a_404_and_a_bad_id_a_422(tenants: Tenants) -> None:
    missing = uuid.uuid4()
    assert (await get(tenants, f"/{missing}")).status_code == 404
    for action in ("approve", "reject", "suspend"):
        response = await act(tenants, missing, action)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "vendor_not_found"
    assert (await get(tenants, "/not-a-uuid")).status_code == 422


# --- The transitions ---------------------------------------------------------------------


@pytest.mark.parametrize(("status", "action"), list(MATRIX))
async def test_only_the_allowed_transitions_work(
    tenants: Tenants, session: AsyncSession, status: str, action: str
) -> None:
    sender = record_emails(tenants.api)
    a_id = tenants.a.vendor.id
    await put_status(session, a_id, status)
    response = await act(tenants, a_id, action)

    if MATRIX[(status, action)]:
        assert response.status_code == 200, response.text
        assert response.json()["status"] == TARGET[action]
        assert (await vendor_row(session, a_id)).status == TARGET[action]
        assert len(await events_of(session, a_id)) == 1
        assert [(to, tpl) for to, tpl, _ in sender.sent] == [("owner@a.test", TEMPLATE[action])]
    else:
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "invalid_status_transition"
        assert status in response.json()["error"]["message"]
        assert (await vendor_row(session, a_id)).status == status
        assert await events_of(session, a_id) == []
        assert sender.sent == []


async def test_a_change_records_the_reason_who_and_when(
    tenants: Tenants, session: AsyncSession
) -> None:
    a_id = tenants.a.vendor.id
    await put_status(session, a_id, "approved")
    response = await act(tenants, a_id, "suspend", "  Repeated chargebacks  ")
    assert response.status_code == 200
    body = response.json()
    assert (body["status"], body["status_reason"]) == ("suspended", "Repeated chargebacks")
    assert body["status_changed_by"] == str(ADMIN_ID) and body["status_changed_at"]

    vendor = await vendor_row(session, a_id)
    assert vendor.status_reason == "Repeated chargebacks"
    assert vendor.status_changed_by == ADMIN_ID and vendor.status_changed_at is not None
    (event,) = await events_of(session, a_id)
    assert (event.from_status, event.to_status) == ("approved", "suspended")
    assert (event.actor_type, event.actor_id, event.reason) == (
        "admin",
        ADMIN_ID,
        "Repeated chargebacks",
    )
    assert body["events"] == [
        {
            "from_status": "approved",
            "to_status": "suspended",
            "actor_type": "admin",
            "actor_id": str(ADMIN_ID),
            "reason": "Repeated chargebacks",
            "created_at": body["events"][0]["created_at"],
        }
    ]


async def test_the_history_keeps_every_change_in_order(
    tenants: Tenants, session: AsyncSession
) -> None:
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    await act(tenants, a_id, "suspend", "Paused")
    body = (await act(tenants, a_id, "approve", "Resolved")).json()
    assert [(e["from_status"], e["to_status"], e["reason"]) for e in body["events"]] == [
        ("pending", "approved", None),
        ("approved", "suspended", "Paused"),
        ("suspended", "approved", "Resolved"),
    ]
    assert (body["status"], body["status_reason"]) == ("approved", "Resolved")


@pytest.mark.parametrize("action", ["reject", "suspend"])
async def test_rejecting_and_suspending_need_a_reason(
    tenants: Tenants, session: AsyncSession, action: str
) -> None:
    a_id = tenants.a.vendor.id
    await put_status(session, a_id, "pending" if action == "reject" else "approved")
    before = (await vendor_row(session, a_id)).status
    for body in (
        {},
        {"reason": ""},
        {"reason": "   "},
        {"reason": "\n\t"},
        {"reason": None},
        {"reason": "x" * 2001},
        {"reason": 5},
    ):
        response = await act(tenants, a_id, action, body=body)
        assert response.status_code == 422, body
        assert response.json()["error"]["code"] == "validation_error"
    assert (await vendor_row(session, a_id)).status == before
    assert await events_of(session, a_id) == []


async def test_approving_takes_an_optional_reason(tenants: Tenants, session: AsyncSession) -> None:
    a_id, b_id = tenants.a.vendor.id, tenants.b.vendor.id
    assert (await act(tenants, a_id, "approve", None)).json()["status_reason"] is None
    with_reason = await act(tenants, b_id, "approve", "  Documents checked  ")
    assert with_reason.json()["status_reason"] == "Documents checked"
    blank = await act(tenants, b_id, "suspend", "Paused")
    assert blank.status_code == 200
    cleared = await act(tenants, b_id, "approve", "   ")
    assert cleared.status_code == 200 and cleared.json()["status_reason"] is None


async def test_a_double_click_changes_once(tenants: Tenants, session: AsyncSession) -> None:
    sender = record_emails(tenants.api)
    a_id = tenants.a.vendor.id
    assert (await act(tenants, a_id, "approve", None)).status_code == 200
    again = await act(tenants, a_id, "approve", None)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "invalid_status_transition"
    assert len(await events_of(session, a_id)) == 1
    assert len(sender.sent) == 1


async def test_changing_one_vendor_leaves_the_others_alone(
    tenants: Tenants, session: AsyncSession
) -> None:
    a_id, b_id = tenants.a.vendor.id, tenants.b.vendor.id
    await act(tenants, a_id, "reject", "No")
    assert (await vendor_row(session, b_id)).status == "pending"
    assert await events_of(session, b_id) == []


# --- The email ---------------------------------------------------------------------------


async def test_the_vendor_is_told_by_email_after_the_change(tenants: Tenants) -> None:
    sender: RecordingSender = record_emails(tenants.api)
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    await act(tenants, a_id, "suspend", "Chargebacks")
    await act(tenants, a_id, "approve", None)
    assert sender.sent == [
        ("owner@a.test", EmailTemplate.VENDOR_APPROVED, {"vendor_name": "Brand A"}),
        (
            "owner@a.test",
            EmailTemplate.VENDOR_SUSPENDED,
            {"vendor_name": "Brand A", "reason": "Chargebacks"},
        ),
        ("owner@a.test", EmailTemplate.VENDOR_APPROVED, {"vendor_name": "Brand A"}),
    ]


async def test_a_rejection_email_carries_the_reason(tenants: Tenants) -> None:
    sender = record_emails(tenants.api)
    await act(tenants, tenants.b.vendor.id, "reject", "Photos are blurry")
    ((to, template, context),) = sender.sent
    assert (to, template) == ("owner@b.test", EmailTemplate.VENDOR_REJECTED)
    assert context == {"vendor_name": "Brand B", "reason": "Photos are blurry"}


async def test_nothing_is_sent_for_a_change_that_was_refused(
    tenants: Tenants, session: AsyncSession
) -> None:
    sender = record_emails(tenants.api)
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "suspend", "x")  # pending: not allowed
    await act(tenants, a_id, "reject", None)  # no reason
    await act(tenants, uuid.uuid4(), "approve", None)  # unknown
    assert sender.sent == []


# --- Sessions ----------------------------------------------------------------------------


async def test_a_suspended_vendor_cannot_use_the_api_refresh_or_sign_in(
    tenants: Tenants,
) -> None:
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    access, refresh = await sign_in(tenants, "owner@a.test")
    assert (await tenants.api.me(access)).status_code == 200

    assert (await act(tenants, a_id, "suspend", "Chargebacks")).status_code == 200
    # Right after the change: the token, the refresh and a new sign-in are all refused.
    me = await tenants.api.me(access)
    assert (me.status_code, me.json()["error"]["code"]) == (403, "vendor_not_allowed")
    assert (await tenants.api.refresh(refresh)).status_code == 401
    login = await tenants.api.login("owner@a.test", PASSWORD)
    assert (login.status_code, login.json()["error"]["code"]) == (403, "vendor_not_allowed")


async def test_a_reinstated_vendor_can_sign_in_but_does_not_get_old_sessions_back(
    tenants: Tenants,
) -> None:
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    _, old_refresh = await sign_in(tenants, "owner@a.test")
    await act(tenants, a_id, "suspend", "Paused")
    await act(tenants, a_id, "approve", "Resolved")

    assert (await tenants.api.refresh(old_refresh)).status_code == 401  # the old session is gone
    access, refresh = await sign_in(tenants, "owner@a.test")  # a new one works
    assert (await tenants.api.me(access)).status_code == 200
    assert (await tenants.api.refresh(refresh)).status_code == 200


async def test_a_sign_in_that_read_the_old_status_does_not_outlive_a_suspension(
    tenants: Tenants,
) -> None:
    """The vendor is suspended (committed, sessions ended) after a sign-in read it as approved
    but before it read the session generation: the sign-in is refused, and no session is left
    to come back when the vendor is approved again."""
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    refresh_tokens = tenants.api.app.state.sessions._refresh_tokens
    real_generation = refresh_tokens.generation

    async def suspended_meanwhile(subject_id: uuid.UUID) -> int:
        refresh_tokens.generation = real_generation
        assert (await act(tenants, a_id, "suspend", "Paused")).status_code == 200
        result: int = await real_generation(subject_id)
        return result

    refresh_tokens.generation = suspended_meanwhile
    login = await tenants.api.login("owner@a.test", PASSWORD)
    assert (login.status_code, login.json()["error"]["code"]) == (403, "vendor_not_allowed")


async def test_rejecting_a_pending_vendor_ends_its_sessions(tenants: Tenants) -> None:
    a_id = tenants.a.vendor.id
    access, refresh = await sign_in(tenants, "owner@a.test")  # pending vendors can sign in
    assert (await tenants.api.me(access)).status_code == 200
    assert (await act(tenants, a_id, "reject", "Not a fit")).status_code == 200
    assert (await tenants.api.me(access)).status_code == 403
    assert (await tenants.api.refresh(refresh)).status_code == 401
    assert (await tenants.api.login("owner@a.test", PASSWORD)).status_code == 403


async def test_every_user_of_the_vendor_loses_their_sessions(tenants: Tenants) -> None:
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    _, owner_refresh = await sign_in(tenants, "owner@a.test")
    _, staff_refresh = await sign_in(tenants, "staff@a.test")
    await act(tenants, a_id, "suspend", "Paused")
    assert (await tenants.api.refresh(owner_refresh)).status_code == 401
    assert (await tenants.api.refresh(staff_refresh)).status_code == 401


async def test_another_vendors_sessions_are_not_touched(tenants: Tenants) -> None:
    a_id = tenants.a.vendor.id
    await act(tenants, a_id, "approve", None)
    b_access, b_refresh = await sign_in(tenants, "owner@b.test")
    await act(tenants, a_id, "suspend", "Paused")
    assert (await tenants.api.me(b_access)).status_code == 200
    assert (await tenants.api.refresh(b_refresh)).status_code == 200


async def test_approving_does_not_end_sessions(tenants: Tenants) -> None:
    a_id = tenants.a.vendor.id
    _, refresh = await sign_in(tenants, "owner@a.test")
    assert (await act(tenants, a_id, "approve", None)).status_code == 200
    assert (await tenants.api.refresh(refresh)).status_code == 200


async def test_if_the_sessions_cannot_be_ended_the_change_is_not_made(
    tenants: Tenants, session: AsyncSession
) -> None:
    sender = record_emails(tenants.api)
    a_id = tenants.a.vendor.id
    await put_status(session, a_id, "approved")

    async def redis_is_down(db: AsyncSession, vendor_id: uuid.UUID) -> int:
        raise ConnectionError("redis is down")

    tenants.api.app.state.sessions.end_sessions_of_vendor = redis_is_down
    with pytest.raises(ConnectionError):
        await act(tenants, a_id, "suspend", "Paused")
    # Not suspended with every session still alive: nothing was saved, nothing was sent.
    assert (await vendor_row(session, a_id)).status == "approved"
    assert await events_of(session, a_id) == []
    assert sender.sent == []


async def test_if_ending_the_sessions_again_fails_after_the_commit_the_change_stands(
    tenants: Tenants, session: AsyncSession
) -> None:
    sender = record_emails(tenants.api)
    a_id = tenants.a.vendor.id
    await put_status(session, a_id, "approved")
    sessions = tenants.api.app.state.sessions
    real = sessions.end_sessions_of_vendor
    calls: list[int] = []

    async def second_call_fails(db: AsyncSession, vendor_id: uuid.UUID) -> int:
        calls.append(len(calls) + 1)
        if len(calls) > 1:
            raise ConnectionError("redis went away")
        result: int = await real(db, vendor_id)
        return result

    sessions.end_sessions_of_vendor = second_call_fails
    response = await act(tenants, a_id, "suspend", "Paused")
    assert response.status_code == 200 and response.json()["status"] == "suspended"
    assert calls == [1, 2]  # before and after the commit
    assert (await vendor_row(session, a_id)).status == "suspended"
    assert len(sender.sent) == 1


async def test_reading_vendors_changes_nothing(tenants: Tenants, session: AsyncSession) -> None:
    before = await count_events(session)
    await get(tenants)
    await get(tenants, "?status=all")
    await get(tenants, f"/{tenants.a.vendor.id}")
    assert await count_events(session) == before
    assert (await vendor_row(session, tenants.a.vendor.id)).status == "pending"
