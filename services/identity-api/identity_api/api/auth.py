import uuid
from typing import Annotated, cast
from urllib.parse import urlsplit

from fastapi import APIRouter, Cookie, Depends, Request, Response
from pydantic import BaseModel, Field
from redis.exceptions import RedisError
from shazlo_auth import AccessClaims
from shazlo_security.passwords import MAX_PASSWORD_LENGTH
from shazlo_security.rate_limit import Check, RateLimitGuard
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.api.deps import (
    UNAUTHORIZED,
    current_access_claims,
    current_admin,
    current_admin_pending_password,
    get_auth_service,
    get_rate_limit_ip,
    get_rate_limits,
)
from identity_api.core.errors import ApiError, error_response
from identity_api.core.settings import Settings
from identity_api.db.models import Admin
from identity_api.db.session import get_session
from identity_api.services.auth import (
    INVALID_CURRENT_PASSWORD,
    INVALID_REFRESH_TOKEN,
    REFRESH_CONFLICT,
    AuthService,
    AuthSession,
)

COOKIE_NAME = "refresh_token"
# The browser sends the cookie to the auth endpoints only.
COOKIE_PATH = "/v1/auth"

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_session)]
Auth = Annotated[AuthService, Depends(get_auth_service)]
RefreshCookie = Annotated[str | None, Cookie(alias=COOKIE_NAME)]
Limits = Annotated[RateLimitGuard, Depends(get_rate_limits)]
# The client IP as the rate limits count it: IPv6 per network (see `rate_limit_subject`).
ClientIp = Annotated[str, Depends(get_rate_limit_ip)]


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class AdminProfile(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    roles: list[str]
    must_change_password: bool


class SessionResponse(BaseModel):
    """The refresh token is never in the body; it is only ever in the HttpOnly cookie."""

    access_token: str
    token_type: str = "Bearer"  # noqa: S105 - the scheme name, not a secret
    expires_in: int
    must_change_password: bool
    admin: AdminProfile


class TokenRequest(BaseModel):
    audience: str = Field(min_length=1, max_length=64)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"  # noqa: S105 - the scheme name, not a secret
    expires_in: int
    audience: str


ORIGIN_NOT_ALLOWED = ApiError(403, "origin_not_allowed", "Request origin is not allowed")


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _request_origin(request: Request) -> str | None:
    """The `Origin` header, or the origin part of `Referer` when a browser left Origin out."""
    origin = request.headers.get("origin")
    if origin is not None:
        return origin
    referer = request.headers.get("referer")
    if not referer:
        return None
    parts = urlsplit(referer)
    if not parts.scheme or not parts.netloc or "@" in parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def require_allowed_origin(request: Request) -> None:
    """CSRF guard for the endpoints the refresh cookie alone authenticates.

    The cookie is sent with cross-site requests when `cookie_samesite` is "none" (and with
    same-site ones from sibling subdomains under "lax"/"strict"), so these endpoints also require
    the request to come from an origin allowed by CORS. A request with neither Origin nor
    Referer is refused: browsers send Origin on every cross-origin and same-origin POST.
    """
    origin = _request_origin(request)
    allowed = {o.rstrip("/").lower() for o in _settings(request).cors_allowed_origins}
    if origin is None or origin.rstrip("/").lower() not in allowed:
        raise ORIGIN_NOT_ALLOWED


# Checked before the endpoint runs, so a refused request never clears or rotates the cookie.
CookieOrigin = [Depends(require_allowed_origin)]


def profile_of(admin: Admin) -> AdminProfile:
    return AdminProfile(
        id=admin.id,
        email=admin.email,
        display_name=admin.display_name,
        roles=[role.name for role in admin.roles],
        must_change_password=admin.must_change_password,
    )


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _set_cookie(response: Response, settings: Settings, session: AuthSession) -> None:
    response.set_cookie(
        COOKIE_NAME,
        session.refresh.token,
        expires=session.refresh.expires_at,
        path=COOKIE_PATH,
        domain=settings.cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )


def _clear_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        domain=settings.cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )


