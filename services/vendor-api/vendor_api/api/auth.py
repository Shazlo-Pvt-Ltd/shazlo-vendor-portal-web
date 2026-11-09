import unicodedata
import uuid
from datetime import datetime
from typing import Annotated, cast
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from redis.exceptions import RedisError
from shazlo_security.passwords import MAX_PASSWORD_LENGTH
from shazlo_security.rate_limit import Check
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.deps import (
    ClientIp,
    CurrentVendorUser,
    Emails,
    Limits,
    current_vendor_user,
    get_sessions,
)
from vendor_api.core.errors import ApiError, error_response
from vendor_api.core.settings import Settings
from vendor_api.db.models import Vendor, VendorUser
from vendor_api.db.session import get_session
from vendor_api.services.auth import (
    INVALID_CURRENT_PASSWORD,
    INVALID_REFRESH_TOKEN,
    REFRESH_CONFLICT,
    AuthService,
    AuthSession,
)
from vendor_api.services.credentials import CredentialService
from vendor_api.services.signup import SignupData, SignupService

# The refresh cookie. Host-only (no Domain attribute), so the browser sends it back only to this
# service, and only to the auth endpoints. Its own name (identity-api's is `identity_refresh`)
# as well, in case both are ever served from one host.
COOKIE_NAME = "vendor_refresh"
COOKIE_PATH = "/v1/auth"

router = APIRouter(prefix="/auth", tags=["auth"])

# How long a successful login exempts its (email, IP) pair from the per-email login counter.
KNOWN_LOGIN_PAIR_TTL_SECONDS = 30 * 24 * 3600

Db = Annotated[AsyncSession, Depends(get_session)]
Sessions = Annotated[AuthService, Depends(get_sessions)]
RefreshCookie = Annotated[str | None, Cookie(alias=COOKIE_NAME)]

# ASCII only: the database stores emails lower-cased and checks that, and lower-casing a
# non-ASCII address can differ between Python and Postgres. A plain addr-spec (dot-atom local
# part, dotted host name): no display names, quotes, commas, angle brackets or spaces, so the
# address stored is always exactly the single address the email goes to.
EMAIL_PATTERN = (
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$"
)
# At most 32 characters, the column's length: an input the database would refuse must be refused
# here, or signup would fail (500) only for unregistered emails and give them away.
PHONE_PATTERN = r"^\+?[0-9][0-9 ()-]{5,29}[0-9]$"
# 10^12 paise is 10^10 rupees: far above any real price, low enough to keep arithmetic safe.
MAX_PAISE = 10**12

SIGNUP_ACCEPTED = (
    "Check your email. If this address can be used, you will find a message from us there."
)
RESEND_ACCEPTED = "If that address needs verifying, we have sent a new link."
RESET_ACCEPTED = "If that address has an account, we have sent a link to reset the password."


def printable_text(value: str) -> str:
    """Refuses control characters (NUL included) and lone surrogates in free text."""
    if any(unicodedata.category(char) in {"Cc", "Cs"} for char in value):
        raise ValueError("remove control characters from this field")
    return value


def get_signup_service(request: Request) -> SignupService:
    return cast(SignupService, request.app.state.signup)


Service = Annotated[SignupService, Depends(get_signup_service)]


def get_credential_service(request: Request) -> CredentialService:
    return cast(CredentialService, request.app.state.credentials)


Credentials = Annotated[CredentialService, Depends(get_credential_service)]


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

    @field_validator("brand_name", "contact_name", "product_type", "website_or_instagram")
    @classmethod
    def _printable(cls, value: str | None) -> str | None:
        # Postgres refuses NUL and lone surrogates; refusing them here keeps a registered and an
        # unregistered email answering the same.
        return value if value is None else printable_text(value)

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
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    service: Service,
    emails: Emails,
    limits: Limits,
    ip: ClientIp,
) -> Message:
    """Creates a pending vendor and its owner, and emails a verification link.

    A registered email gets the same answer, and an "you already have an account" email.
    """
    no_store(response)
    settings = _settings(request)
    # Counted before anything else, and keyed on the address as typed, not on whether it is
    # registered: a limit that only applied to existing accounts would reveal them.
    await limits.check(
        "signup",
        [
            Check("ip", ip, settings.rate_limit_signup_ip),
            Check("email", body.email.strip().lower(), settings.rate_limit_signup_email),
        ],
    )
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
async def verify_email(
    body: VerifyEmailRequest,
    request: Request,
    db: Db,
    service: Service,
    limits: Limits,
    ip: ClientIp,
) -> Response:
    """Spends a verification token. An unknown, used or expired one is one generic 400."""
    await limits.check(
        "verify_email", [Check("ip", ip, _settings(request).rate_limit_verify_email_ip)]
    )
    await service.verify_email(db, body.token)
    response = Response(status_code=204)
    no_store(response)
    return response


@router.post("/resend-verification", status_code=202)
async def resend_verification(
    body: ResendRequest,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    service: Service,
    emails: Emails,
    limits: Limits,
    ip: ClientIp,
) -> Message:
    """Sends a new link only if the user exists and is unverified; the answer never says which."""
    no_store(response)
    settings = _settings(request)
    # Per IP and per address, so the endpoint cannot be used to flood an inbox. Keyed on the
    # address as typed, so the limit looks the same for registered and unregistered ones.
    await limits.check(
        "resend_verification",
        [
            Check("ip", ip, settings.rate_limit_resend_verification_ip),
            Check(
                "email", body.email.strip().lower(), settings.rate_limit_resend_verification_email
            ),
        ],
    )
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
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )


