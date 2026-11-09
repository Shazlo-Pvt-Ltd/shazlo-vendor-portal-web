import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from shazlo_security.passwords import PasswordConfig, PasswordService
from shazlo_security.refresh_tokens import RefreshTokenConfig, RefreshTokenStore
from shazlo_security.tokens import TokenIssuer
from sqlalchemy.ext.asyncio import AsyncSession
from support import (
    EMAIL,
    NEW_PASSWORD,
    ORIGIN,
    PASSWORD,
    Account,
    Api,
    cookie_of,
    is_cleared,
    make_account,
    make_api,
    redis_keys,
    set_user,
    set_vendor_status,
    token_of,
    without_request_id,
)

from vendor_api.api.auth import COOKIE_NAME
from vendor_api.core.security import REFRESH_KEY_PREFIX, password_config, token_issuer
from vendor_api.core.settings import Settings
from vendor_api.db.models import VendorStatus, VendorUserRole


@pytest.fixture
def api_settings(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        jwt_issuer="https://vendor-api.test",
        cors_allowed_origins=[ORIGIN],
        # Small costs keep the password tests fast.
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
    )
    return result


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture
async def api(
    api_settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncIterator[Api]:
    # The reuse grace is off: any reuse of a rotated refresh token is theft.
    strict = Settings.model_validate(
        {**api_settings.model_dump(), "refresh_reuse_grace_seconds": 0}
    )
    async for api in make_api(strict, session, redis):
        yield api


@pytest.fixture
async def graceful_api(
    api_settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncIterator[Api]:
    async for api in make_api(api_settings, session, redis):  # the default 10-second grace
        yield api


@pytest.fixture
async def account(session: AsyncSession, hasher: PasswordService) -> Account:
    return await make_account(session, hasher)


@pytest.fixture
def hasher(api_settings: Settings) -> PasswordService:
    return PasswordService(password_config(api_settings))


# --- Login -------------------------------------------------------------------------------


async def test_login_gives_a_token_and_a_cookie(api: Api, account: Account) -> None:
    response = await api.login()
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 900
    assert body["user"]["email"] == EMAIL
    assert body["user"]["role"] == "owner"
    assert body["user"]["id"] == str(account.user.id)
    assert body["vendor"] == {
        "id": str(account.vendor.id),
        "name": account.vendor.name,
        "slug": account.vendor.slug,
        "status": "pending",
    }
    claims = await api.app.state.vendor_tokens.verify(body["access_token"])
    assert (claims.user_id, claims.vendor_id) == (account.user.id, account.vendor.id)
    assert claims.role is VendorUserRole.OWNER


async def test_the_refresh_token_is_only_in_the_cookie(api: Api, account: Account) -> None:
    response = await api.login()
    token = token_of(response)
    assert len(token) >= 43  # 256 bits
    assert token not in response.text
    cookie = cookie_of(response)
    assert cookie is not None
    morsel = cookie[COOKIE_NAME]
    assert morsel["httponly"] is True
    assert morsel["secure"] is True
    assert morsel["samesite"].lower() == "strict"
    assert morsel["path"] == "/v1/auth"
    assert morsel["expires"]


async def test_the_response_has_no_hash_or_secret(api: Api, account: Account) -> None:
    response = await api.login()
    assert token_of(response) not in response.text
    # Apart from the key `access_token`, no field mentions a password, a hash or a token.
    text = response.text.lower().replace("access_token", "").replace("token_type", "")
    for forbidden in ("password", "argon2", "hash", "token"):
        assert forbidden not in text


async def test_login_records_the_time(api: Api, account: Account, session: AsyncSession) -> None:
    before = datetime.now(UTC)
    await api.login()
    await session.refresh(account.user)
    assert account.user.last_login_at is not None
    assert account.user.last_login_at >= before - timedelta(seconds=1)


async def test_the_email_is_matched_in_any_letter_case(api: Api, account: Account) -> None:
    assert (await api.login(email="  ASHA@Atelier.TEST ")).status_code == 200


async def test_login_rehashes_when_the_cost_changed(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    override: Any,
) -> None:
    weak = PasswordService(PasswordConfig(time_cost=1, memory_cost_kib=8))
    old_hash = await weak.hash(PASSWORD)
    stronger = override(api_settings, argon2_time_cost=2, argon2_memory_cost_kib=16)
    account = await make_account(session, weak, password_hash=old_hash)
    async for api in make_api(stronger, session, redis):
        assert (await api.login()).status_code == 200
    await session.refresh(account.user)
    assert account.user.password_hash != old_hash
    strong = PasswordService(password_config(stronger))
    assert (await strong.verify_login(account.user.password_hash, PASSWORD)).new_hash is None


# --- Login failures look alike -----------------------------------------------------------


async def test_unknown_email_wrong_password_disabled_and_no_password_cannot_be_told_apart(
    api: Api, session: AsyncSession, hasher: PasswordService
) -> None:
    await make_account(session, hasher, email="ok@a.test")
    await make_account(session, hasher, email="off@b.test", status="disabled")
    await make_account(session, hasher, email="new@c.test", status="invited", password=None)
    await make_account(session, hasher, email="invited@d.test", status="invited")

    attempts = [
        ("nobody@nowhere.test", PASSWORD),  # unknown email
        ("ok@a.test", "wrong password here"),  # wrong password
        ("off@b.test", PASSWORD),  # disabled, correct password
        ("new@c.test", PASSWORD),  # invited, no password set yet
        ("invited@d.test", PASSWORD),  # invited: not active, whatever the password
    ]
    responses = [await api.login(email, password) for email, password in attempts]

    assert {response.status_code for response in responses} == {401}
    bodies = [without_request_id(response) for response in responses]
    assert all(body == bodies[0] for body in bodies)
    assert bodies[0]["error"]["code"] == "invalid_credentials"
    assert all(cookie_of(response) is None for response in responses)


async def test_a_correct_password_with_an_unverified_email_looks_like_a_wrong_one(
    api: Api, session: AsyncSession, hasher: PasswordService
) -> None:
    """Signup with someone else's address, then login with the chosen password: a separate
    answer for "unverified" would reveal whether signup created an account (a free address) or
    not (a registered one)."""
    await make_account(session, hasher, verified=False)
    unverified = await api.login()
    wrong = await api.login(password="not the password!")
    assert unverified.status_code == wrong.status_code == 401
    assert without_request_id(unverified) == without_request_id(wrong)
    assert cookie_of(unverified) is None


async def test_a_wrong_password_never_reveals_that_the_email_is_unverified(
    api: Api, session: AsyncSession, hasher: PasswordService
) -> None:
    await make_account(session, hasher, verified=False)
    response = await api.login(password="not the password")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


@pytest.mark.parametrize("status", [VendorStatus.PENDING, VendorStatus.APPROVED])
async def test_a_pending_or_approved_vendor_can_sign_in(
    api: Api, session: AsyncSession, hasher: PasswordService, status: VendorStatus
) -> None:
    await make_account(session, hasher, vendor_status=status)
    response = await api.login()
    assert response.status_code == 200
    assert response.json()["vendor"]["status"] == status.value


@pytest.mark.parametrize("status", [VendorStatus.REJECTED, VendorStatus.SUSPENDED])
async def test_a_rejected_or_suspended_vendor_cannot_sign_in(
    api: Api, session: AsyncSession, hasher: PasswordService, status: VendorStatus
) -> None:
    await make_account(session, hasher, vendor_status=status)
    response = await api.login()
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "vendor_not_allowed"
    assert cookie_of(response) is None
    assert "access_token" not in response.text


async def test_login_validates_its_input(api: Api) -> None:
    for payload in ({}, {"email": "a@b.test"}, {"email": "a@b.test", "password": ""}):
        response = await api.http.post("/v1/auth/login", json=payload)
        assert response.status_code == 422


# --- Refresh -----------------------------------------------------------------------------


async def test_refresh_rotates_the_token(api: Api, account: Account) -> None:
    first = token_of(await api.login())
    response = await api.refresh(first)
    assert response.status_code == 200
    second = token_of(response)
    assert second != first
    assert response.json()["user"]["email"] == EMAIL
    claims = await api.app.state.vendor_tokens.verify(response.json()["access_token"])
    assert claims.user_id == account.user.id
    # The new token rotates in turn.
    assert (await api.refresh(second)).status_code == 200


async def test_reusing_a_rotated_token_ends_the_whole_family(api: Api, account: Account) -> None:
    first = token_of(await api.login())
    second = token_of(await api.refresh(first))

    reuse = await api.refresh(first)
    assert reuse.status_code == 401
    assert reuse.json()["error"]["code"] == "invalid_refresh_token"
    assert is_cleared(reuse)

    # The token handed out after the first one is dead too: the family ended.
    assert (await api.refresh(second)).status_code == 401


async def test_a_reuse_a_moment_later_is_a_conflict_not_theft(
    graceful_api: Api, account: Account
) -> None:
    api = graceful_api
    first = token_of(await api.login())
    second = token_of(await api.refresh(first))

    again = await api.refresh(first)  # a second tab, a moment later
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "refresh_conflict"
    assert not is_cleared(again)  # the browser already holds the new cookie
    assert (await api.refresh(second)).status_code == 200  # nothing was revoked


@pytest.mark.parametrize("token", [None, "", "never-issued", "%00' OR 1=1 --"])
async def test_a_missing_or_unknown_token_is_refused_and_the_cookie_cleared(
    api: Api, token: str | None
) -> None:
    response = await api.refresh(token)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_refresh_token"
    assert is_cleared(response)


async def test_refresh_needs_an_allowed_origin(api: Api, account: Account) -> None:
    token = token_of(await api.login())
    for headers in ({"Origin": "https://evil.test"}, {"Origin": "null"}):
        response = await api.refresh(token, headers)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "origin_not_allowed"
        assert cookie_of(response) is None  # a refused request never touches the cookie

    # Neither Origin nor Referer: refused. The same token still works afterwards.
    api.http.headers.pop("Origin")
    assert (await api.refresh(token)).status_code == 403
    # A browser that leaves Origin out sends Referer instead.
    ok = await api.refresh(token, {"Referer": f"{ORIGIN}/dashboard"})
    assert ok.status_code == 200


async def test_a_suspended_vendor_cannot_refresh_and_its_session_ends(
    api: Api, account: Account, session: AsyncSession
) -> None:
    token = token_of(await api.login())
    await set_vendor_status(session, account.vendor, "suspended")
    response = await api.refresh(token)
    assert response.status_code == 401
    assert is_cleared(response)

    # Approved again: the old session does not come back.
    await set_vendor_status(session, account.vendor, "approved")
    assert (await api.refresh(token)).status_code == 401


@pytest.mark.parametrize("status", ["rejected", "suspended"])
async def test_a_rejected_or_suspended_vendor_cannot_refresh(
    api: Api, account: Account, session: AsyncSession, status: str
) -> None:
    token = token_of(await api.login())
    await set_vendor_status(session, account.vendor, status)
    assert (await api.refresh(token)).status_code == 401


async def test_a_disabled_user_cannot_refresh(
    api: Api, account: Account, session: AsyncSession
) -> None:
    token = token_of(await api.login())
    await set_user(session, account.user, status="disabled")
    assert (await api.refresh(token)).status_code == 401


async def test_a_user_whose_email_is_no_longer_verified_cannot_refresh(
    api: Api, account: Account, session: AsyncSession
) -> None:
    token = token_of(await api.login())
    await set_user(session, account.user, email_verified_at=None)
    assert (await api.refresh(token)).status_code == 401


async def test_ending_a_vendors_sessions_ends_every_user_of_that_vendor_only(
    api: Api, account: Account, session: AsyncSession, hasher: PasswordService
) -> None:
    """The hook Phase 3 calls when an admin changes a vendor's status."""
    staff = await make_account(
        session,
        hasher,
        email="staff@atelier.test",
        role=VendorUserRole.STAFF,
        vendor=account.vendor,
    )
    other = await make_account(session, hasher, email="owner@other.test")
    owner_token = token_of(await api.login())
    staff_token = token_of(await api.login(staff.user.email))
    other_token = token_of(await api.login(other.user.email))

    ended = await api.app.state.sessions.end_sessions_of_vendor(session, account.vendor.id)

    assert ended == 2
    assert (await api.refresh(owner_token)).status_code == 401
    assert (await api.refresh(staff_token)).status_code == 401
    assert (await api.refresh(other_token)).status_code == 200  # another vendor, untouched


async def test_ending_one_users_sessions(api: Api, account: Account) -> None:
    token = token_of(await api.login())
    await api.app.state.sessions.end_sessions_of_user(account.user.id)
    assert (await api.refresh(token)).status_code == 401


# --- Logout ------------------------------------------------------------------------------


async def test_logout_ends_the_session_and_clears_the_cookie(api: Api, account: Account) -> None:
    token = token_of(await api.login())
    response = await api.logout(token)
    assert response.status_code == 204
    assert is_cleared(response)
    assert (await api.refresh(token)).status_code == 401


async def test_logout_ends_only_its_own_session(api: Api, account: Account) -> None:
    laptop = token_of(await api.login())
    phone = token_of(await api.login())
    await api.logout(laptop)
    assert (await api.refresh(laptop)).status_code == 401
    assert (await api.refresh(phone)).status_code == 200


async def test_logout_without_a_cookie_is_still_204(api: Api) -> None:
    response = await api.logout(None)
    assert response.status_code == 204
    assert is_cleared(response)


async def test_logout_needs_an_allowed_origin(api: Api, account: Account) -> None:
    token = token_of(await api.login())
    api.http.cookies.clear()
    response = await api.http.post(
        "/v1/auth/logout",
        headers={"Cookie": f"{COOKIE_NAME}={token}", "Origin": "https://evil.test"},
    )
    assert response.status_code == 403
    assert (await api.refresh(token)).status_code == 200  # the session was not ended


# --- Change password ---------------------------------------------------------------------


async def test_change_password_ends_every_session_and_starts_a_new_one(
    api: Api, account: Account
) -> None:
    first = await api.login()
    laptop = token_of(first)
    phone = token_of(await api.login())

    response = await api.change_password(first.json()["access_token"])
    assert response.status_code == 200
    fresh = token_of(response)
    assert fresh not in (laptop, phone)
    await api.app.state.vendor_tokens.verify(response.json()["access_token"])

    assert (await api.refresh(laptop)).status_code == 401
    assert (await api.refresh(phone)).status_code == 401
    assert (await api.refresh(fresh)).status_code == 200  # the new session

    assert (await api.login(password=PASSWORD)).status_code == 401  # the old one is gone
    assert (await api.login(password=NEW_PASSWORD)).status_code == 200


async def test_change_password_needs_the_current_password(api: Api, account: Account) -> None:
    login = await api.login()
    response = await api.change_password(login.json()["access_token"], current="not mine")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_current_password"
    assert (await api.login()).status_code == 200  # unchanged


@pytest.mark.parametrize("new", ["short", EMAIL, "x" * 129])
async def test_change_password_applies_the_password_policy(
    api: Api, account: Account, new: str
) -> None:
    login = await api.login()
    response = await api.change_password(login.json()["access_token"], new=new)
    assert response.status_code == 422
    assert (await api.login()).status_code == 200  # unchanged


async def test_the_new_password_must_differ(api: Api, account: Account) -> None:
    login = await api.login()
    response = await api.change_password(login.json()["access_token"], new=PASSWORD)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weak_password"


async def test_change_password_needs_a_token(api: Api, account: Account) -> None:
    assert (await api.change_password(None)).status_code == 401


# --- The current vendor user -------------------------------------------------------------


async def test_me_returns_the_user_role_and_vendor(api: Api, account: Account) -> None:
    login = await api.login()
    response = await api.me(login.json()["access_token"])
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"user", "vendor"}
    assert body["user"]["email"] == EMAIL
    assert body["user"]["role"] == "owner"
    assert body["vendor"]["slug"] == account.vendor.slug
    assert body["vendor"]["status"] == "pending"


async def test_me_never_returns_a_hash_or_a_token(api: Api, account: Account) -> None:
    login = await api.login()
    response = await api.me(login.json()["access_token"])
    text = response.text.lower()
    for forbidden in ("password", "argon2", "hash", "token", token_of(login)):
        assert forbidden not in text


async def test_me_needs_a_valid_token(api: Api, account: Account) -> None:
    login = await api.login()
    good = login.json()["access_token"]
    head, payload, signature = good.split(".")
    tampered = f"{head}.{payload}.{'A' if signature[0] != 'A' else 'B'}{signature[1:]}"
    ring = api.app.state.keyring
    expired = token_of_issuer(
        api, account, ring, clock=lambda: datetime.now(UTC) - timedelta(hours=1)
    )
    cases = {
        "none": None,
        "garbage": "not.a.token",
        "tampered": tampered,
        "expired": expired,
    }
    for name, token in cases.items():
        response = await api.me(token)
        assert response.status_code == 401, name
        assert response.json()["error"]["code"] == "unauthorized", name
        assert response.headers["www-authenticate"] == "Bearer"


def token_of_issuer(api: Api, account: Account, ring: Any, *, clock: Any) -> str:
    issuer = token_issuer(api.app.state.settings, ring, clock=clock)
    from vendor_api.services.tokens import VendorTokens

    tokens = VendorTokens(issuer, ring, issuer_url=api.app.state.settings.jwt_issuer)
    return tokens.issue(
        user_id=account.user.id, vendor_id=account.vendor.id, role=VendorUserRole.OWNER
    ).token


async def test_an_identity_api_token_is_not_a_vendor_token(api: Api, account: Account) -> None:
    ring = api.app.state.keyring
    admin_token = TokenIssuer(
        api.app.state.settings.jwt_issuer, ring, access_ttl_seconds=900
    ).issue(subject=account.user.id, roles=["super_admin"], audience="identity-api")
    response = await api.me(admin_token.token)
    assert response.status_code == 401


async def test_a_token_for_another_vendor_than_the_users_is_refused(
    api: Api, account: Account, session: AsyncSession, hasher: PasswordService
) -> None:
    other = await make_account(session, hasher, email="owner@other.test")
    forged = api.app.state.vendor_tokens.issue(
        user_id=account.user.id, vendor_id=other.vendor.id, role=VendorUserRole.OWNER
    )
    assert (await api.me(forged.token)).status_code == 401


async def test_a_disabled_users_token_stops_working_at_once(
    api: Api, account: Account, session: AsyncSession
) -> None:
    token = (await api.login()).json()["access_token"]
    await set_user(session, account.user, status="disabled")
    assert (await api.me(token)).status_code == 401


async def test_a_suspended_vendors_token_stops_working_at_once(
    api: Api, account: Account, session: AsyncSession
) -> None:
    token = (await api.login()).json()["access_token"]
    await set_vendor_status(session, account.vendor, "suspended")
    response = await api.me(token)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "vendor_not_allowed"


async def test_a_pending_vendor_can_use_the_api(api: Api, account: Account) -> None:
    token = (await api.login()).json()["access_token"]
    assert (await api.me(token)).status_code == 200  # it must be able to edit and submit


async def test_an_owner_only_route_refuses_staff(
    api: Api, account: Account, session: AsyncSession, hasher: PasswordService
) -> None:
    staff = await make_account(
        session,
        hasher,
        email="staff@atelier.test",
        role=VendorUserRole.STAFF,
        vendor=account.vendor,
    )
    owner_token = (await api.login()).json()["access_token"]
    staff_token = (await api.login(staff.user.email)).json()["access_token"]

    ok = await api.http.get("/v1/owner-only", headers={"Authorization": f"Bearer {owner_token}"})
    assert ok.status_code == 200
    refused = await api.http.get(
        "/v1/owner-only", headers={"Authorization": f"Bearer {staff_token}"}
    )
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "forbidden"
    assert (await api.http.get("/v1/owner-only")).status_code == 401


async def test_the_role_comes_from_the_database_not_the_token(
    api: Api, account: Account, session: AsyncSession
) -> None:
    token = (await api.login()).json()["access_token"]  # issued while an owner
    await set_user(session, account.user, role="staff")
    response = await api.http.get("/v1/owner-only", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


# --- Nothing overlaps with identity-api --------------------------------------------------


async def test_the_cookie_and_the_redis_keys_are_the_vendors_own(
    api: Api, account: Account
) -> None:
    response = await api.login()
    token = token_of(response)
    assert COOKIE_NAME == "vendor_refresh"
    assert [h for h in response.headers.get_list("set-cookie") if "identity_refresh" in h] == []

    keys = await redis_keys(api.redis)
    assert keys
    assert REFRESH_KEY_PREFIX == "vendor:"
    assert all(key.startswith("vendor:") for key in keys)
    assert not any("identity:" in key for key in keys)
    assert not any(token in key for key in keys)  # only hashes are stored


async def test_two_services_on_one_redis_never_touch_each_others_sessions(
    api: Api, account: Account
) -> None:
    """The same subject id in identity-api's store and in vendor-api's: separate families."""
    identity = RefreshTokenStore(api.redis, RefreshTokenConfig("identity:"))
    session = await identity.start_family(
        account.user.id, await identity.generation(account.user.id)
    )
    vendor_token = token_of(await api.login())

    await api.app.state.refresh_tokens.revoke_all(account.user.id)  # vendor-api ends its own
    assert (await api.refresh(vendor_token)).status_code == 401
    assert (await identity.rotate(session.token)).subject_id == account.user.id  # identity's lives

    await identity.revoke_all(account.user.id)
    fresh = token_of(await api.login())  # and the other way round
    assert (await api.refresh(fresh)).status_code == 200


# --- Logs --------------------------------------------------------------------------------


async def test_no_log_line_carries_a_password_a_token_or_a_hash(
    api: Api, account: Account, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        login = await api.login()
        refresh_token = token_of(login)
        access = login.json()["access_token"]
        await api.login(password="a wrong password!")
        rotated = token_of(await api.refresh(refresh_token))
        await api.refresh(refresh_token)  # reuse
        await api.change_password(access, new="short")
        await api.logout(rotated)
    text = "\n".join(
        record.getMessage() + json.dumps(record.__dict__, default=str) for record in caplog.records
    )
    assert caplog.records
    for secret in (PASSWORD, "a wrong password!", refresh_token, rotated, access, "$argon2"):
        assert secret not in text
