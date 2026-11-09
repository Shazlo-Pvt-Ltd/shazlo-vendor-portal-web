import uuid
from datetime import datetime
from typing import Annotated, cast
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from shazlo_security.passwords import MAX_PASSWORD_LENGTH
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.deps import CurrentVendorUser, Emails, current_vendor_user, get_sessions
from vendor_api.core.errors import ApiError, error_response
from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorUser
from vendor_api.db.session import get_session
from vendor_api.services.auth import (
    INVALID_REFRESH_TOKEN,
    REFRESH_CONFLICT,
    AuthService,
    AuthSession,
)
from vendor_api.services.signup import SignupData, SignupService

# The refresh cookie. Its own name (identity-api's is `identity_refresh`), so the two services
# can share a parent domain without overwriting each other's cookie. The browser sends it to the
# auth endpoints only.
COOKIE_NAME = "vendor_refresh"
COOKIE_PATH = "/v1/auth"

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_session)]
Sessions = Annotated[AuthService, Depends(get_sessions)]
RefreshCookie = Annotated[str | None, Cookie(alias=COOKIE_NAME)]

# ASCII only: the database stores emails lower-cased and checks that, and lower-casing a
# non-ASCII address can differ between Python and Postgres.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
PHONE_PATTERN = r"^\+?[0-9][0-9 ()-]{5,30}[0-9]$"
# 10^12 paise is 10^10 rupees: far above any real price, low enough to keep arithmetic safe.
MAX_PAISE = 10**12

SIGNUP_ACCEPTED = (
    "Check your email. If this address can be used, you will find a message from us there."
)
RESEND_ACCEPTED = "If that address needs verifying, we have sent a new link."


def get_signup_service(request: Request) -> SignupService:
    return cast(SignupService, request.app.state.signup)


Service = Annotated[SignupService, Depends(get_signup_service)]


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


class Message(BaseModel):
    """The one answer for every outcome of signup and resend, so none reveals if an email exists."""

    status: str = "accepted"
    message: str


class SignupRequest(BaseModel):
    # Whitespace is trimmed from the text fields below, never from the password: a password is
    # used exactly as typed, here and at login.
    model_config = ConfigDict(extra="forbid")

    brand_name: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320, pattern=EMAIL_PATTERN)
    phone: str = Field(pattern=PHONE_PATTERN)
    product_type: str = Field(min_length=1, max_length=100)
    website_or_instagram: str | None = Field(default=None, max_length=300)
    price_min_paise: int = Field(ge=0, le=MAX_PAISE)
    price_max_paise: int = Field(ge=0, le=MAX_PAISE)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    terms_accepted: bool

    @field_validator(
        "brand_name",
        "contact_name",
        "email",
        "phone",
        "product_type",
        "website_or_instagram",
        mode="before",
    )
    @classmethod
    def _trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def _ascii_email(cls, value: str) -> str:
        if not value.isascii():
            raise ValueError("use an email address with plain letters and digits")
        return value

    @field_validator("website_or_instagram")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _price_range(self) -> "SignupRequest":
        if self.price_max_paise < self.price_min_paise:
            raise ValueError("price_max_paise must not be below price_min_paise")
        return self


class VerifyEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=200)


class ResendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320, pattern=EMAIL_PATTERN)

    @field_validator("email", mode="before")
    @classmethod
    def _trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


@router.post("/signup", status_code=202)
async def signup(
    body: SignupRequest,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    service: Service,
    emails: Emails,
) -> Message:
    """Creates a pending vendor and its owner, and emails a verification link.

    A registered email gets the same answer, and an "you already have an account" email.
    """
    no_store(response)
    if not body.terms_accepted:
        raise ApiError(422, "terms_not_accepted", "You must accept the terms to sign up")
    outgoing = await service.signup(
        db,
        SignupData(
            brand_name=body.brand_name,
            contact_name=body.contact_name,
            email=body.email,
            phone=body.phone,
            product_type=body.product_type,
            website_or_instagram=body.website_or_instagram,
            price_min_paise=body.price_min_paise,
            price_max_paise=body.price_max_paise,
            password=body.password,
        ),
    )
    emails.queue(background, outgoing)
    return Message(message=SIGNUP_ACCEPTED)


@router.post("/verify-email", status_code=204)
async def verify_email(body: VerifyEmailRequest, db: Db, service: Service) -> Response:
    """Spends a verification token. An unknown, used or expired one is one generic 400."""
    await service.verify_email(db, body.token)
    response = Response(status_code=204)
    no_store(response)
    return response


@router.post("/resend-verification", status_code=202)
async def resend_verification(
    body: ResendRequest,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    service: Service,
    emails: Emails,
) -> Message:
    """Sends a new link only if the user exists and is unverified; the answer never says which."""
    no_store(response)
    emails.queue(background, await service.resend_verification(db, body.email))
    return Message(message=RESEND_ACCEPTED)


# --- Sessions ----------------------------------------------------------------------------


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class UserProfile(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    last_login_at: datetime | None


class VendorSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str


class SessionResponse(BaseModel):
    """The refresh token is never in the body; it is only ever in the HttpOnly cookie."""

    access_token: str
    token_type: str = "Bearer"  # noqa: S105 - the scheme name, not a secret
    expires_in: int
    user: UserProfile
    vendor: VendorSummary


def user_profile(user: VendorUser) -> UserProfile:
    """Profile fields only: never a password hash or a token."""
    return UserProfile(
        id=user.id, email=user.email, role=user.role, last_login_at=user.last_login_at
    )


def vendor_summary(vendor: Vendor) -> VendorSummary:
    return VendorSummary(id=vendor.id, name=vendor.name, slug=vendor.slug, status=vendor.status)


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
        user=user_profile(session.user),
        vendor=vendor_summary(session.vendor),
    )


@router.post("/login")
async def login(
    body: LoginRequest, request: Request, response: Response, db: Db, sessions: Sessions
) -> SessionResponse:
    """`401 invalid_credentials` for an unknown email, a wrong password, a user who has no
    password yet and a disabled user alike. A correct password with an unverified email is
    `403 email_not_verified`; a rejected or suspended vendor is `403 vendor_not_allowed`."""
    session = await sessions.login(db, body.email, body.password)
    return _session_response(response, _settings(request), session)


@router.post("/refresh", response_model=None, dependencies=CookieOrigin)
async def refresh(
    request: Request, response: Response, db: Db, sessions: Sessions, token: RefreshCookie = None
) -> SessionResponse | Response:
    settings = _settings(request)
    try:
        if not token:
            raise INVALID_REFRESH_TOKEN
        session = await sessions.refresh(db, token)
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
async def logout(request: Request, sessions: Sessions, token: RefreshCookie = None) -> Response:
    if token:
        await sessions.logout(token)
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
    sessions: Sessions,
    current: Annotated[CurrentVendorUser, Depends(current_vendor_user)],
) -> SessionResponse:
    """Sets a new password, ends every session of the user and starts a new one."""
    session = await sessions.change_password(
        db, current.user, current.vendor, body.current_password, body.new_password
    )
    return _session_response(response, _settings(request), session)
