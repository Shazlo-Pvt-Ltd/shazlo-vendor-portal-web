import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis, FakeServer
from shazlo_security.passwords import PasswordService
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import (
    EMAIL,
    NEW_PASSWORD,
    ORIGIN,
    PASSWORD,
    Account,
    Api,
    make_account,
    make_api,
    redis_keys,
    token_of,
)

from vendor_api.core.security import RATE_LIMIT_KEY_PREFIX, password_config
from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorUserRole

IP_A = "203.0.113.10"
IP_B = "203.0.113.20"
IP_C = "198.51.100.30"
SIGNUP: dict[str, Any] = {
    "brand_name": "Atelier Rouge",
    "contact_name": "Asha Rao",
    "email": "new.owner@brand.test",
    "phone": "+91 98765 43210",
    "product_type": "apparel",
    "price_min_paise": 99_900,
    "price_max_paise": 499_900,
    "password": PASSWORD,
    "terms_accepted": True,
}
# Every limit is high; a test lowers only the one it is about.
LIMITED = [
    "login_ip",
    "login_email",
    "login_email_global",
    "signup_ip",
    "signup_email",
    "resend_verification_ip",
    "resend_verification_email",
    "verify_email_ip",
    "refresh_ip",
    "refresh_session",
    "change_password_user",
]
GENEROUS = {f"rate_limit_{name}": "1000/60" for name in LIMITED}


@pytest.fixture
def base_settings(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        jwt_issuer="https://vendor-api.test",
        cors_allowed_origins=[ORIGIN],
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
        refresh_reuse_grace_seconds=0,
        trusted_proxies=["127.0.0.0/8"],  # the test client is the proxy and sets X-Forwarded-For
        rate_limit_hmac_key="k" * 32,
        **GENEROUS,
    )
    return result


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture
def hasher(base_settings: Settings) -> PasswordService:
    return PasswordService(password_config(base_settings))


@pytest.fixture
async def account(session: AsyncSession, hasher: PasswordService) -> Account:
    return await make_account(session, hasher)


@asynccontextmanager
async def serve(
    base: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    **limits: Any,
) -> AsyncIterator[Api]:
    generator = make_api(override(base, **limits), session, redis)
    api = await anext(generator)
    try:
        yield api
    finally:
        await generator.aclose()


async def post(
    api: Api,
    path: str,
    json: dict[str, Any] | None = None,
    ip: str = IP_A,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    api.http.cookies.clear()
    return await api.http.post(
        path, json=json or {}, headers={"X-Forwarded-For": ip, **(headers or {})}
    )


async def login(api: Api, password: str = PASSWORD, ip: str = IP_A, email: str = EMAIL) -> Any:
    return await post(api, "/v1/auth/login", {"email": email, "password": password}, ip)


def listen(caplog: pytest.LogCaptureFixture) -> None:
    """`create_app` replaces the root logger's handlers (its JSON log format), which removes
    pytest's capture handler when the app is built inside the test; put it back."""
    root = logging.getLogger()
    if caplog.handler not in root.handlers:
        root.addHandler(caplog.handler)


def retry_after(response: httpx.Response) -> int:
    return int(response.headers["retry-after"])


async def vendor_count(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(Vendor)) or 0)


# --- Login -------------------------------------------------------------------------------


async def test_failed_logins_for_one_email_are_stopped_even_from_different_ips(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_login_email_global="3/60"
    ) as api:
        for ip in (IP_A, IP_B, IP_C):
            assert (await login(api, "wrong password!", ip)).status_code == 401
        # A fourth network, and this time with the right password: still stopped.
        blocked = await login(api, PASSWORD, "192.0.2.77")
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "rate_limited"


async def test_the_per_ip_login_limit_does_not_block_another_ip(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_login_ip="2/60") as api:
        assert (await login(api, ip=IP_A)).status_code == 200
        assert (await login(api, ip=IP_A)).status_code == 200
        assert (await login(api, ip=IP_A)).status_code == 429
        assert (await login(api, ip=IP_B)).status_code == 200


async def test_failures_from_one_network_do_not_lock_the_vendor_out_of_another(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_login_email="2/60") as api:
        assert (await login(api, "wrong password!", IP_A)).status_code == 401
        assert (await login(api, "wrong password!", IP_A)).status_code == 401
        assert (await login(api, "wrong password!", IP_A)).status_code == 429
        # The same email from elsewhere is a different pair.
        assert (await login(api, PASSWORD, IP_B)).status_code == 200


