"""Origin checks on the endpoints the refresh cookie alone authenticates (CSRF).

The session service is replaced by a recorder, so these run without Postgres or Redis and show
whether a request got past the check at all. `test_sessions_api.py` covers the same endpoints
against the real service and database.
"""

from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import COOKIE_NAME
from vendor_api.app import create_seller_app
from vendor_api.core.settings import Settings
from vendor_api.services.auth import INVALID_REFRESH_TOKEN, REFRESH_CONFLICT, AuthSession

ORIGIN = "https://vendors.test"
TOKEN = "a-refresh-token"  # noqa: S105


class RecordingSessions:
    """Stands in for AuthService on the cookie endpoints and records what reached it."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.refusal = INVALID_REFRESH_TOKEN
        self.family: str | None = None
        self.family_lookup_fails = False

    async def logout(self, token: str) -> None:
        self.calls.append(("logout", token))

    async def family_of(self, token: str) -> str | None:
        if self.family_lookup_fails:
            raise RedisConnectionError("redis is down")
        return self.family

    async def refresh(self, db: AsyncSession, token: str) -> AuthSession:
        self.calls.append(("refresh", token))
        raise self.refusal


@pytest.fixture
def api_settings(settings: Settings, override: Callable[..., Settings]) -> Settings:
    # SameSite=None is the setting under which a cross-site request carries the cookie.
    return override(settings, cors_allowed_origins=[ORIGIN], cookie_samesite="none")


@pytest.fixture
def sessions() -> RecordingSessions:
    return RecordingSessions()


@pytest.fixture
async def client(
    api_settings: Settings, sessions: RecordingSessions
) -> AsyncIterator[httpx.AsyncClient]:
    redis = FakeAsyncRedis()
    app = create_seller_app(api_settings, readiness_checks={}, redis=redis)
    app.state.sessions = sessions
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendor-api.test") as http:
        yield http
    await redis.aclose()


def with_cookie(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, "Cookie": f"{COOKIE_NAME}={TOKEN}"}


def cookie_cleared(response: httpx.Response) -> bool:
    return any(
        header.startswith(f"{COOKIE_NAME}=") and "Max-Age=0" in header
        for header in response.headers.get_list("set-cookie")
    )


@pytest.mark.parametrize("path", ["/v1/auth/refresh", "/v1/auth/logout"])
@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.test"},
        {"Origin": "https://vendors.test.evil.test"},
        {"Origin": "http://vendors.test"},
        {"Origin": "null"},
        {"Referer": "https://evil.test/page"},
        {"Referer": "https://vendors.test@evil.test/page"},
        {"Referer": "/dashboard"},
        {"Origin": "https://evil.test", "Referer": f"{ORIGIN}/app"},
        {},
    ],
    ids=[
        "foreign-origin",
        "lookalike-origin",
        "plain-http-origin",
        "null-origin",
        "foreign-referer",
        "referer-with-userinfo",
        "relative-referer",
        "origin-wins-over-referer",
        "no-origin-or-referer",
    ],
)
async def test_cookie_endpoints_refuse_other_origins(
    client: httpx.AsyncClient, sessions: RecordingSessions, path: str, headers: dict[str, str]
) -> None:
    response = await client.post(path, headers=with_cookie(headers))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"
    # Refused before the endpoint ran: no session was touched and the cookie is not cleared.
    assert sessions.calls == []
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": ORIGIN},
        {"Origin": "HTTPS://Vendors.Test/"},
        {"Referer": f"{ORIGIN}/products?page=2"},
    ],
    ids=["origin", "origin-case-and-slash", "referer-fallback"],
)
async def test_logout_from_the_portal_ends_the_session_and_clears_the_cookie(
    client: httpx.AsyncClient, sessions: RecordingSessions, headers: dict[str, str]
) -> None:
    response = await client.post("/v1/auth/logout", headers=with_cookie(headers))
    assert response.status_code == 204
    assert sessions.calls == [("logout", TOKEN)]
    assert cookie_cleared(response)
    assert response.headers["Cache-Control"] == "no-store"


async def test_logout_without_a_cookie_still_answers_and_clears(
    client: httpx.AsyncClient, sessions: RecordingSessions
) -> None:
    response = await client.post("/v1/auth/logout", headers={"Origin": ORIGIN})
    assert response.status_code == 204
    assert sessions.calls == []
    assert cookie_cleared(response)


async def test_a_refused_refresh_token_is_cleared(
    client: httpx.AsyncClient, sessions: RecordingSessions
) -> None:
    response = await client.post("/v1/auth/refresh", headers=with_cookie({"Origin": ORIGIN}))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_refresh_token"
    assert sessions.calls == [("refresh", TOKEN)]
    assert cookie_cleared(response)
    assert response.headers["Cache-Control"] == "no-store"
    assert TOKEN not in response.text


async def test_a_refresh_conflict_keeps_the_cookie_the_other_tab_set(
    client: httpx.AsyncClient, sessions: RecordingSessions
) -> None:
    sessions.refusal = REFRESH_CONFLICT
    response = await client.post("/v1/auth/refresh", headers=with_cookie({"Origin": ORIGIN}))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "refresh_conflict"
    assert "set-cookie" not in response.headers


async def test_a_missing_cookie_is_refused_without_calling_the_service(
    client: httpx.AsyncClient, sessions: RecordingSessions
) -> None:
    response = await client.post("/v1/auth/refresh", headers={"Origin": ORIGIN})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_refresh_token"
    assert sessions.calls == []


async def test_a_failed_family_lookup_still_refreshes_under_the_ip_limit(
    client: httpx.AsyncClient, sessions: RecordingSessions
) -> None:
    """Redis failing for the per-session counter does not turn into a 500."""
    sessions.family_lookup_fails = True
    response = await client.post("/v1/auth/refresh", headers=with_cookie({"Origin": ORIGIN}))
    assert response.status_code == 401
    assert sessions.calls == [("refresh", TOKEN)]
