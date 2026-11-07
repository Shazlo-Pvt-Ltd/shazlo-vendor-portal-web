import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from shazlo_security.passwords import PasswordPolicyError, PasswordService, check_password
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    ActorType,
    AuthToken,
    TokenPurpose,
    Vendor,
    VendorStatus,
    VendorStatusEvent,
    VendorUser,
    VendorUserRole,
    VendorUserStatus,
)
from vendor_api.services.email import EmailTemplate, OutgoingEmail
from vendor_api.services.one_time_tokens import hash_token, new_token
from vendor_api.services.slugs import next_slug, slugify

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]

INVALID_TOKEN = ApiError(400, "invalid_token", "This link is invalid or has expired")
# More than this many slug collisions in a row means something else is wrong.
MAX_SLUG_ATTEMPTS = 5


@dataclass(frozen=True)
class SignupData:
    brand_name: str
    contact_name: str
    email: str
    phone: str
    product_type: str
    website_or_instagram: str | None
    price_min_paise: int
    price_max_paise: int
    password: str


class SignupService:
    """Vendor signup and email verification. Commits its own changes.

    Every method that takes an email answers the same whether or not the account exists: it
    returns the email to send (or nothing), and the route turns both into one response.
    """

    def __init__(
        self,
        settings: Settings,
        passwords: PasswordService,
        clock: Clock = lambda: datetime.now(UTC),
    ) -> None:
        self._settings = settings
        self._passwords = passwords
        self._clock = clock
        self._token_ttl = timedelta(minutes=settings.email_verification_ttl_minutes)

    async def signup(self, db: AsyncSession, data: SignupData) -> OutgoingEmail:
        """Creates the vendor (`pending`), its status event and its owner (`active`, email not
        verified yet) in one transaction, and returns the verification email.

        An email that is already registered creates nothing and returns the "you already have
        an account" email instead. The password is hashed first in both cases, so the two take
        about as long.
        """
        email = data.email.strip().lower()
        try:
            check_password(
                data.password, email=email, min_length=self._settings.password_min_length
            )
        except PasswordPolicyError as error:
            raise ApiError(422, "weak_password", str(error)) from error
        password_hash = await self._passwords.hash(data.password)

        if await self._email_taken(db, email):
            return OutgoingEmail(email, EmailTemplate.ACCOUNT_EXISTS)

        for _ in range(MAX_SLUG_ATTEMPTS):
            slug = await self._free_slug(db, slugify(data.brand_name))
            try:
                return await self._create(db, data, email, slug, password_hash)
            except IntegrityError as error:
                await db.rollback()
                constraint = str(error.orig)
                if "uq_vendors_slug" in constraint:
                    continue  # someone took the slug meanwhile: pick the next one
                if "uq_vendor_users_email" in constraint or "uq_vendors_email" in constraint:
                    # Two signups with the same email raced and the other one won.
                    return OutgoingEmail(email, EmailTemplate.ACCOUNT_EXISTS)
                raise
            except Exception:
                await db.rollback()
                raise
        raise RuntimeError("could not find a free slug")

    async def verify_email(self, db: AsyncSession, token: str) -> None:
        """Marks the email as verified. A token works once: the single UPDATE that spends it is
        what makes two requests with the same token unable to both succeed. Unknown, used and
        expired tokens all raise the same error."""
        now = self._clock()
        user_id = await db.scalar(
            update(AuthToken)
            .where(
                AuthToken.token_hash == hash_token(token),
                AuthToken.purpose == TokenPurpose.VERIFY_EMAIL,
                AuthToken.used_at.is_(None),
                AuthToken.expires_at > now,
            )
            .values(used_at=now)
            .returning(AuthToken.vendor_user_id)
        )
        if user_id is None:
            await db.rollback()
            raise INVALID_TOKEN
        await db.execute(
            update(VendorUser)
            .where(VendorUser.id == user_id, VendorUser.email_verified_at.is_(None))
            .values(email_verified_at=now)
        )
        await db.commit()

    async def resend_verification(self, db: AsyncSession, email: str) -> OutgoingEmail | None:
        """A new verification email, only for an existing, active, unverified user. A newer
        token ends the older ones. Anyone else gets nothing, and the caller cannot tell."""
        email = email.strip().lower()
        user = await db.scalar(
            select(VendorUser).where(
                VendorUser.email == email,
                VendorUser.status == VendorUserStatus.ACTIVE,
                VendorUser.email_verified_at.is_(None),
            )
        )
        if user is None:
            return None
        now = self._clock()
        try:
            await db.execute(
                update(AuthToken)
                .where(
                    AuthToken.vendor_user_id == user.id,
                    AuthToken.purpose == TokenPurpose.VERIFY_EMAIL,
                    AuthToken.used_at.is_(None),
                )
                .values(used_at=now)
            )
            token = self._issue_token(db, user.id, now)
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return self._verification_email(email, token)

    async def _create(
        self, db: AsyncSession, data: SignupData, email: str, slug: str, password_hash: str
    ) -> OutgoingEmail:
        now = self._clock()
        vendor = Vendor(
            name=data.brand_name.strip(),
            slug=slug,
            email=email,
            phone=data.phone.strip(),
            contact_name=data.contact_name.strip(),
            product_type=data.product_type.strip(),
            website_or_instagram=data.website_or_instagram,
            price_min_paise=data.price_min_paise,
            price_max_paise=data.price_max_paise,
        )
        db.add(vendor)
        await db.flush()
        owner = VendorUser(
            vendor_id=vendor.id,
            email=email,
            password_hash=password_hash,
            role=VendorUserRole.OWNER,
            status=VendorUserStatus.ACTIVE,
            terms_accepted_at=now,
        )
        db.add(owner)
        await db.flush()
        # The vendor created itself: the audit trail names the owner as the actor.
        db.add(
            VendorStatusEvent(
                vendor_id=vendor.id,
                from_status=None,
                to_status=VendorStatus.PENDING,
                actor_type=ActorType.VENDOR,
                actor_id=owner.id,
            )
        )
        token = self._issue_token(db, owner.id, now)
        await db.commit()
        return self._verification_email(email, token)

    def _issue_token(self, db: AsyncSession, user_id: uuid.UUID, now: datetime) -> str:
        token, token_hash = new_token()
        db.add(
            AuthToken(
                vendor_user_id=user_id,
                purpose=TokenPurpose.VERIFY_EMAIL,
                token_hash=token_hash,
                expires_at=now + self._token_ttl,
            )
        )
        return token

    def _verification_email(self, email: str, token: str) -> OutgoingEmail:
        return OutgoingEmail(
            email,
            EmailTemplate.VERIFY_EMAIL,
            {
                "token": token,
                "expires_in_minutes": self._settings.email_verification_ttl_minutes,
            },
        )

    async def _email_taken(self, db: AsyncSession, email: str) -> bool:
        user = await db.scalar(select(VendorUser.id).where(VendorUser.email == email))
        if user is not None:
            return True
        return await db.scalar(select(Vendor.id).where(Vendor.email == email)) is not None

    async def _free_slug(self, db: AsyncSession, base: str) -> str:
        # `base` holds only [a-z0-9-], so it needs no LIKE escaping.
        taken = set(
            await db.scalars(
                select(Vendor.slug).where(or_(Vendor.slug == base, Vendor.slug.like(f"{base}-%")))
            )
        )
        return next_slug(base, taken)
