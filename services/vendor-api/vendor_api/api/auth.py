from typing import Annotated, cast

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from shazlo_security.passwords import MAX_PASSWORD_LENGTH
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.deps import Emails
from vendor_api.core.errors import ApiError
from vendor_api.db.session import get_session
from vendor_api.services.signup import SignupData, SignupService

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_session)]

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