async def test_a_successful_login_clears_the_pair_counter(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_login_email="2/60") as api:
        assert (await login(api, "wrong password!")).status_code == 401
        assert (await login(api, PASSWORD)).status_code == 200  # clears the count
        assert (await login(api, "wrong password!")).status_code == 401
        assert (await login(api, "wrong password!")).status_code == 401
        assert (await login(api, "wrong password!")).status_code == 429


async def test_retry_after_is_the_time_left_in_the_window(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_login_ip="1/120") as api:
        await login(api)
        blocked = await login(api)
    assert blocked.status_code == 429
    assert 119 <= retry_after(blocked) <= 120
    assert blocked.headers["cache-control"] == "no-store"
    assert blocked.json()["error"]["message"]
    assert "set-cookie" not in blocked.headers


async def test_the_window_resets(
    base_settings: Settings, override: Any, session: AsyncSession, redis: FakeAsyncRedis
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_verify_email_ip="1/1"
    ) as api:
        token = {"token": "never-issued"}
        assert (await post(api, "/v1/auth/verify-email", token)).status_code == 400
        assert (await post(api, "/v1/auth/verify-email", token)).status_code == 429
        await asyncio.sleep(1.2)
        assert (await post(api, "/v1/auth/verify-email", token)).status_code == 400


