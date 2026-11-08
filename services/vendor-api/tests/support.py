"""Shared by the API tests that sign in: the client, the app builder and account builders."""

from collections.abc import AsyncGenerator, AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http.cookies import SimpleCookie
from typing import Annotated, Any

import httpx
from fakeredis import FakeAsyncRedis
from fastapi import Depends, FastAPI
from shazlo_security.passwords import PasswordService
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import COOKIE_NAME
from vendor_api.api.deps import CurrentVendorUser, require_vendor_role
from vendor_api.app import create_app
from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorStatus, VendorUser, VendorUserRole
from vendor_api.db.session import get_session
from vendor_api.services.email import EmailSender, EmailService, EmailTemplate

PASSWORD = "correct horse battery"  # noqa: S105
NEW_PASSWORD = "another long passphrase"  # noqa: S105
ORIGIN = "https://vendors.test"
EMAIL = "asha@atelier.test"


@dataclass
class Api:
    http: httpx.AsyncClient
    app: FastAPI
    redis: FakeAsyncRedis

    async def login(self, email: str = EMAIL, password: str = PASSWORD) -> httpx.Response:
        self.http.cookies.clear()
        return await self.http.post("/v1/auth/login", json={"email": email, "password": password})

    async def refresh(
        self, token: str | None, headers: dict[str, str] | None = None
    ) -> httpx.Response:
        self.http.cookies.clear()
        sent = {"Cookie": f"{COOKIE_NAME}={token}"} if token else {}
        return await self.http.post("/v1/auth/refresh", headers={**sent, **(headers or {})})

    async def logout(self, token: str | None) -> httpx.Response:
        self.http.cookies.clear()
        sent = {"Cookie": f"{COOKIE_NAME}={token}"} if token else {}
        return await self.http.post("/v1/auth/logout", headers=sent)

    async def me(self, access_token: str | None) -> httpx.Response:
        headers = {"Authorization": f"Bearer {access_token}"} if access_token else {}
        return await self.http.get("/v1/vendor/me", headers=headers)

    async def change_password(
        self, access_token: str | None, current: str = PASSWORD, new: str = NEW_PASSWORD
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {access_token}"} if access_token else {}
        return await self.http.post(
            "/v1/auth/change-password",
            json={"current_password": current, "new_password": new},
            headers=headers,
        )


def cookie_of(response: httpx.Response) -> SimpleCookie | None:
    for header in response.headers.get_list("set-cookie"):
        cookie: SimpleCookie = SimpleCookie()
        cookie.load(header)
        if COOKIE_NAME in cookie:
            return cookie
    return None


def token_of(response: httpx.Response) -> str:
    cookie = cookie_of(response)
    assert cookie is not None, "no refresh cookie was set"
    return cookie[COOKIE_NAME].value


def is_cleared(response: httpx.Response) -> bool:
    cookie = cookie_of(response)
    return cookie is not None and cookie[COOKIE_NAME]["max-age"] == "0"


def without_request_id(response: httpx.Response) -> Any:
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        body["error"].pop("request_id", None)
    return body


async def make_api(
    settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncGenerator[Api, None]:
    app = create_app(settings, readiness_checks={}, redis=redis)

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session  # rolled back after the test, so tests share no rows

    app.dependency_overrides[get_session] = test_session

    @app.get("/v1/owner-only")
    async def owner_only(
        current: Annotated[CurrentVendorUser, Depends(require_vendor_role(VendorUserRole.OWNER))],
    ) -> dict[str, str]:
        return {"email": current.user.email}

    transport = httpx.ASGITransport(app=app)
    # https, so the client treats the Secure refresh cookie as sendable; the portal's Origin, as a
    # browser would send it (the cookie-authenticated endpoints refuse requests without it).
    async with httpx.AsyncClient(
        transport=transport, base_url="https://vendor-api.test", headers={"Origin": ORIGIN}
    ) as http:
        yield Api(http, app, redis)


@dataclass
class Account:
    vendor: Vendor
    user: VendorUser


async def make_account(
    session: AsyncSession,
    hasher: PasswordService,
    *,
    email: str = EMAIL,
    password: str | None = PASSWORD,
    role: VendorUserRole = VendorUserRole.OWNER,
    status: str = "active",
    verified: bool = True,
    vendor_status: VendorStatus = VendorStatus.PENDING,
    vendor: Vendor | None = None,
    password_hash: str | None = None,
) -> Account:
    if vendor is None:
        slug = email.split("@")[0].replace(".", "-")
        vendor = Vendor(
            name="Atelier",
            slug=slug,
            email=email,
            phone="+911234567890",
            contact_name="Asha",
            product_type="apparel",
            price_min_paise=49_900,
            price_max_paise=499_900,
            status=vendor_status,
        )
        session.add(vendor)
        await session.flush()
    hashed = password_hash or (await hasher.hash(password) if password is not None else None)
    user = VendorUser(
        vendor_id=vendor.id,
        email=email,
        password_hash=hashed,
        role=role,
        status=status,
        email_verified_at=datetime.now(UTC) if verified else None,
    )
    session.add(user)
    await session.commit()
    return Account(vendor, user)


async def set_vendor_status(session: AsyncSession, vendor: Vendor, status: str) -> None:
    await session.execute(update(Vendor).where(Vendor.id == vendor.id).values(status=status))


async def set_user(session: AsyncSession, user: VendorUser, **values: Any) -> None:
    await session.execute(update(VendorUser).where(VendorUser.id == user.id).values(**values))


async def redis_keys(redis: FakeAsyncRedis) -> list[str]:
    return [key.decode() async for key in redis.scan_iter("*")]


@dataclass
class RecordingSender:
    """Records what the app tries to send, and forwards it to the console backend (which logs
    only the template outside dev), so the log assertions see the real log lines."""

    inner: EmailSender
    sent: list[tuple[str, EmailTemplate, Mapping[str, object]]] = field(default_factory=list)

    async def send(self, to: str, template: EmailTemplate, context: Mapping[str, object]) -> None:
        self.sent.append((to, template, dict(context)))
        await self.inner.send(to, template, context)

    def tokens(self) -> list[str]:
        return [str(context["token"]) for _, _, context in self.sent if "token" in context]


def record_emails(api: Api) -> RecordingSender:
    """Replaces the app's email service with one that records what it is asked to send (and
    forwards it to the console backend, which logs only the template outside dev)."""
    from vendor_api.services.email import ConsoleEmailSender

    sender = RecordingSender(ConsoleEmailSender("https://vendors.test", show_links=False))
    api.app.state.emails = EmailService(sender, retry_delay_seconds=0)
    return sender
