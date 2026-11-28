"""Shared by the API tests that sign in: the client, the app builder and account builders.

vendor-api runs as two apps (ADR 0011). `make_api` builds both over one session and one Redis and
puts them behind one test client: `/v1/admin*` goes to the admin app, everything else to the
seller app, so a test can walk a whole flow (a vendor submits, an admin approves) in one place."""

import json
import uuid
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http.cookies import SimpleCookie
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI
from redis.asyncio import Redis
from shazlo_auth import JwksClient, KeySource
from shazlo_security.keys import KeyRing, KeyRingConfig, generate_private_key, load_keyring
from shazlo_security.keys import private_key_pem as pem_of
from shazlo_security.passwords import PasswordService
from shazlo_security.tokens import TokenIssuer
from sqlalchemy import text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

from vendor_api.admin_app import create_admin_app
from vendor_api.api.auth import COOKIE_NAME
from vendor_api.api.deps import CurrentVendorUser, require_vendor_role
from vendor_api.app import create_seller_app
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
    # The seller app (`/v1/auth`, `/v1/vendor/*`, ...).
    app: FastAPI
    redis: Redis
    # The admin app (`/v1/admin/*`), when the settings name an identity-api.
    admin_app: FastAPI | None = None

    @property
    def admin(self) -> FastAPI:
        assert self.admin_app is not None, "these settings have no identity-api: no admin app"
        return self.admin_app

    @property
    def apps(self) -> list[FastAPI]:
        return [self.app] if self.admin_app is None else [self.app, self.admin_app]

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


# The database role each app logs in as (migration 0012). Every request in the tests runs as its
# app's role, and the worker's jobs as the worker's, so a right an app lacks fails here as it would
# in a deployment, not only in production.
SELLER_ROLE, ADMIN_ROLE, WORKER_ROLE = "vendor_seller", "vendor_admin", "vendor_worker"


@asynccontextmanager
async def as_role(session: AsyncSession, role: str) -> AsyncIterator[AsyncSession]:
    """The test's session, as `role` until the block ends (then the test's owner again)."""
    await session.execute(text(f"SET ROLE {role}"))
    try:
        yield session
    finally:
        try:
            await session.execute(text("RESET ROLE"))
        except DBAPIError:
            # The block failed mid-statement: back to the last savepoint first.
            await session.rollback()
            await session.execute(text("RESET ROLE"))


def sessions_as(session: AsyncSession, role: str) -> Callable[[], AsyncIterator[AsyncSession]]:
    """A FastAPI `get_session` override: the test's session, as `role` for one request."""

    async def dependency() -> AsyncIterator[AsyncSession]:
        async with as_role(session, role):
            yield session

    return dependency


class BothApps:
    """One ASGI app for the tests: `/v1/admin*` to the admin app, the rest to the seller app, as
    the two hostnames would route them in a deployment."""

    def __init__(self, seller: FastAPI, admin: FastAPI | None) -> None:
        self.seller, self.admin = seller, admin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if self.admin is not None and (path == "/v1/admin" or path.startswith("/v1/admin/")):
            await self.admin(scope, receive, send)
        else:
            await self.seller(scope, receive, send)


async def make_api(
    settings: Settings,
    session: AsyncSession,
    redis: Redis,
    identity_keys: KeySource | None = None,
) -> AsyncGenerator[Api, None]:
    app = create_seller_app(settings, readiness_checks={}, redis=redis)
    admin_app = (
        create_admin_app(settings, readiness_checks={}, redis=redis, identity_keys=identity_keys)
        if settings.identity_jwks_url
        else None
    )

    # The test's session (rolled back after the test, so tests share no rows), as each app's role.
    app.dependency_overrides[get_session] = sessions_as(session, SELLER_ROLE)
    if admin_app is not None:
        admin_app.dependency_overrides[get_session] = sessions_as(session, ADMIN_ROLE)

    @app.get("/v1/owner-only")
    async def owner_only(
        current: Annotated[CurrentVendorUser, Depends(require_vendor_role(VendorUserRole.OWNER))],
    ) -> dict[str, str]:
        return {"email": current.user.email}

    transport = httpx.ASGITransport(app=BothApps(app, admin_app))
    # https, so the client treats the Secure refresh cookie as sendable; the portal's Origin, as a
    # browser would send it (the cookie-authenticated endpoints refuse requests without it).
    async with httpx.AsyncClient(
        transport=transport, base_url="https://vendor-api.test", headers={"Origin": ORIGIN}
    ) as http:
        yield Api(http, app, redis, admin_app)


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
    # Committed: a request that fails rolls the shared session back, which would undo it.
    await session.commit()


async def set_user(session: AsyncSession, user: VendorUser, **values: Any) -> None:
    await session.execute(update(VendorUser).where(VendorUser.id == user.id).values(**values))
    await session.commit()


async def redis_keys(redis: Redis) -> list[str]:
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
    emails = EmailService(sender, retry_delay_seconds=0)
    for app in api.apps:  # the admin app emails vendors too (approved, rejected, suspended)
        app.state.emails = emails
    return sender


# --- identity-api, as the tests see it --------------------------------------------------

IDENTITY_ISSUER = "https://identity.test"
JWKS_URL = "https://identity.test/.well-known/jwks.json"
ADMIN_ID = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
VENDOR_ID = uuid.UUID("9b2f1c3e-0d4a-4c1e-8f6a-2b7d5e9a1c30")


def identity_ring(kid: str = "identity-key-1") -> KeyRing:
    """identity-api's key ring: its own key, nothing to do with vendor-api's."""
    pem = pem_of(generate_private_key()).decode()
    return load_keyring(KeyRingConfig(keys_json=json.dumps({kid: pem})))


class FakeJwks:
    """identity-api's JWKS endpoint: counts fetches and can be taken down."""

    def __init__(self, ring: KeyRing) -> None:
        self.ring = ring
        self.fetches = 0
        self.down = False

    async def __call__(self) -> dict[str, Any]:
        self.fetches += 1
        if self.down:
            raise ConnectionError("identity-api is down")
        return self.ring.jwks()


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Identity:
    """identity-api for the tests: issues admin tokens and serves the JWKS that verifies them."""

    def __init__(self, ring: KeyRing | None = None) -> None:
        self.ring = ring or identity_ring()
        self.jwks = FakeJwks(self.ring)
        self.clock = Clock()
        self.client = JwksClient(self.jwks, clock=self.clock)
        self._issuer = TokenIssuer(IDENTITY_ISSUER, self.ring, access_ttl_seconds=900)

    def token(
        self,
        roles: list[str],
        *,
        audience: str = "vendor-api",
        subject: uuid.UUID = ADMIN_ID,
        must_change_password: bool = False,
        issuer: TokenIssuer | None = None,
        **extra: Any,
    ) -> str:
        return (
            (issuer or self._issuer)
            .issue(
                subject=subject,
                roles=roles,
                audience=audience,
                must_change_password=must_change_password,
                **extra,
            )
            .token
        )
