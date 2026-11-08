import hashlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from conftest import Tenants
from fakeredis import FakeAsyncRedis
from shazlo_security.passwords import PasswordService
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import (
    EMAIL,
    PASSWORD,
    Account,
    Api,
    RecordingSender,
    make_account,
    make_api,
    record_emails,
    set_user,
    token_of,
    without_request_id,
)

from vendor_api.core.errors import ApiError
from vendor_api.core.security import password_config
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    AuthToken,
    TokenPurpose,
    Vendor,
    VendorUser,
)
from vendor_api.services.email import EmailTemplate

STAFF_PASSWORD = "a long staff password"  # noqa: S105
NEW_PASSWORD = "a brand new passphrase"  # noqa: S105


@pytest.fixture
def api_settings(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        jwt_issuer="https://vendor-api.test",
        cors_allowed_origins=["https://vendors.test"],
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
        refresh_reuse_grace_seconds=0,
    )
    return result


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture
def hasher(api_settings: Settings) -> PasswordService:
    return PasswordService(password_config(api_settings))


@pytest.fixture
async def account(session: AsyncSession, hasher: PasswordService) -> Account:
    return await make_account(session, hasher)


@pytest.fixture
async def api(
    api_settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncIterator[Api]:
    async for api in make_api(api_settings, session, redis):
        yield api


@pytest.fixture
def sender(api: Api) -> RecordingSender:
    return record_emails(api)


def bearer(access: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {access}"} if access else {}


async def access_token(api: Api, email: str = EMAIL, password: str = PASSWORD) -> str:
    response = await api.login(email, password)
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


async def invite(api: Api, access: str | None, email: str) -> httpx.Response:
    return await api.http.post("/v1/vendor/users", json={"email": email}, headers=bearer(access))


async def set_password(api: Api, token: str, password: str = STAFF_PASSWORD) -> httpx.Response:
    return await api.http.post("/v1/auth/set-password", json={"token": token, "password": password})


async def forgot(api: Api, email: str) -> httpx.Response:
    return await api.http.post("/v1/auth/forgot-password", json={"email": email})


async def patch_user(
    api: Api, access: str | None, user_id: uuid.UUID | str, disabled: bool
) -> httpx.Response:
    return await api.http.patch(
        f"/v1/vendor/users/{user_id}", json={"disabled": disabled}, headers=bearer(access)
    )


async def user_by_email(session: AsyncSession, email: str) -> VendorUser:
    return (
        await session.scalars(
            select(VendorUser)
            .where(VendorUser.email == email)
            .execution_options(populate_existing=True)
        )
    ).one()


async def count_users(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(VendorUser)) or 0)


async def invited_staff(
    api: Api, sender: RecordingSender, session: AsyncSession, email: str = "staff@atelier.test"
) -> tuple[VendorUser, str]:
    """The owner invites a staff member; returns the user and the invite token."""
    response = await invite(api, await access_token(api), email)
    assert response.status_code == 202
    return await user_by_email(session, email), sender.tokens()[-1]


async def active_staff(
    api: Api, sender: RecordingSender, session: AsyncSession, email: str = "staff@atelier.test"
) -> VendorUser:
    _, token = await invited_staff(api, sender, session, email)
    assert (await set_password(api, token)).status_code == 204
    return await user_by_email(session, email)


# --- Invite, set a password, sign in -----------------------------------------------------


async def test_an_invited_user_can_sign_in_only_after_setting_a_password(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    access = await access_token(api)
    response = await invite(api, access, "Staff@Atelier.Test")
    assert response.status_code == 202
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["status"] == "accepted"

    ((to, template, context),) = sender.sent
    assert (to, template) == ("staff@atelier.test", EmailTemplate.STAFF_INVITE)
    assert context["vendor_name"] == account.vendor.name
    assert context["expires_in_minutes"] == 24 * 60
    user = await user_by_email(session, "staff@atelier.test")
    assert (user.role, user.status) == ("staff", "invited")
    assert user.vendor_id == account.vendor.id
    assert (user.password_hash, user.email_verified_at) == (None, None)

    # The invited user cannot sign in, with any password.
    assert (await api.login("staff@atelier.test", STAFF_PASSWORD)).status_code == 401

    assert (await set_password(api, str(context["token"]))).status_code == 204
    user = await user_by_email(session, "staff@atelier.test")
    assert user.status == "active"
    assert user.password_hash is not None
    assert user.password_hash.startswith("$argon2id$")
    assert user.email_verified_at is not None  # the link proved the address
    login = await api.login("staff@atelier.test", STAFF_PASSWORD)
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "staff"
    assert login.json()["vendor"]["id"] == str(account.vendor.id)


async def test_the_invite_token_is_stored_as_a_hash_for_24_hours(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    user, token = await invited_staff(api, sender, session)
    (stored,) = (
        await session.scalars(select(AuthToken).where(AuthToken.vendor_user_id == user.id))
    ).all()
    assert stored.purpose == TokenPurpose.INVITE
    assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in json.dumps({k: str(v) for k, v in vars(stored).items()})
    lifetime = stored.expires_at - datetime.now(UTC)
    assert timedelta(hours=23, minutes=58) < lifetime <= timedelta(hours=24)
    assert len(token) >= 43  # 256 bits


async def test_set_password_signs_nobody_in(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    _, token = await invited_staff(api, sender, session)
    response = await set_password(api, token)
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("password", ["short", "elevenchars", "staff@atelier.test"])
async def test_a_weak_password_can_be_corrected_with_the_same_link(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession, password: str
) -> None:
    _, token = await invited_staff(api, sender, session)
    weak = await set_password(api, token, password)
    assert weak.status_code == 422
    assert weak.json()["error"]["code"] == "weak_password"
    assert password not in weak.text
    assert (await user_by_email(session, "staff@atelier.test")).status == "invited"
    assert (await set_password(api, token)).status_code == 204  # the token was not spent


async def test_a_password_is_used_exactly_as_typed(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    _, token = await invited_staff(api, sender, session)
    typed = "  spaces around me  "
    assert (await set_password(api, token, typed)).status_code == 204
    assert (await api.login("staff@atelier.test", typed)).status_code == 200


async def test_an_invite_works_once(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    _, token = await invited_staff(api, sender, session)
    assert (await set_password(api, token)).status_code == 204
    again = await set_password(api, token, "a different long password")
    assert again.status_code == 400
    assert again.json()["error"]["code"] == "invalid_token"
    # The first password still stands.
    assert (await api.login("staff@atelier.test", STAFF_PASSWORD)).status_code == 200


async def test_an_expired_invite_is_refused(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    user, token = await invited_staff(api, sender, session)
    await session.execute(
        update(AuthToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await session.commit()  # a failing request rolls the shared session back
    response = await set_password(api, token)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_token"
    assert (await user_by_email(session, "staff@atelier.test")).status == "invited"


async def test_a_used_an_expired_and_an_unknown_token_give_the_same_error(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    _, used = await invited_staff(api, sender, session, "one@atelier.test")
    await set_password(api, used)
    _, expired = await invited_staff(api, sender, session, "two@atelier.test")
    await session.execute(
        update(AuthToken)
        .where(AuthToken.token_hash == hashlib.sha256(expired.encode()).hexdigest())
        .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
    )
    await session.commit()
    bodies = []
    for token in (used, expired, "never-issued-token", "%00' OR 1=1 --"):
        response = await set_password(api, token)
        assert response.status_code == 400
        bodies.append(without_request_id(response))
    assert all(body == bodies[0] for body in bodies)
    assert bodies[0]["error"]["code"] == "invalid_token"


async def test_a_verification_token_cannot_set_a_password(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    user, token = await invited_staff(api, sender, session)
    await session.execute(update(AuthToken).values(purpose=TokenPurpose.VERIFY_EMAIL))
    await session.commit()
    assert (await set_password(api, token)).status_code == 400
    assert (await user_by_email(session, "staff@atelier.test")).status == "invited"


async def test_an_invite_for_a_user_who_is_not_invited_is_refused(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    """E.g. a leftover link, or one that was made before the user was disabled."""
    user, token = await invited_staff(api, sender, session)
    await set_user(session, user, status="disabled")
    response = await set_password(api, token)
    assert response.status_code == 400
    assert (await user_by_email(session, "staff@atelier.test")).password_hash is None


async def test_the_owner_of_a_vendor_invites_into_their_own_vendor_only(
    tenants: Tenants, session: AsyncSession
) -> None:
    for tenant in (tenants.a, tenants.b):
        email = f"helper@{tenant.vendor.slug}.test"
        response = await invite(tenants.api, tenant.owner_token, email)
        assert response.status_code == 202
        assert (await user_by_email(session, email)).vendor_id == tenant.vendor.id


# --- Who may invite ----------------------------------------------------------------------


async def test_staff_cannot_invite_list_or_change_users(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    staff = await active_staff(api, sender, session)
    access = await access_token(api, staff.email, STAFF_PASSWORD)
    sent_before = len(sender.sent)

    refused = [
        await invite(api, access, "friend@atelier.test"),
        await api.http.get("/v1/vendor/users", headers=bearer(access)),
        await patch_user(api, access, account.user.id, True),
        await api.http.post(f"/v1/vendor/users/{staff.id}/resend-invite", headers=bearer(access)),
    ]
    assert [response.status_code for response in refused] == [403, 403, 403, 403]
    assert all(response.json()["error"]["code"] == "forbidden" for response in refused)
    assert len(sender.sent) == sent_before


async def test_the_team_endpoints_need_a_token(api: Api, account: Account) -> None:
    assert (await invite(api, None, "x@y.test")).status_code == 401
    assert (await api.http.get("/v1/vendor/users")).status_code == 401
    assert (await patch_user(api, None, uuid.uuid4(), True)).status_code == 401


# --- An address that is already used gets the same answer --------------------------------


async def test_an_address_already_used_anywhere_gets_the_same_answer_and_no_email(
    api: Api,
    account: Account,
    sender: RecordingSender,
    session: AsyncSession,
    hasher: PasswordService,
) -> None:
    await make_account(session, hasher, email="elsewhere@else.test")  # another vendor's owner
    session.add(
        Vendor(
            name="Lonely",
            slug="lonely",
            email="lonely@vendor.test",  # a vendor with no user at all
            phone="+911234567890",
            contact_name="L",
            product_type="apparel",
            price_min_paise=0,
            price_max_paise=0,
        )
    )
    await session.commit()
    access = await access_token(api)
    new = await invite(api, access, "brand.new@atelier.test")
    assert new.status_code == 202
    users_before, sent_before = await count_users(session), len(sender.sent)

    used = [
        EMAIL,  # the owner's own address
        "BRAND.NEW@atelier.test",  # invited a moment ago, in another letter case
        "elsewhere@else.test",  # another vendor's user
        "lonely@vendor.test",  # another vendor's address
    ]
    for email in used:
        response = await invite(api, access, email)
        assert response.status_code == new.status_code
        assert response.json() == new.json()
    assert await count_users(session) == users_before
    assert len(sender.sent) == sent_before


# --- Listing and disabling ---------------------------------------------------------------


async def test_the_owner_lists_their_users_and_only_their_own(
    api: Api,
    account: Account,
    sender: RecordingSender,
    session: AsyncSession,
    hasher: PasswordService,
) -> None:
    await make_account(session, hasher, email="owner@other.test")
    staff = await active_staff(api, sender, session)
    response = await api.http.get("/v1/vendor/users", headers=bearer(await access_token(api)))
    assert response.status_code == 200
    users = {user["email"]: user for user in response.json()}
    assert set(users) == {EMAIL, staff.email}
    assert (users[EMAIL]["role"], users[staff.email]["role"]) == ("owner", "staff")
    assert {user["status"] for user in users.values()} == {"active"}
    assert set(users[EMAIL]) == {"id", "email", "role", "status", "last_login_at", "created_at"}
    text = response.text.lower()
    assert "hash" not in text
    assert "password" not in text
    assert "owner@other.test" not in text


async def test_disabling_a_user_ends_their_sessions_and_blocks_sign_in(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    staff = await active_staff(api, sender, session)
    staff_login = await api.login(staff.email, STAFF_PASSWORD)
    refresh_token = token_of(staff_login)
    staff_access = staff_login.json()["access_token"]

    response = await patch_user(api, await access_token(api), staff.id, True)
    assert response.status_code == 200
    assert response.json()["status"] == "disabled"

    assert (await api.login(staff.email, STAFF_PASSWORD)).status_code == 401
    api.http.cookies.clear()
    refreshed = await api.http.post(
        "/v1/auth/refresh", headers={"Cookie": f"vendor_refresh={refresh_token}"}
    )
    assert refreshed.status_code == 401
    # The access token already issued stops working at once too (the user is read each time).
    assert (await api.http.get("/v1/vendor/me", headers=bearer(staff_access))).status_code == 401


async def test_enabling_restores_an_active_user_and_returns_an_unfinished_one_to_invited(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    access = await access_token(api)
    working = await active_staff(api, sender, session, "working@atelier.test")
    pending, _ = await invited_staff(api, sender, session, "pending@atelier.test")
    for user in (working, pending):
        assert (await patch_user(api, access, user.id, True)).json()["status"] == "disabled"

    assert (await patch_user(api, access, working.id, False)).json()["status"] == "active"
    # Never set a password: enabling cannot make them active, they need an invite again.
    assert (await patch_user(api, access, pending.id, False)).json()["status"] == "invited"
    assert (await api.login(working.email, STAFF_PASSWORD)).status_code == 200


async def test_disabling_kills_the_users_unused_links(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    staff, token = await invited_staff(api, sender, session)
    staff_id = staff.id  # read now: a failing request rolls the session back and expires objects
    access = await access_token(api)
    await patch_user(api, access, staff_id, True)
    await patch_user(api, access, staff_id, False)  # back to invited
    assert (await set_password(api, token)).status_code == 400  # the old link is dead
    # A new invite works.
    assert (
        await api.http.post(f"/v1/vendor/users/{staff_id}/resend-invite", headers=bearer(access))
    ).status_code == 204
    assert (await set_password(api, sender.tokens()[-1])).status_code == 204


async def test_the_owner_cannot_disable_themselves(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    access = await access_token(api)
    response = await patch_user(api, access, account.user.id, True)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "cannot_disable_self"
    assert (await user_by_email(session, EMAIL)).status == "active"
    assert (await api.me(access)).status_code == 200


async def test_a_vendor_always_keeps_its_owner(
    api: Api, account: Account, session: AsyncSession
) -> None:
    """Through the API only the owner can disable, so the owner could only disable themselves
    (refused above). The service refuses it for anyone else too."""
    team = api.app.state.team
    for disabled in (True, False):
        with pytest.raises(ApiError) as refused:
            await team.set_disabled(
                session, account.vendor.id, uuid.uuid4(), account.user.id, disabled=disabled
            )
        assert refused.value.code == "owner_cannot_be_disabled"
    assert (await user_by_email(session, EMAIL)).status == "active"


@pytest.mark.parametrize("target", ["other_vendor", "unknown"])
async def test_another_vendors_user_and_an_unknown_id_are_both_404(
    tenants: Tenants, session: AsyncSession, target: str
) -> None:
    other = tenants.b.owner
    user_id = other.id if target == "other_vendor" else uuid.uuid4()
    api, access = tenants.api, tenants.a.owner_token

    patched = await patch_user(api, access, user_id, True)
    resent = await api.http.post(
        f"/v1/vendor/users/{user_id}/resend-invite", headers=bearer(access)
    )

    assert (patched.status_code, resent.status_code) == (404, 404)
    assert patched.json()["error"]["code"] == resent.json()["error"]["code"] == "user_not_found"
    assert (await user_by_email(session, "owner@b.test")).status == "active"  # untouched


async def test_a_malformed_user_id_is_a_validation_error(api: Api, account: Account) -> None:
    access = await access_token(api)
    assert (await patch_user(api, access, "not-a-uuid", True)).status_code == 422


async def test_the_patch_body_is_strict(api: Api, account: Account) -> None:
    access = await access_token(api)
    for body in ({}, {"disabled": "maybe"}, {"disabled": True, "role": "owner"}):
        response = await api.http.patch(
            f"/v1/vendor/users/{uuid.uuid4()}", json=body, headers=bearer(access)
        )
        assert response.status_code == 422


# --- Resending an invite -----------------------------------------------------------------


async def test_resending_an_invite_ends_the_old_link(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    staff, old = await invited_staff(api, sender, session)
    access = await access_token(api)
    response = await api.http.post(
        f"/v1/vendor/users/{staff.id}/resend-invite", headers=bearer(access)
    )
    assert response.status_code == 204
    assert [(to, template) for to, template, _ in sender.sent] == [
        (staff.email, EmailTemplate.STAFF_INVITE)
    ] * 2
    new = sender.tokens()[-1]
    assert new != old
    assert (await set_password(api, old)).status_code == 400
    assert (await set_password(api, new)).status_code == 204


async def test_only_a_user_who_has_not_set_a_password_can_be_reinvited(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    staff = await active_staff(api, sender, session)
    response = await api.http.post(
        f"/v1/vendor/users/{staff.id}/resend-invite", headers=bearer(await access_token(api))
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_invited"


# --- Forgot and reset --------------------------------------------------------------------


async def test_forgot_password_answers_alike_for_every_kind_of_address(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    await active_staff(api, sender, session, "active@atelier.test")
    await invited_staff(api, sender, session, "invited@atelier.test")
    disabled = await active_staff(api, sender, session, "off@atelier.test")
    await set_user(session, disabled, status="disabled")
    sent_before = len(sender.sent)

    answers = [
        await forgot(api, "active@atelier.test"),
        await forgot(api, "nobody@nowhere.test"),  # unknown
        await forgot(api, "invited@atelier.test"),  # still has to use the invite
        await forgot(api, "off@atelier.test"),  # disabled
    ]

    assert {response.status_code for response in answers} == {202}
    assert all(response.json() == answers[0].json() for response in answers)
    assert answers[0].headers["cache-control"] == "no-store"
    # Only the active user got an email.
    assert len(sender.sent) == sent_before + 1
    to, template, context = sender.sent[-1]
    assert (to, template) == ("active@atelier.test", EmailTemplate.PASSWORD_RESET)
    assert context["expires_in_minutes"] == 60


async def test_a_reset_token_lasts_an_hour_and_only_its_hash_is_stored(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    await forgot(api, "  ASHA@Atelier.Test ")
    token = sender.tokens()[-1]
    (stored,) = (await session.scalars(select(AuthToken))).all()
    assert stored.purpose == TokenPurpose.RESET_PASSWORD
    assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert timedelta(minutes=58) < stored.expires_at - datetime.now(UTC) <= timedelta(hours=1)


async def test_resetting_the_password_ends_every_session_of_the_user(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    laptop = token_of(await api.login())
    phone = token_of(await api.login())
    await forgot(api, EMAIL)

    response = await set_password(api, sender.tokens()[-1], NEW_PASSWORD)
    assert response.status_code == 204

    for token in (laptop, phone):
        api.http.cookies.clear()
        refreshed = await api.http.post(
            "/v1/auth/refresh", headers={"Cookie": f"vendor_refresh={token}"}
        )
        assert refreshed.status_code == 401
    assert (await api.login(EMAIL, PASSWORD)).status_code == 401  # the old password is gone
    assert (await api.login(EMAIL, NEW_PASSWORD)).status_code == 200


async def test_a_newer_reset_ends_the_older_one_and_a_used_one_ends_the_rest(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    await forgot(api, EMAIL)
    await forgot(api, EMAIL)
    first, second = sender.tokens()
    assert (await set_password(api, first, NEW_PASSWORD)).status_code == 400
    assert (await set_password(api, second, NEW_PASSWORD)).status_code == 204
    # Spent: it cannot be used again to set another password.
    assert (await set_password(api, second, "yet another password!")).status_code == 400


async def test_a_reset_verifies_the_email_of_an_active_user_who_never_did(
    api: Api, session: AsyncSession, hasher: PasswordService, redis: FakeAsyncRedis
) -> None:
    await make_account(session, hasher, verified=False)
    sender = record_emails(api)
    await forgot(api, EMAIL)
    assert (await api.login()).status_code == 403  # not verified yet
    assert (await set_password(api, sender.tokens()[-1], NEW_PASSWORD)).status_code == 204
    assert (await api.login(EMAIL, NEW_PASSWORD)).status_code == 200


async def test_a_reset_link_does_not_work_for_a_user_who_was_disabled_afterwards(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    await forgot(api, EMAIL)
    await set_user(session, account.user, status="disabled")
    assert (await set_password(api, sender.tokens()[-1], NEW_PASSWORD)).status_code == 400


async def test_a_reset_token_cannot_activate_an_invited_user(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    user, token = await invited_staff(api, sender, session)
    await session.execute(update(AuthToken).values(purpose=TokenPurpose.RESET_PASSWORD))
    await session.commit()
    assert (await set_password(api, token)).status_code == 400
    assert (await user_by_email(session, "staff@atelier.test")).status == "invited"


async def test_a_staff_members_reset_does_not_touch_the_owners_sessions(
    api: Api, account: Account, sender: RecordingSender, session: AsyncSession
) -> None:
    staff = await active_staff(api, sender, session)
    owner_token = token_of(await api.login())
    await forgot(api, staff.email)
    await set_password(api, sender.tokens()[-1], NEW_PASSWORD)
    api.http.cookies.clear()
    owner_refresh = await api.http.post(
        "/v1/auth/refresh", headers={"Cookie": f"vendor_refresh={owner_token}"}
    )
    assert owner_refresh.status_code == 200


# --- Limits ------------------------------------------------------------------------------


async def test_invites_are_limited_per_vendor(
    api_settings: Settings,
    override: Any,
    account: Account,
    session: AsyncSession,
    redis: FakeAsyncRedis,
) -> None:
    async for api in make_api(
        override(api_settings, rate_limit_staff_invite_vendor="2/60"), session, redis
    ):
        sender = record_emails(api)
        access = await access_token(api)
        statuses = [
            (await invite(api, access, f"person{n}@atelier.test")).status_code for n in range(3)
        ]
        assert statuses == [202, 202, 429]
        assert len(sender.sent) == 2


async def test_forgot_password_is_limited_per_address_whether_or_not_it_exists(
    api_settings: Settings,
    override: Any,
    account: Account,
    session: AsyncSession,
    redis: FakeAsyncRedis,
) -> None:
    async for api in make_api(
        override(api_settings, rate_limit_forgot_password_email="2/60"), session, redis
    ):
        for email in (EMAIL, "nobody@nowhere.test"):
            statuses = [(await forgot(api, email)).status_code for _ in range(3)]
            assert statuses == [202, 202, 429]


async def test_set_password_is_limited_per_ip(
    api_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
) -> None:
    async for api in make_api(
        override(api_settings, rate_limit_set_password_ip="2/60"), session, redis
    ):
        statuses = [(await set_password(api, "guess")).status_code for _ in range(3)]
        assert statuses == [400, 400, 429]


# --- Logs --------------------------------------------------------------------------------


async def test_no_log_line_carries_a_token_or_a_password(
    api: Api,
    account: Account,
    sender: RecordingSender,
    session: AsyncSession,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG):
        _, invite_token = await invited_staff(api, sender, session)
        await set_password(api, "never-issued", STAFF_PASSWORD)
        await set_password(api, invite_token, "short")
        await set_password(api, invite_token, STAFF_PASSWORD)
        await forgot(api, EMAIL)
        await set_password(api, sender.tokens()[-1], NEW_PASSWORD)
    text = "\n".join(
        record.getMessage() + json.dumps(record.__dict__, default=str) for record in caplog.records
    )
    assert caplog.records
    for secret in (STAFF_PASSWORD, NEW_PASSWORD, *sender.tokens()):
        assert secret not in text