def _session_response(
    response: Response, settings: Settings, session: AuthSession
) -> SessionResponse:
    no_store(response)
    _set_cookie(response, settings, session)
    return SessionResponse(
        access_token=session.access.token,
        expires_in=settings.access_token_ttl_seconds,
        must_change_password=session.admin.must_change_password,
        admin=profile_of(session.admin),
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Db,
    auth: Auth,
    limits: Limits,
    ip: ClientIp,
) -> SessionResponse:
    settings = _settings(request)
    email = body.email.strip().lower()
    # An IP never contains a space, so the pair cannot collide with another pair.
    email_ip = f"{ip} {email}"
    # The counters are hit before the password is checked, so parallel guesses cannot slip
    # past them. The strict one is per (email, IP): failures from one network cannot lock the
    # admin out of another. A successful login clears it, so in the end it counts failures.
    # The loose per-email one is never cleared, so spreading guesses over IPs stays slow.
    await limits.check(
        "login",
        [
            Check("ip", ip, settings.rate_limit_login_ip),
            Check("email_ip", email_ip, settings.rate_limit_login_email),
            Check("email", email, settings.rate_limit_login_email_global),
        ],
    )
    session = await auth.login(db, body.email, body.password)
    await limits.reset("login", "email_ip", email_ip)
    return _session_response(response, settings, session)


@router.post("/refresh", response_model=None, dependencies=CookieOrigin)
async def refresh(
    request: Request,
    response: Response,
    db: Db,
    auth: Auth,
    limits: Limits,
    ip: ClientIp,
    token: RefreshCookie = None,
) -> SessionResponse | Response:
    settings = _settings(request)
    checks = [Check("ip", ip, settings.rate_limit_refresh_ip)]
    if token:
        try:
            family = await auth.family_of(token)
        except RedisError:
            family = None  # the IP limit still applies; rotating needs Redis anyway
        if family:
            checks.append(Check("session", family, settings.rate_limit_refresh_session))
    # Outside the try below: a rate-limited client keeps its cookie.
    await limits.check("refresh", checks)
    try:
        if not token:
            raise INVALID_REFRESH_TOKEN
        session = await auth.refresh(db, token)
    except ApiError as error:
        failure = error_response(request, error.status_code, error.code, error.message)
        no_store(failure)
        # A rejected token is of no further use: have the browser drop it. Not on a conflict:
        # the browser already holds the new cookie the concurrent request set, and clearing it
        # here would log the user out.
        if error.code != REFRESH_CONFLICT.code:
            _clear_cookie(failure, settings)
        return failure
    return _session_response(response, settings, session)


@router.post("/logout", status_code=204, dependencies=CookieOrigin)
async def logout(request: Request, auth: Auth, token: RefreshCookie = None) -> Response:
    if token:
        await auth.logout(token)
    response = Response(status_code=204)
    no_store(response)
    _clear_cookie(response, _settings(request))
    return response


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    response: Response,
    db: Db,
    auth: Auth,
    limits: Limits,
    admin: Annotated[Admin, Depends(current_admin_pending_password)],
) -> SessionResponse:
    # Counted before the current password is checked, so it limits guesses with a stolen token.
    # Cleared once the current password verifies, so in the end it counts wrong current
    # passwords only: a new admin trying passwords the policy rejects is not locked out.
    subject = str(admin.id)
    await limits.check(
        "change_password",
        [Check("admin", subject, _settings(request).rate_limit_change_password_admin)],
    )
    try:
        session = await auth.change_password(db, admin, body.current_password, body.new_password)
    except ApiError as error:
        if error.code != INVALID_CURRENT_PASSWORD.code:
            await limits.reset("change_password", "admin", subject)
        raise
    await limits.reset("change_password", "admin", subject)
    return _session_response(response, _settings(request), session)


@router.post("/token")
async def exchange_token(
    body: TokenRequest,
    request: Request,
    response: Response,
    auth: Auth,
    limits: Limits,
    ip: ClientIp,
    admin: Annotated[Admin, Depends(current_admin)],
    claims: Annotated[AccessClaims, Depends(current_access_claims)],
) -> TokenResponse:
    """A 5-minute token for one module backend, never outliving the token that asked. No
    refresh token: only the identity session refreshes, so several modules never rotate it at
    the same time."""
    settings = _settings(request)
    await limits.check(
        "token",
        [
            Check("ip", ip, settings.rate_limit_token_ip),
            Check("admin", str(admin.id), settings.rate_limit_token_admin),
        ],
    )
    if claims.expires_at is None:  # the shared verifier always sets it from `exp`
        raise UNAUTHORIZED
    issued = auth.exchange_token(admin, body.audience, not_after=claims.expires_at)
    no_store(response)
    return TokenResponse(
        access_token=issued.token,
        expires_in=issued.lifetime_seconds,
        audience=body.audience,
    )