def _clear_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
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
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Db,
    sessions: Sessions,
    limits: Limits,
    ip: ClientIp,
) -> SessionResponse:
    """`401 invalid_credentials` for an unknown email, a wrong password, a user who has no
    password yet, a disabled user and an unverified email alike (a separate answer for unverified
    would reveal, after a signup, whether an address was already registered). A rejected or
    suspended vendor is `403 vendor_not_allowed`."""
    settings = _settings(request)
    email = body.email.strip().lower()
    # An IP never contains a space, so the pair cannot collide with another pair.
    email_ip = f"{ip} {email}"
    # The counters are hit before the password is checked, so parallel guesses cannot slip past
    # them. The strict one is per (email, IP): failures from one network cannot lock a vendor
    # out of another. A successful login clears it, so in the end it counts failures. The loose
    # per-email one is never cleared, so spreading guesses over IPs stays slow.
    # A pair that logged in before skips the loose per-email counter, so a vendor or admin on
    # their usual network is never locked out by someone guessing from elsewhere. The checks stop
    # at the first refusal, so a single attacking IP adds at most its per-pair limit to it.
    known = await limits.remembers("login", "email_ip", email_ip)
    checks = [
        Check("ip", ip, settings.rate_limit_login_ip),
        Check("email_ip", email_ip, settings.rate_limit_login_email),
    ]
    if not known:
        checks.append(Check("email", email, settings.rate_limit_login_email_global))
    await limits.check("login", checks)
    session = await sessions.login(db, body.email, body.password)
    await limits.reset("login", "email_ip", email_ip)
    await limits.remember("login", "email_ip", email_ip, KNOWN_LOGIN_PAIR_TTL_SECONDS)
    return _session_response(response, settings, session)


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320, pattern=EMAIL_PATTERN)

    @field_validator("email", mode="before")
    @classmethod
    def _trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class SetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=200)
    # Used exactly as typed (never trimmed), like every password.
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


@router.post("/forgot-password", status_code=202)
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Db,
    credentials: Credentials,
    emails: Emails,
    limits: Limits,
    ip: ClientIp,
) -> Message:
    """Sends a reset link only if the address belongs to an active user; the answer never says
    which. Limited per IP and per address (as typed), so it cannot be used to flood an inbox."""
    no_store(response)
    settings = _settings(request)
    await limits.check(
        "forgot_password",
        [
            Check("ip", ip, settings.rate_limit_forgot_password_ip),
            Check("email", body.email.strip().lower(), settings.rate_limit_forgot_password_email),
        ],
    )
    emails.queue(background, await credentials.forgot_password(db, body.email))
    return Message(message=RESET_ACCEPTED)


@router.post("/set-password", status_code=204)
async def set_password(
    body: SetPasswordRequest,
    request: Request,
    db: Db,
    credentials: Credentials,
    sessions: Sessions,
    limits: Limits,
    ip: ClientIp,
) -> Response:
    """Accepts an invite or a reset link with a new password.

    It activates an invited user, marks the email verified (the link proved it), spends the
    token and ends every session of the user. A token that is unknown, used or expired is one
    generic `400 invalid_token`. It does not sign the user in: they log in with the new password.
    """
    await limits.check(
        "set_password", [Check("ip", ip, _settings(request).rate_limit_set_password_ip)]
    )
    user_id = await credentials.set_password(
        db, body.token, body.password, before_commit=sessions.end_sessions_of_user
    )
    await sessions.end_sessions_of_user(user_id)
    response = Response(status_code=204)
    no_store(response)
    return response


@router.post("/refresh", response_model=None, dependencies=CookieOrigin)
async def refresh(
    request: Request,
    response: Response,
    db: Db,
    sessions: Sessions,
    limits: Limits,
    ip: ClientIp,
    token: RefreshCookie = None,
) -> SessionResponse | Response:
    settings = _settings(request)
    checks = [Check("ip", ip, settings.rate_limit_refresh_ip)]
    if token:
        try:
            family = await sessions.family_of(token)
        except RedisError:
            family = None  # the IP limit still applies; rotating needs Redis anyway
        if family:
            checks.append(Check("session", family, settings.rate_limit_refresh_session))
    # Outside the try below: a rate-limited client keeps its cookie.
    await limits.check("refresh", checks)
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
    limits: Limits,
    current: Annotated[CurrentVendorUser, Depends(current_vendor_user)],
) -> SessionResponse:
    """Sets a new password, ends every session of the user and starts a new one."""
    # Counted before the current password is checked (it limits guesses with a stolen access
    # token) and cleared once the current password verifies, so in the end it counts wrong
    # current passwords only: a user trying passwords the policy rejects is not locked out.
    subject = str(current.user.id)
    await limits.check(
        "change_password",
        [Check("user", subject, _settings(request).rate_limit_change_password_user)],
    )
    try:
        session = await sessions.change_password(
            db, current.user, current.vendor, body.current_password, body.new_password
        )
    except ApiError as error:
        if error.code != INVALID_CURRENT_PASSWORD.code:
            await limits.reset("change_password", "user", subject)
        raise
    await limits.reset("change_password", "user", subject)
    return _session_response(response, _settings(request), session)
