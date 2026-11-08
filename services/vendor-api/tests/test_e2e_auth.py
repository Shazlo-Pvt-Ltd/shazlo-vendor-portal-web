"""The whole vendor and admin auth flow with the real pieces: Postgres, a real Redis, the real
JWKS client fetching identity-api's keys over HTTP (a mock transport stands in for the network),
and the real emails' tokens (read from the sent email, as a person would from their inbox).

It needs `DATABASE_URL` and `REDIS_URL` (CI sets both) and skips without them.
"""

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
import jwt
import pytest
from redis.asyncio import Redis
from shazlo_auth import JwksClient
from shazlo_security.keys import generate_private_key
from shazlo_security.keys import private_key_pem as pem_of
from shazlo_security.passwords import PasswordService
from sqlalchemy.ext.asyncio import AsyncSession
from support import (
    EMAIL,
    JWKS_URL,
    Api,
    Identity,
    cookie_of,
    is_cleared,
    make_account,
    make_api,
    record_emails,
    token_of,
)

from vendor_api.core.security import password_config
from vendor_api.core.settings import Settings
from vendor_api.services.email import EmailTemplate

PASSWORD = "correct horse battery"  # noqa: S105
STAFF_PASSWORD = "a long staff password"  # noqa: S105
RESET_PASSWORD = "a brand new passphrase"  # noqa: S105
ORIGIN = "https://vendors.test"
SIGNUP: dict[str, Any] = {
    "brand_name": "Atelier Rouge",
    "contact_name": "Asha Rao",
    "email": "asha@atelier.test",
    "phone": "+91 98765 43210",
    "product_type": "apparel",
    "price_min_paise": 99_900,
    "price_max_paise": 499_900,
    "password": PASSWORD,
    "terms_accepted": True,
}


@pytest.fixture
async def real_redis() -> AsyncIterator[Redis]:
    url = os.environ.get("REDIS_URL")
    if not url:
        pytest.skip("REDIS_URL is not set")
    client = Redis.from_url(url)
    try:
        await client.ping()
    except Exception:  # noqa: BLE001
        await client.aclose()
        pytest.skip("Redis is not reachable")
    await client.flushdb()  # the suite owns this database
    yield client
    await client.flushdb()
    await client.aclose()


class Network:
    """identity-api on the network: the JWKS document over HTTP, and a count of requests."""

    def __init__(self, identity: Identity) -> None:
        self.identity = identity
        self.requests = 0

        def handler(request: httpx.Request) -> httpx.Response:
            self.requests += 1
            assert str(request.url) == JWKS_URL
            return httpx.Response(200, json=identity.ring.jwks())

        self.client = JwksClient.from_url(JWKS_URL, transport=httpx.MockTransport(handler))


@pytest.fixture
def stack_settings(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        redis_url=os.environ.get("REDIS_URL", settings.redis_url),
        jwt_issuer="https://vendor-api.test",
        cors_allowed_origins=[ORIGIN],
        identity_jwks_url=JWKS_URL,
        identity_issuer="https://identity.test",
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
        refresh_reuse_grace_seconds=0,  # any reuse of a rotated token is theft
    )
    return result


