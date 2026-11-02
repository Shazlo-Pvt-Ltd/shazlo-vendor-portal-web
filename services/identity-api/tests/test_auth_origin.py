"""Origin checks on the endpoints the refresh cookie alone authenticates (CSRF).

The auth service is replaced by a recorder, so these run without Postgres and show whether a
request got past the check at all.
"""

from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.app import create_app
from identity_api.core.settings import Settings
from identity_api.services.auth import INVALID_REFRESH_TOKEN, AuthSession

ORIGIN = "https://shell.test"
TOKEN = "a-refresh-token"


class RecordingAuth:
    """Stands in for AuthService on the cookie endpoints and records what reached it."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def logout(self, token: str) -> None:
        self.calls.append(("logout", token))

    async def refresh(self, db: AsyncSession, token: str) -> AuthSession:
        self.calls.append(("refresh", token))
        raise INVALID_REFRESH_TOKEN


@pytest.fixture
def api_settings(settings: Settings, override: Callable[..., Settings]) -> Settings:
    # SameSite=None is the setting under which a cross-site request carries the cookie.
    return override(settings, cors_allowed_origins=[ORIGIN], cookie_samesite="none")


@pytest.fixture
def auth() -> RecordingAuth:
    return RecordingAuth()


@pytest.fixture
async def client(api_settings: Settings, auth: RecordingAuth) -> AsyncIterator[httpx.AsyncClient]:
    redis = FakeAsyncRedis()
    app = create_app(api_settings, readiness_checks={}, redis=redis)
    app.state.auth = auth
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://identity.test") as http:
        yield http
    await redis.aclose()


def with_cookie(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, "Cookie": f"refresh_token={TOKEN}"}


@pytest.mark.parametrize("path", ["/v1/auth/refresh", "/v1/auth/logout"])
@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.test"},
        {"Origin": "https://shell.test.evil.test"},
        {"Origin": "null"},
        {"Referer": "https://evil.test/page"},
        {"Referer": "https://shell.test@evil.test/page"},
        {"Origin": "https://evil.test", "Referer": f"{ORIGIN}/app"},
        {},
    ],
    ids=[
        "foreign-origin",
        "lookalike-origin",
        "null-origin",
        "foreign-referer",
        "referer-with-userinfo",
        "origin-wins-over-referer",
        "no-origin-or-referer",
    ],
)
async def test_cookie_endpoints_refuse_other_origins(
    client: httpx.AsyncClient, auth: RecordingAuth, path: str, headers: dict[str, str]
) -> None:
    response = await client.post(path, headers=with_cookie(headers))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"
    # Refused before the endpoint ran: no session was touched and the cookie is not cleared.
    assert auth.calls == []
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": ORIGIN},
        {"Origin": "HTTPS://Shell.Test/"},
        {"Referer": f"{ORIGIN}/vendors?page=2"},
    ],
    ids=["origin", "origin-case-and-slash", "referer-fallback"],
)
async def test_logout_from_the_shell_is_allowed(
    client: httpx.AsyncClient, auth: RecordingAuth, headers: dict[str, str]
) -> None:
    response = await client.post("/v1/auth/logout", headers=with_cookie(headers))
    assert response.status_code == 204
    assert auth.calls == [("logout", TOKEN)]


async def test_refresh_from_the_shell_passes_the_origin_check(
    client: httpx.AsyncClient, auth: RecordingAuth
) -> None:
    response = await client.post("/v1/auth/refresh", headers=with_cookie({"Origin": ORIGIN}))
    # The recorder rejects the token, so this fails later, as a token error.
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_refresh_token"
    assert auth.calls == [("refresh", TOKEN)]
