from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from http.cookies import SimpleCookie

import httpx
import pytest
from fakeredis import FakeAsyncRedis, FakeServer
from shazlo_security.passwords import PasswordService
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.app import create_app
from identity_api.core.security import password_config
from identity_api.core.settings import Settings
from identity_api.db.models import Admin, Role
from identity_api.db.session import get_session

PASSWORD = "correct horse battery"
EMAIL = "reviewer@shazlo.test"
# The shell's origin: refresh and logout require an allowed Origin (CSRF guard).
ORIGIN = "https://shell.test"


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


# --- Endpoints ---------------------------------------------------------------------------

TRUST_LOCAL = ["127.0.0.0/8"]


@pytest.fixture
def api_settings(settings: Settings, override: Callable[..., Settings]) -> Settings:
    return override(
        settings,
        jwt_issuer="https://identity.test",
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
        # The test client connects from 127.0.0.1, so a trusted proxy there lets tests choose
        # the client IP with X-Forwarded-For.
        trusted_proxies=TRUST_LOCAL,
        rate_limit_login_ip="1000/60",
        rate_limit_login_email="3/60",
        rate_limit_login_email_global="1000/60",
        rate_limit_refresh_ip="1000/60",
        rate_limit_refresh_session="1000/60",
        rate_limit_token_ip="1000/60",
        rate_limit_token_admin="1000/60",
        rate_limit_change_password_admin="1000/60",
        rate_limit_hmac_key="k" * 32,
        cors_allowed_origins=[ORIGIN],
    )


@asynccontextmanager
async def serve(
    settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncIterator[httpx.AsyncClient]:
    """One app instance. Several of them can share a Redis, like replicas would."""
    app = create_app(settings, readiness_checks={}, redis=redis)

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = test_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="https://identity.test",
        headers={"Origin": ORIGIN},
    ) as http:
        yield http


