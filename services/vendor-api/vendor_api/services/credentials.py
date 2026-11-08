import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from shazlo_security.passwords import PasswordPolicyError, PasswordService, check_password
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import TokenPurpose, VendorUser, VendorUserStatus
from vendor_api.services import auth_tokens
from vendor_api.services.email import EmailTemplate, OutgoingEmail
from vendor_api.services.signup import INVALID_TOKEN

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]


class CredentialService:
    """Forgot password and set password (an invite or a reset). Commits its own changes.

    Both flows end in `set_password`: someone holds a one-time token from an email and chooses a
    password. The token proved they own the address, so it also verifies the email.
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
        self._reset_ttl = timedelta(minutes=settings.reset_token_ttl_minutes)

    async def forgot_password(self, db: AsyncSession, email: str) -> OutgoingEmail | None:
        """A reset link, only for an existing, active user (an invited one uses their invite, a
        disabled one cannot sign in). Anyone else gets nothing and the caller cannot tell."""
        email = email.strip().lower()
        user = await db.scalar(
            select(VendorUser).where(
                VendorUser.email == email, VendorUser.status == VendorUserStatus.ACTIVE
            )
        )
        if user is None:
            return None
        now = self._clock()
        try:
            # A newer reset ends the older ones.
            await auth_tokens.end_unused(db, user.id, [TokenPurpose.RESET_PASSWORD], now)
            token = auth_tokens.issue_token(
                db, user.id, TokenPurpose.RESET_PASSWORD, now, self._reset_ttl
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return OutgoingEmail(
            email,
            EmailTemplate.PASSWORD_RESET,
            {"token": token, "expires_in_minutes": self._settings.reset_token_ttl_minutes},
        )

    async def set_password(self, db: AsyncSession, token: str, password: str) -> uuid.UUID:
        """Accepts an invite or a reset token with the new password and returns the user's id.

        The caller must then end the user's sessions (`AuthService.end_sessions_of_user`).

        An unknown, used or expired token, and a token of a user who may not use it (a disabled
        user, a reset for a user who is still invited), are one generic error. The password is
        checked before the token is spent, so a weak one can be corrected with the same link.
        """
        now = self._clock()
        row = await auth_tokens.find_usable(
            db, token, [TokenPurpose.INVITE, TokenPurpose.RESET_PASSWORD], now
        )
        user = (
            await db.scalar(
                select(VendorUser)
                .where(VendorUser.id == row.vendor_user_id)
                .execution_options(populate_existing=True)
            )
            if row is not None
            else None
        )
        if row is None or user is None or not _may_use(row.purpose, user):
            await db.rollback()
            raise INVALID_TOKEN
        try:
            check_password(
                password, email=user.email, min_length=self._settings.password_min_length
            )
        except PasswordPolicyError as error:
            raise ApiError(422, "weak_password", str(error)) from error
        password_hash = await self._passwords.hash(password)

        try:
            if not await auth_tokens.spend(db, row.id, now):
                raise INVALID_TOKEN  # another request used it between the check and now
            # Any other link for this user (an old reset, an unused invite) dies with this one.
            await auth_tokens.end_unused(
                db, user.id, [TokenPurpose.INVITE, TokenPurpose.RESET_PASSWORD], now
            )
            await db.execute(
                update(VendorUser)
                .where(VendorUser.id == user.id)
                .values(
                    password_hash=password_hash,
                    status=VendorUserStatus.ACTIVE,
                    # The link proved the address, so it counts as verified.
                    email_verified_at=user.email_verified_at or now,
                )
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return user.id


def _may_use(purpose: str, user: VendorUser) -> bool:
    """An invite is for a user who has not set a password yet; a reset for one who has."""
    if purpose == TokenPurpose.INVITE:
        return user.status == VendorUserStatus.INVITED
    return user.status == VendorUserStatus.ACTIVE