async def refresh(api: Api, token: str) -> httpx.Response:
    api.http.cookies.clear()
    return await api.http.post(
        "/v1/auth/refresh", headers={"Cookie": f"vendor_refresh={token}", "Origin": ORIGIN}
    )


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_the_whole_vendor_and_admin_flow(
    stack_settings: Settings, session: AsyncSession, real_redis: Redis
) -> None:
    identity = Identity()
    network = Network(identity)
    async for api in make_api(stack_settings, session, real_redis, network.client):
        http = api.http
        sender = record_emails(api)

        # --- Signup, then the link in the email ----------------------------------------
        signup = await http.post("/v1/auth/signup", json=SIGNUP)
        assert signup.status_code == 202
        ((to, template, context),) = sender.sent
        assert (to, template) == (EMAIL, EmailTemplate.VERIFY_EMAIL)
        assert (await api.login(EMAIL, PASSWORD)).status_code == 403  # not verified yet
        verify = await http.post("/v1/auth/verify-email", json={"token": context["token"]})
        assert verify.status_code == 204
        assert (
            await http.post("/v1/auth/verify-email", json={"token": context["token"]})
        ).status_code == 400  # a token works once

        # --- Sign in, the current user, refresh, reuse detection, logout -----------------
        login = await api.login(EMAIL, PASSWORD)
        assert login.status_code == 200
        first_cookie, access = token_of(login), login.json()["access_token"]
        me = await http.get("/v1/vendor/me", headers=bearer(access))
        assert me.status_code == 200
        assert (me.json()["user"]["role"], me.json()["vendor"]["status"]) == ("owner", "pending")
        vendor_slug = me.json()["vendor"]["slug"]

        rotated = await refresh(api, first_cookie)
        assert rotated.status_code == 200
        second_cookie = token_of(rotated)
        assert second_cookie != first_cookie
        reuse = await refresh(api, first_cookie)  # the old token again: theft
        assert reuse.status_code == 401
        assert is_cleared(reuse)
        assert (await refresh(api, second_cookie)).status_code == 401  # the family ended too

        again = await api.login(EMAIL, PASSWORD)
        third_cookie = token_of(again)
        api.http.cookies.clear()
        out = await http.post(
            "/v1/auth/logout",
            headers={"Cookie": f"vendor_refresh={third_cookie}", "Origin": ORIGIN},
        )
        assert out.status_code == 204
        assert (await refresh(api, third_cookie)).status_code == 401

        # --- A staff member: invite, set a password, sign in ------------------------------
        access = (await api.login(EMAIL, PASSWORD)).json()["access_token"]
        invited = await http.post(
            "/v1/vendor/users", json={"email": "staff@atelier.test"}, headers=bearer(access)
        )
        assert invited.status_code == 202
        invite_token = sender.tokens()[-1]
        assert sender.sent[-1][1] == EmailTemplate.STAFF_INVITE
        assert (await api.login("staff@atelier.test", STAFF_PASSWORD)).status_code == 401
        assert (
            await http.post(
                "/v1/auth/set-password", json={"token": invite_token, "password": STAFF_PASSWORD}
            )
        ).status_code == 204
        staff = await api.login("staff@atelier.test", STAFF_PASSWORD)
        assert staff.status_code == 200
        assert staff.json()["user"]["role"] == "staff"
        assert (
            await http.get("/v1/vendor/users", headers=bearer(staff.json()["access_token"]))
        ).status_code == 403  # only the owner manages the team

        # --- Forgot password: the old sessions end ---------------------------------------
        owner_session = token_of(await api.login(EMAIL, PASSWORD))
        assert (
            await http.post("/v1/auth/forgot-password", json={"email": EMAIL})
        ).status_code == 202
        reset_token = sender.tokens()[-1]
        assert str(sender.sent[-1][1]) == EmailTemplate.PASSWORD_RESET.value
        assert (
            await http.post(
                "/v1/auth/set-password", json={"token": reset_token, "password": RESET_PASSWORD}
            )
        ).status_code == 204
        assert (await refresh(api, owner_session)).status_code == 401  # signed out everywhere
        assert (await api.login(EMAIL, PASSWORD)).status_code == 401
        owner = await api.login(EMAIL, RESET_PASSWORD)
        assert owner.status_code == 200
        owner_access = owner.json()["access_token"]

        # --- An admin: identity-api's token, verified through the live JWKS --------------
        assert network.requests == 0  # nothing fetched yet
        admin_token = identity.token(["vendor_reviewer"])
        admin = await http.get("/v1/admin/me", headers=bearer(admin_token))
        assert admin.status_code == 200
        assert admin.json()["roles"] == ["vendor_reviewer"]
        assert network.requests == 1  # one fetch, over HTTP, on the first admin token
        await http.get("/v1/admin/me", headers=bearer(admin_token))
        assert network.requests == 1  # then cached

        # --- The two groups refuse each other's tokens -----------------------------------
        assert (await http.get("/v1/admin/me", headers=bearer(owner_access))).status_code == 401
        assert (await http.get("/v1/vendor/me", headers=bearer(admin_token))).status_code == 401
        assert (await http.get("/v1/vendor/users", headers=bearer(admin_token))).status_code == 401

        # --- What is in Redis ------------------------------------------------------------
        keys = [key.decode() async for key in real_redis.scan_iter("*")]
        assert keys
        assert all(key.startswith("vendor:") for key in keys)  # never identity-api's prefix
        assert not any(vendor_slug in key or EMAIL in key for key in keys)  # no plain subjects
        assert cookie_of(admin) is None  # the admin API sets no cookie