@pytest.fixture
async def client(
    api_settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncIterator[httpx.AsyncClient]:
    async with serve(api_settings, session, redis) as http:
        yield http


@pytest.fixture
async def admin(session: AsyncSession, api_settings: Settings) -> Admin:
    reviewer = Admin(
        email=EMAIL,
        password_hash=await PasswordService(password_config(api_settings)).hash(PASSWORD),
        display_name="Reviewer",
        must_change_password=False,
        roles=[await session.get_one(Role, "vendor_reviewer")],
    )
    session.add(reviewer)
    await session.commit()
    return reviewer


async def sign_in(
    client: httpx.AsyncClient,
    email: str = EMAIL,
    password: str = PASSWORD,
    ip: str = "198.51.100.1",
) -> httpx.Response:
    client.cookies.clear()
    return await client.post(
        "/v1/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )


def retry_after(response: httpx.Response) -> int:
    return int(response.headers["retry-after"])


def refresh_cookie(response: httpx.Response) -> str | None:
    for header in response.headers.get_list("set-cookie"):
        cookie: SimpleCookie = SimpleCookie()
        cookie.load(header)
        if "identity_refresh" in cookie:
            return cookie["identity_refresh"].value
    return None


async def test_n_failed_logins_lock_the_email_from_that_ip_only(
    client: httpx.AsyncClient, admin: Admin
) -> None:
    attacker = "198.51.100.66"
    for _ in range(3):
        failed = await sign_in(client, password="wrong password!!", ip=attacker)
        assert failed.status_code == 401
    # Even the right password is refused from that IP for the window.
    blocked = await sign_in(client, ip=attacker)
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert 1 <= retry_after(blocked) <= 60
    assert retry_after(blocked) >= 55  # just started, so nearly the whole window
    assert blocked.headers["cache-control"] == "no-store"
    assert refresh_cookie(blocked) is None
    # The admin, signing in from another network, is not locked out by the attacker.
    assert (await sign_in(client, ip="203.0.113.77")).status_code == 200


async def test_the_global_email_limit_holds_across_ips(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    capped = override(api_settings, rate_limit_login_email_global="4/60")
    async with serve(capped, session, redis) as http:
        # One guess from each of four IPs: each (email, IP) counter is far from its limit.
        for number in range(4):
            failed = await sign_in(http, password="wrong password!!", ip=f"198.51.100.{number}")
            assert failed.status_code == 401
        # A fifth IP, even with the right password: the email is over its global limit.
        blocked = await sign_in(http, ip="203.0.113.77")
        assert blocked.status_code == 429
        assert 1 <= retry_after(blocked) <= 60


async def test_a_successful_login_does_not_clear_the_global_email_counter(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    capped = override(api_settings, rate_limit_login_email_global="3/60")
    wrong = "wrong password!!"
    async with serve(capped, session, redis) as http:
        assert (await sign_in(http, password=wrong, ip="198.51.100.1")).status_code == 401
        assert (await sign_in(http, ip="198.51.100.2")).status_code == 200
        assert (await sign_in(http, password=wrong, ip="198.51.100.3")).status_code == 401
        assert (await sign_in(http, ip="198.51.100.4")).status_code == 429


async def test_ipv6_clients_are_limited_per_64(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_login_ip="2/60")
    async with serve(strict, session, redis) as http:
        # New addresses in the same /64 (and different emails) share one counter.
        results = [
            (await sign_in(http, f"user{n}@shazlo.test", "x", ip=f"2001:db8:1:2::{n + 1}"))
            for n in range(3)
        ]
        assert [r.status_code for r in results] == [401, 401, 429]
        # Another /64 is another client.
        other = await sign_in(http, "user9@shazlo.test", "x", ip="2001:db8:1:3::1")
        assert other.status_code == 401


async def test_ipv4_mapped_ipv6_counts_as_the_ipv4_address(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_login_ip="2/60")
    async with serve(strict, session, redis) as http:
        ips = ["203.0.113.9", "::ffff:203.0.113.9", "::ffff:cb00:7109"]
        results = [
            (await sign_in(http, f"user{n}@shazlo.test", "x", ip=ip)).status_code
            for n, ip in enumerate(ips)
        ]
    assert results == [401, 401, 429]


async def test_unknown_emails_are_limited_the_same_way(client: httpx.AsyncClient) -> None:
    statuses = [(await sign_in(client, "nobody@shazlo.test", "x")).status_code for _ in range(5)]
    assert statuses == [401, 401, 401, 429, 429]


async def test_a_successful_login_clears_the_email_counter(
    client: httpx.AsyncClient, admin: Admin
) -> None:
    for _ in range(2):
        assert (await sign_in(client, password="wrong password!!")).status_code == 401
    assert (await sign_in(client)).status_code == 200
    for _ in range(2):
        assert (await sign_in(client, password="wrong password!!")).status_code == 401
    assert (await sign_in(client)).status_code == 200


async def test_emails_have_separate_counters(client: httpx.AsyncClient, admin: Admin) -> None:
    for _ in range(3):
        await sign_in(client, password="wrong password!!")
    assert (await sign_in(client)).status_code == 429
    assert (await sign_in(client, "someone.else@shazlo.test", "x")).status_code == 401


async def test_the_email_counter_ignores_letter_case_and_spaces(
    client: httpx.AsyncClient, admin: Admin
) -> None:
    for variant in (EMAIL, EMAIL.upper(), f" {EMAIL} "):
        assert (await sign_in(client, variant, "wrong password!!")).status_code == 401
    assert (await sign_in(client, EMAIL.title())).status_code == 429


async def test_login_is_limited_per_ip(
    client: httpx.AsyncClient,
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_login_ip="2/60")
    async with serve(strict, session, redis) as limited:
        # Different emails, so only the IP counter can stop this.
        results = [
            (await sign_in(limited, f"user{n}@shazlo.test", "x", ip="203.0.113.50")).status_code
            for n in range(4)
        ]
        assert results == [401, 401, 429, 429]
        # Another IP is unaffected.
        other = await sign_in(limited, "user9@shazlo.test", "x", ip="203.0.113.51")
        assert other.status_code == 401


async def test_a_forged_forwarded_header_does_not_dodge_the_ip_limit(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    override: Callable[..., Settings],
) -> None:
    untrusting = override(api_settings, trusted_proxies=[], rate_limit_login_ip="2/60")
    async with serve(untrusting, session, redis) as http:
        results = [
            (await sign_in(http, f"user{n}@shazlo.test", "x", ip=f"203.0.113.{n}")).status_code
            for n in range(4)
        ]
    assert results == [401, 401, 429, 429]


async def test_limits_hold_across_two_instances_sharing_redis(
    api_settings: Settings, session: AsyncSession, redis: FakeAsyncRedis, admin: Admin
) -> None:
    async with (
        serve(api_settings, session, redis) as one,
        serve(api_settings, session, redis) as two,
    ):
        assert (await sign_in(one, password="wrong password!!")).status_code == 401
        assert (await sign_in(two, password="wrong password!!")).status_code == 401
        assert (await sign_in(one, password="wrong password!!")).status_code == 401
        # The fourth attempt reaches the other instance, which has seen only one of the three.
        assert (await sign_in(two)).status_code == 429
        assert (await sign_in(one)).status_code == 429


async def test_redis_holds_no_email_or_ip_after_logins(
    client: httpx.AsyncClient, admin: Admin, redis: FakeAsyncRedis
) -> None:
    await sign_in(client, password="wrong password!!", ip="198.51.100.23")
    keys = [key.decode() async for key in redis.scan_iter("identity:rl:*")]
    assert len(keys) == 3  # ip, (email, ip) and email
    assert all(
        "reviewer" not in key and "shazlo" not in key and "198.51" not in key for key in keys
    )


async def test_login_fails_closed_when_redis_is_down(
    api_settings: Settings, session: AsyncSession, admin: Admin
) -> None:
    server = FakeServer()
    redis = FakeAsyncRedis(server=server)
    async with serve(api_settings, session, redis) as http:
        server.connected = False
        response = await sign_in(http)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "rate_limiter_unavailable"
    assert refresh_cookie(response) is None


async def test_token_exchange_fails_open_when_redis_is_down(
    api_settings: Settings, session: AsyncSession, admin: Admin
) -> None:
    server = FakeServer()
    redis = FakeAsyncRedis(server=server)
    async with serve(api_settings, session, redis) as http:
        headers = {"Authorization": f"Bearer {(await sign_in(http)).json()['access_token']}"}
        server.connected = False
        response = await http.post(
            "/v1/auth/token", headers=headers, json={"audience": "vendor-api"}
        )
    assert response.status_code == 200


async def test_change_password_fails_closed_when_redis_is_down(
    api_settings: Settings, session: AsyncSession, admin: Admin
) -> None:
    server = FakeServer()
    redis = FakeAsyncRedis(server=server)
    async with serve(api_settings, session, redis) as http:
        headers = {"Authorization": f"Bearer {(await sign_in(http)).json()['access_token']}"}
        server.connected = False
        response = await http.post(
            "/v1/auth/change-password",
            headers=headers,
            json={"current_password": PASSWORD, "new_password": "another long passphrase"},
        )
    assert response.status_code == 503


async def test_token_exchange_is_limited_per_admin_and_per_ip(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_token_admin="2/60", rate_limit_token_ip="3/60")
    async with serve(strict, session, redis) as http:
        headers = {"Authorization": f"Bearer {(await sign_in(http)).json()['access_token']}"}

        async def exchange(ip: str) -> httpx.Response:
            return await http.post(
                "/v1/auth/token",
                headers={**headers, "X-Forwarded-For": ip},
                json={"audience": "vendor-api"},
            )

        assert (await exchange("203.0.113.1")).status_code == 200
        assert (await exchange("203.0.113.2")).status_code == 200
        blocked = await exchange("203.0.113.3")  # a new IP, but the admin is over the limit
        assert blocked.status_code == 429
        assert 1 <= retry_after(blocked) <= 60


async def test_token_exchange_ip_limit(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_token_ip="1/60")
    async with serve(strict, session, redis) as http:
        headers = {"Authorization": f"Bearer {(await sign_in(http)).json()['access_token']}"}
        body = {"audience": "vendor-api"}
        assert (await http.post("/v1/auth/token", headers=headers, json=body)).status_code == 200
        assert (await http.post("/v1/auth/token", headers=headers, json=body)).status_code == 429


async def test_refresh_is_limited_per_session_and_keeps_the_cookie(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_refresh_session="2/60")
    async with serve(strict, session, redis) as http:
        token = refresh_cookie(await sign_in(http))
        assert token is not None
        for _ in range(2):
            http.cookies.clear()
            response = await http.post(
                "/v1/auth/refresh", headers={"Cookie": f"identity_refresh={token}"}
            )
            assert response.status_code == 200
            token = refresh_cookie(response)  # rotated: a new token, the same family
            assert token is not None
        http.cookies.clear()
        blocked = await http.post(
            "/v1/auth/refresh", headers={"Cookie": f"identity_refresh={token}"}
        )
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "rate_limited"
        assert 1 <= retry_after(blocked) <= 60
        # The limit says nothing about the token, so the cookie is not cleared.
        assert "identity_refresh" not in blocked.headers.get("set-cookie", "")


async def test_refresh_is_limited_per_ip_even_without_a_cookie(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_refresh_ip="2/60")
    async with serve(strict, session, redis) as http:
        statuses = [(await http.post("/v1/auth/refresh")).status_code for _ in range(4)]
    assert statuses == [401, 401, 429, 429]


async def test_change_password_is_limited_per_admin(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    strict = override(api_settings, rate_limit_change_password_admin="2/60")
    async with serve(strict, session, redis) as http:
        headers = {"Authorization": f"Bearer {(await sign_in(http)).json()['access_token']}"}
        body = {"current_password": "not the password", "new_password": "another long passphrase"}
        statuses = [
            (await http.post("/v1/auth/change-password", headers=headers, json=body)).status_code
            for _ in range(3)
        ]
        assert statuses == [400, 400, 429]
        # Even the right current password is refused until the window is over.
        body["current_password"] = PASSWORD
        blocked = await http.post("/v1/auth/change-password", headers=headers, json=body)
        assert blocked.status_code == 429
        assert 1 <= retry_after(blocked) <= 60


async def test_policy_rejections_do_not_use_up_the_change_password_limit(
    api_settings: Settings,
    session: AsyncSession,
    redis: FakeAsyncRedis,
    admin: Admin,
    override: Callable[..., Settings],
) -> None:
    """A new admin trying passwords the policy rejects must not be locked out."""
    strict = override(api_settings, rate_limit_change_password_admin="2/60")
    async with serve(strict, session, redis) as http:
        headers = {"Authorization": f"Bearer {(await sign_in(http)).json()['access_token']}"}

        async def change(current: str, new: str) -> int:
            body = {"current_password": current, "new_password": new}
            response = await http.post("/v1/auth/change-password", headers=headers, json=body)
            return response.status_code

        # The current password verifies every time, so the counter is cleared every time.
        assert [await change(PASSWORD, "short") for _ in range(4)] == [422] * 4
        # A wrong current password still counts, and a verified one clears what it counted.
        assert await change("not the password", "another long passphrase") == 400
        assert await change(PASSWORD, PASSWORD) == 422
        assert await change("not the password", "another long passphrase") == 400
        assert await change(PASSWORD, "another long passphrase") == 200


async def test_other_endpoints_are_not_limited(client: httpx.AsyncClient, admin: Admin) -> None:
    headers = {"Authorization": f"Bearer {(await sign_in(client)).json()['access_token']}"}
    for _ in range(10):
        assert (await client.get("/v1/me", headers=headers)).status_code == 200