async def test_the_header_cannot_be_spoofed_unless_the_peer_is_a_trusted_proxy(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(
        base_settings,
        override,
        session,
        redis,
        trusted_proxies=[],  # nobody is trusted: the header is ignored
        rate_limit_login_ip="2/60",
    ) as api:
        statuses = [(await login(api, ip=ip)).status_code for ip in (IP_A, IP_B, IP_C)]
    assert statuses == [200, 200, 429]  # three "different" clients, one real peer


# --- Signup ------------------------------------------------------------------------------


async def test_a_signup_flood_from_one_ip_is_stopped(
    base_settings: Settings, override: Any, session: AsyncSession, redis: FakeAsyncRedis
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_signup_ip="2/60") as api:
        for number in range(2):
            response = await post(
                api, "/v1/auth/signup", {**SIGNUP, "email": f"owner{number}@brand.test"}
            )
            assert response.status_code == 202
        flood = await post(api, "/v1/auth/signup", {**SIGNUP, "email": "owner9@brand.test"})
        assert flood.status_code == 429
        assert flood.headers["retry-after"]
        assert await vendor_count(session) == 2  # nothing was created for the blocked one
        # Another network is not affected.
        other = await post(
            api, "/v1/auth/signup", {**SIGNUP, "email": "owner8@brand.test"}, ip=IP_B
        )
        assert other.status_code == 202


async def test_one_address_cannot_be_signed_up_for_again_and_again(
    base_settings: Settings, override: Any, session: AsyncSession, redis: FakeAsyncRedis
) -> None:
    """The "you already have an account" email must not become a way to mail-bomb someone."""
    async with serve(
        base_settings, override, session, redis, rate_limit_signup_email="2/60"
    ) as api:
        first = await post(api, "/v1/auth/signup", SIGNUP, ip=IP_A)
        again = await post(
            api, "/v1/auth/signup", {**SIGNUP, "email": "NEW.Owner@Brand.TEST"}, ip=IP_B
        )
        blocked = await post(api, "/v1/auth/signup", SIGNUP, ip=IP_C)
    assert (first.status_code, again.status_code) == (202, 202)
    assert blocked.status_code == 429


async def test_the_signup_limit_looks_the_same_for_a_registered_address(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    """A limit that only applied to registered addresses would reveal them."""
    async with serve(
        base_settings, override, session, redis, rate_limit_signup_email="1/60"
    ) as api:
        registered = [
            (await post(api, "/v1/auth/signup", {**SIGNUP, "email": EMAIL}, ip=ip)).status_code
            for ip in (IP_A, IP_B)
        ]
        unknown = [
            (await post(api, "/v1/auth/signup", SIGNUP, ip=ip)).status_code for ip in (IP_A, IP_B)
        ]
    assert registered == unknown == [202, 429]


# --- Resend and verify -------------------------------------------------------------------


@pytest.mark.parametrize("registered", [True, False])
async def test_resend_is_limited_per_address_whether_or_not_it_exists(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    hasher: PasswordService,
    registered: bool,
) -> None:
    if registered:
        await make_account(session, hasher, verified=False)
    email = EMAIL if registered else "nobody@nowhere.test"
    async with serve(
        base_settings, override, session, redis, rate_limit_resend_verification_email="2/60"
    ) as api:
        statuses = [
            (await post(api, "/v1/auth/resend-verification", {"email": email}, ip=ip)).status_code
            for ip in (IP_A, IP_B, IP_C)
        ]
    assert statuses == [202, 202, 429]


async def test_resend_is_limited_per_ip(
    base_settings: Settings, override: Any, session: AsyncSession, redis: FakeAsyncRedis
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_resend_verification_ip="2/60"
    ) as api:
        statuses = [
            (await post(api, "/v1/auth/resend-verification", {"email": f"a{n}@b.test"})).status_code
            for n in range(3)
        ]
        other = await post(api, "/v1/auth/resend-verification", {"email": "c@d.test"}, ip=IP_B)
    assert statuses == [202, 202, 429]
    assert other.status_code == 202


async def test_verify_email_is_limited_per_ip(
    base_settings: Settings, override: Any, session: AsyncSession, redis: FakeAsyncRedis
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_verify_email_ip="2/60"
    ) as api:
        body = {"token": "guess"}
        statuses = [(await post(api, "/v1/auth/verify-email", body)).status_code for _ in range(3)]
        other = await post(api, "/v1/auth/verify-email", body, ip=IP_B)
    assert statuses == [400, 400, 429]
    assert other.status_code == 400


# --- Refresh -----------------------------------------------------------------------------


async def refresh(api: Api, token: str, ip: str = IP_A) -> httpx.Response:
    api.http.cookies.clear()
    return await api.http.post(
        "/v1/auth/refresh",
        headers={"Cookie": f"vendor_refresh={token}", "X-Forwarded-For": ip},
    )


async def test_a_rate_limited_refresh_keeps_its_cookie_and_its_token(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_refresh_ip="2/60") as api:
        first = await refresh(api, token_of(await login(api)))
        second = await refresh(api, token_of(first))
        blocked = await refresh(api, token_of(second))
        assert [first.status_code, second.status_code, blocked.status_code] == [200, 200, 429]
        assert "set-cookie" not in blocked.headers  # the cookie is not cleared
        # The refused request did not use the token up: from another network it still works.
        assert (await refresh(api, token_of(second), ip=IP_B)).status_code == 200


async def test_refresh_is_limited_per_session_even_from_different_ips(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_refresh_session="2/60"
    ) as api:
        token = token_of(await login(api))
        statuses = []
        for ip in (IP_A, IP_B, IP_C):
            response = await refresh(api, token, ip)
            statuses.append(response.status_code)
            if response.status_code == 200:
                token = token_of(response)
    assert statuses == [200, 200, 429]


# --- Change password ---------------------------------------------------------------------


async def change_password(api: Api, access: str, current: str, new: str = NEW_PASSWORD) -> Any:
    return await api.http.post(
        "/v1/auth/change-password",
        json={"current_password": current, "new_password": new},
        headers={"Authorization": f"Bearer {access}", "X-Forwarded-For": IP_A},
    )


async def test_guessing_the_current_password_is_limited(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_change_password_user="2/60"
    ) as api:
        access = (await login(api)).json()["access_token"]
        wrong = [(await change_password(api, access, "not mine")).status_code for _ in range(2)]
        blocked = await change_password(api, access, PASSWORD)  # even the right one
    assert wrong == [400, 400]
    assert blocked.status_code == 429


async def test_a_weak_new_password_does_not_use_up_the_limit(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(
        base_settings, override, session, redis, rate_limit_change_password_user="2/60"
    ) as api:
        access = (await login(api)).json()["access_token"]
        statuses = [
            (await change_password(api, access, PASSWORD, new="short")).status_code
            for _ in range(5)
        ]
    assert statuses == [422] * 5


# --- Redis is down -----------------------------------------------------------------------


@pytest.fixture
async def dead_redis() -> AsyncIterator[FakeAsyncRedis]:
    server = FakeServer()
    server.connected = False
    client = FakeAsyncRedis(server=server)
    yield client
    await client.aclose()


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/v1/auth/login", {"email": EMAIL, "password": PASSWORD}),
        ("/v1/auth/signup", SIGNUP),
        ("/v1/auth/resend-verification", {"email": EMAIL}),
    ],
    ids=["login", "signup", "resend_verification"],
)
async def test_endpoints_that_check_passwords_or_send_email_fail_closed(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    dead_redis: FakeAsyncRedis,
    caplog: pytest.LogCaptureFixture,
    path: str,
    payload: dict[str, Any],
) -> None:
    async with serve(base_settings, override, session, dead_redis) as api:
        listen(caplog)
        with caplog.at_level(logging.WARNING):
            response = await post(api, path, payload)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "rate_limiter_unavailable"
        assert await vendor_count(session) == 0  # signup created nothing
    assert any("rate limiter unavailable" in r.getMessage() for r in caplog.records)
    assert EMAIL not in "\n".join(r.getMessage() for r in caplog.records)


async def test_change_password_fails_closed(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    dead_redis: FakeAsyncRedis,
    hasher: PasswordService,
) -> None:
    account = await make_account(session, hasher)
    async with serve(base_settings, override, session, dead_redis) as api:
        # A token made directly: signing in needs Redis too.
        access = api.app.state.vendor_tokens.issue(
            user_id=account.user.id, vendor_id=account.vendor.id, role=VendorUserRole.OWNER
        ).token
        response = await change_password(api, access, PASSWORD)
    assert response.status_code == 503


async def test_verify_email_fails_open(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    dead_redis: FakeAsyncRedis,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A 256-bit token cannot be guessed at any rate, so availability comes first."""
    async with serve(base_settings, override, session, dead_redis) as api:
        listen(caplog)
        with caplog.at_level(logging.WARNING):
            response = await post(api, "/v1/auth/verify-email", {"token": "never-issued"})
    assert response.status_code == 400  # the normal answer, not 503
    assert any("rate limiter unavailable, allowing" in r.getMessage() for r in caplog.records)


# --- What Redis holds --------------------------------------------------------------------


async def test_redis_holds_no_email_and_no_ip_in_plain_text(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis) as api:
        await login(api, "wrong password!", IP_A)
        await login(api, PASSWORD, IP_B)
        await post(api, "/v1/auth/signup", SIGNUP, ip=IP_C)
        await post(api, "/v1/auth/resend-verification", {"email": EMAIL}, ip=IP_A)
        await post(api, "/v1/auth/verify-email", {"token": "guess"}, ip=IP_B)
        keys = [key for key in await redis_keys(redis) if ":rl:" in key]
    assert keys
    text = "\n".join(keys).lower()
    for secret in ("asha", "atelier", "new.owner", "brand.test", "203.0.113", "198.51.100", "@"):
        assert secret not in text
    for key in keys:
        assert len(key.rsplit(":", 1)[1]) == 64  # a hex HMAC-SHA256


async def test_the_keys_are_the_vendors_own_and_one_per_endpoint_and_scope(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis) as api:
        # A failed login: a successful one would clear the (email, IP) counter.
        await login(api, "wrong password!")
        await post(api, "/v1/auth/signup", SIGNUP)
        keys = [key for key in await redis_keys(redis) if ":rl:" in key]
    assert RATE_LIMIT_KEY_PREFIX == "vendor:rl:"
    assert all(key.startswith(RATE_LIMIT_KEY_PREFIX) for key in keys)
    assert not any(key.startswith("identity:") for key in keys)
    scopes = sorted(key.removeprefix(RATE_LIMIT_KEY_PREFIX).rsplit(":", 1)[0] for key in keys)
    assert scopes == [
        "login:email",
        "login:email_ip",
        "login:ip",
        "signup:email",
        "signup:ip",
    ]


async def test_one_endpoints_limit_never_blocks_another(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    account: Account,
) -> None:
    async with serve(base_settings, override, session, redis, rate_limit_login_ip="1/60") as api:
        await login(api)
        assert (await login(api)).status_code == 429
        signup = await post(api, "/v1/auth/signup", SIGNUP)
    assert signup.status_code == 202


# --- Two instances -----------------------------------------------------------------------


async def test_the_limits_hold_across_two_instances_sharing_redis(
    base_settings: Settings,
    override: Any,
    session: AsyncSession,
    redis: FakeAsyncRedis,
) -> None:
    async with (
        serve(base_settings, override, session, redis, rate_limit_signup_ip="3/60") as first,
        serve(base_settings, override, session, redis, rate_limit_signup_ip="3/60") as second,
    ):
        statuses = []
        for number, instance in enumerate((first, second, first, second)):
            response = await post(
                instance, "/v1/auth/signup", {**SIGNUP, "email": f"o{number}@brand.test"}
            )
            statuses.append(response.status_code)
    assert statuses == [202, 202, 202, 429]