# --- Key rotation with a token in flight (the runbook) -----------------------------------


def make_key() -> str:
    return pem_of(generate_private_key()).decode()


async def kid_of(token: str) -> str:
    return str(jwt.get_unverified_header(token)["kid"])


async def test_key_rotation_with_a_token_in_flight(
    settings: Settings,
    override: Any,
    session: AsyncSession,
) -> None:
    """The steps of docs/runbooks/jwt-key-rotation.md, with a token issued under the old key
    that stays valid until the old key is retired."""
    from fakeredis import FakeAsyncRedis

    old, new = make_key(), make_key()
    hasher = PasswordService(password_config(override(settings, argon2_time_cost=1)))
    await make_account(session, hasher)

    def stage(keys: dict[str, str], signing: str) -> Settings:
        result: Settings = override(
            settings,
            jwt_issuer="https://vendor-api.test",
            jwt_keys=json.dumps(keys),
            jwt_signing_kid=signing,
            argon2_memory_cost_kib=8,
            argon2_time_cost=1,
        )
        return result

    async def sign_in_and_check(
        config: Settings, in_flight: str | None
    ) -> tuple[str, list[str], int | None]:
        """Rolls the service to `config`: signs in, reads the JWKS, and checks the old token."""
        fake = FakeAsyncRedis()
        try:
            async for api in make_api(config, session, fake):
                login = await api.login(EMAIL, PASSWORD)
                assert login.status_code == 200
                token = login.json()["access_token"]
                jwks = (await api.http.get("/.well-known/jwks.json")).json()
                status = None
                if in_flight is not None:
                    status = (
                        await api.http.get("/v1/vendor/me", headers=bearer(in_flight))
                    ).status_code
                assert (
                    await api.http.get("/v1/vendor/me", headers=bearer(token))
                ).status_code == 200
                return token, [key["kid"] for key in jwks["keys"]], status
        finally:
            await fake.aclose()
        raise AssertionError("unreachable")

    # Step 0: only OLD. A token is issued, and is in flight from here on.
    token_old, kids, _ = await sign_in_and_check(stage({"OLD": old}, "OLD"), None)
    assert await kid_of(token_old) == "OLD"
    assert kids == ["OLD"]

    # Steps 2 to 4: NEW is published, OLD still signs. Nothing changes for the token.
    token, kids, status = await sign_in_and_check(stage({"OLD": old, "NEW": new}, "OLD"), token_old)
    assert sorted(kids) == ["NEW", "OLD"]
    assert await kid_of(token) == "OLD"
    assert status == 200

    # Step 5: NEW signs, OLD is still published: the in-flight token still verifies.
    token_new, kids, status = await sign_in_and_check(
        stage({"OLD": old, "NEW": new}, "NEW"), token_old
    )
    assert sorted(kids) == ["NEW", "OLD"]
    assert await kid_of(token_new) == "NEW"
    assert status == 200

    # Step 7: OLD is retired. The in-flight token is rejected; new tokens are fine.
    token_after, kids, status = await sign_in_and_check(stage({"NEW": new}, "NEW"), token_old)
    assert kids == ["NEW"]
    assert status == 401
    assert await kid_of(token_after) == "NEW"


async def test_an_emergency_rotation_ends_every_token_of_the_old_key(
    settings: Settings, override: Any, session: AsyncSession
) -> None:
    from fakeredis import FakeAsyncRedis

    old, new = make_key(), make_key()
    hasher = PasswordService(password_config(override(settings, argon2_time_cost=1)))
    await make_account(session, hasher)

    def config(key_id: str, pem: str) -> Settings:
        result: Settings = override(
            settings,
            jwt_issuer="https://vendor-api.test",
            jwt_keys=json.dumps({key_id: pem}),
            jwt_signing_kid=key_id,
            argon2_memory_cost_kib=8,
            argon2_time_cost=1,
        )
        return result

    fake = FakeAsyncRedis()
    try:
        async for before in make_api(config("OLD", old), session, fake):
            leaked = (await before.login(EMAIL, PASSWORD)).json()["access_token"]
        async for after in make_api(config("NEW", new), session, fake):
            refused = await after.http.get("/v1/vendor/me", headers=bearer(leaked))
            assert refused.status_code == 401  # whoever holds the old key gets nowhere
            assert (await after.login(EMAIL, PASSWORD)).status_code == 200
    finally:
        await fake.aclose()
