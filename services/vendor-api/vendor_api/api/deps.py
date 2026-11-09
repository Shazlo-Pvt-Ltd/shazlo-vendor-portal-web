import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from shazlo_auth import InvalidTokenError
from shazlo_security.client_ip import Network, client_ip, rate_limit_subject
from shazlo_security.rate_limit import RateLimitGuard
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorUser, VendorUserRole
from vendor_api.db.session import get_session
from vendor_api.services.auth import AuthService, user_may_sign_in, vendor_may_sign_in
from vendor_api.services.email import EmailService
from vendor_api.services.tokens import VendorClaims, VendorTokens

_bearer = HTTPBearer(auto_error=False)

UNAUTHORIZED = ApiError(
    401, "unauthorized", "Missing or invalid access token", headers={"WWW-Authenticate": "Bearer"}
)
FORBIDDEN = ApiError(403, "forbidden", "Your role does not allow this")
VENDOR_NOT_ALLOWED = ApiError(
    403, "vendor_not_allowed", "This vendor account cannot use the API. Contact support"
)


def get_emails(request: Request) -> EmailService:
    return cast(EmailService, request.app.state.emails)


# An endpoint sends email with `emails.send_in_background(background_tasks, to, template, context)`.
Emails = Annotated[EmailService, Depends(get_emails)]


def get_rate_limits(request: Request) -> RateLimitGuard:
    return cast(RateLimitGuard, request.app.state.rate_limits)


def get_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else None
    return client_ip(
        peer,
        request.headers.getlist("x-forwarded-for"),
        cast(list[Network], request.app.state.trusted_proxies),
    )


def get_rate_limit_ip(request: Request) -> str:
    """The client IP as the per-IP rate limits count it (IPv6 grouped per network)."""
    settings = cast(Settings, request.app.state.settings)
    return rate_limit_subject(get_client_ip(request), settings.rate_limit_ipv6_prefix)


Limits = Annotated[RateLimitGuard, Depends(get_rate_limits)]
# The client IP as the rate limits count it: IPv6 per network (see `rate_limit_subject`).
ClientIp = Annotated[str, Depends(get_rate_limit_ip)]


def get_sessions(request: Request) -> AuthService:
    return cast(AuthService, request.app.state.sessions)


Sessions = Annotated[AuthService, Depends(get_sessions)]


async def current_access_claims(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> VendorClaims:
    """The verified claims of the request's vendor-api access token.

    FastAPI runs this once per request, so an endpoint can ask for it next to the user.
    """
    if credentials is None:
        raise UNAUTHORIZED
    tokens = cast(VendorTokens, request.app.state.vendor_tokens)
    try:
        return await tokens.verify(credentials.credentials)
    except InvalidTokenError as error:
        raise UNAUTHORIZED from error


@dataclass(frozen=True)
class CurrentVendorUser:
    """The signed-in vendor user, read from the database (not from the token)."""

    user: VendorUser
    vendor: Vendor

    @property
    def role(self) -> VendorUserRole:
        return VendorUserRole(self.user.role)


async def current_vendor_user(
    claims: Annotated[VendorClaims, Depends(current_access_claims)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> CurrentVendorUser:
    """The user and vendor behind a valid access token, active and verified.

    Both come from the database on every request, so disabling a user or suspending a vendor
    takes effect at once, not when the 15-minute token expires, and a role change applies
    immediately. A token whose `vendor_id` is not the user's vendor is refused.
    """
    user = await db.scalar(
        select(VendorUser)
        .where(VendorUser.id == claims.user_id)
        .execution_options(populate_existing=True)
    )
    if user is None or not user_may_sign_in(user) or user.vendor_id != claims.vendor_id:
        raise UNAUTHORIZED
    vendor = await db.scalar(
        select(Vendor).where(Vendor.id == user.vendor_id).execution_options(populate_existing=True)
    )
    if vendor is None:
        raise UNAUTHORIZED
    if not vendor_may_sign_in(vendor):
        raise VENDOR_NOT_ALLOWED
    return CurrentVendorUser(user, vendor)


@dataclass(frozen=True)
class VendorScope:
    """Whose data this request may touch, taken from the token and the database.

    Every vendor-facing handler takes `scope: Scope` and passes `scope.vendor_id` to the
    scoped helpers in `db/scoped.py`; it never reads a vendor id from the path, query or body.
    """

    vendor_id: uuid.UUID
    user_id: uuid.UUID
    role: VendorUserRole


async def current_scope(
    current: Annotated[CurrentVendorUser, Depends(current_vendor_user)],
) -> VendorScope:
    return VendorScope(current.vendor.id, current.user.id, current.role)


Scope = Annotated[VendorScope, Depends(current_scope)]


def require_vendor_role(*roles: VendorUserRole) -> Callable[..., Awaitable[CurrentVendorUser]]:
    """A dependency that lets only the listed roles through (`403 forbidden` for the rest).

    The role is the one in the database, so a demoted staff member loses access at once.
    """
    allowed = frozenset(roles)

    async def dependency(
        current: Annotated[CurrentVendorUser, Depends(current_vendor_user)],
    ) -> CurrentVendorUser:
        if current.role not in allowed:
            raise FORBIDDEN
        return current

    return dependency
