import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from shazlo_security.passwords import PasswordPolicyError, PasswordService, check_password
from shazlo_security.refresh_tokens import (
    InvalidRefreshTokenError,
    RefreshConflictError,
    RefreshSession,
    RefreshTokenStore,
    StaleSessionError,
)
from shazlo_security.tokens import IssuedToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    Vendor,
    VendorStatus,
    VendorUser,
    VendorUserRole,
    VendorUserStatus,
)
from vendor_api.services.tokens import VendorTokens

INVALID_CREDENTIALS = ApiError(401, "invalid_credentials", "Invalid email or password")
EMAIL_NOT_VERIFIED = ApiError(
    403, "email_not_verified", "Verify your email address before signing in"
)
VENDOR_NOT_ALLOWED = ApiError(
    403, "vendor_not_allowed", "This vendor account cannot sign in. Contact support"
)
INVALID_REFRESH_TOKEN = ApiError(401, "invalid_refresh_token", "Invalid or expired refresh token")
INVALID_CURRENT_PASSWORD = ApiError(
    400, "invalid_current_password", "The current password is wrong"
)
# Another request (usually a second tab) used the same refresh token a moment ago. The session is
# intact and the browser already has that request's new cookie, so the client retries.
REFRESH_CONFLICT = ApiError(
    409, "refresh_conflict", "The refresh token was just used by another request; retry"
)

# A `pending` vendor can sign in: it must be able to edit its profile and submit it. A `rejected`
# or `suspended` one cannot.
SIGN_IN_STATUSES = frozenset({VendorStatus.PENDING, VendorStatus.APPROVED})


def vendor_may_sign_in(vendor: Vendor) -> bool:
    return vendor.status in SIGN_IN_STATUSES


def user_may_sign_in(user: VendorUser) -> bool:
    return user.status == VendorUserStatus.ACTIVE and user.email_verified_at is not None


@dataclass(frozen=True)
class AuthSession:
    user: VendorUser
    vendor: Vendor
    access: IssuedToken
    refresh: RefreshSession


class AuthService:
    """Login, refresh, logout and change-password for vendor users. Commits its own changes.

    Sessions work like identity-api's (ADR 0009): a 15-minute access token and a rotating
    refresh token whose family ends on reuse. The store is `packages/py-security` with the
    `vendor:` prefix.
    """

    def __init__(
        self,
        settings: Settings,
        passwords: PasswordService,
        tokens: VendorTokens,
        refresh_tokens: RefreshTokenStore,
    ) -> None:
        self._settings = settings
        self._passwords = passwords
        self._tokens = tokens
        self._refresh_tokens = refresh_tokens

    async def login(self, db: AsyncSession, email: str, password: str) -> AuthSession:
        email = email.strip().lower()
        user = await db.scalar(
            select(VendorUser)
            .where(VendorUser.email == email)
            .execution_options(populate_existing=True)
        )
        stored_hash = user.password_hash if user else None
        check = await self._passwords.verify_login(stored_hash, password)
        # An unknown email, a wrong password, a user who has no password yet and a disabled user
        # all look the same, and all cost one password verification.
        if user is None or not check.ok or user.status != VendorUserStatus.ACTIVE:
            raise INVALID_CREDENTIALS
        # Only someone who knows the password learns anything below.
        if user.email_verified_at is None:
            raise EMAIL_NOT_VERIFIED
        vendor = await db.scalar(
            select(Vendor)
            .where(Vendor.id == user.vendor_id)
            .execution_options(populate_existing=True)
        )
        if vendor is None:  # the foreign key makes this impossible
            raise INVALID_CREDENTIALS
        if not vendor_may_sign_in(vendor):
            raise VENDOR_NOT_ALLOWED
        # Read the session generation, then re-read the row (locked until the commit below). A
        # password change or disabling commits before it bumps the generation, so either the
        # re-read sees it, or the generation read here is stale and `start_family` refuses it.
        generation = await self._refresh_tokens.generation(user.id)
        await db.refresh(
            user, ["password_hash", "status", "email_verified_at"], with_for_update=True
        )
        if user.password_hash != stored_hash or not user_may_sign_in(user):
            await db.rollback()
            raise INVALID_CREDENTIALS
        if check.new_hash:
            user.password_hash = check.new_hash
        user.last_login_at = datetime.now(UTC)
        await db.commit()
        try:
            return await self._start_session(user, vendor, generation)
        except StaleSessionError as error:
            raise INVALID_CREDENTIALS from error

    async def refresh(self, db: AsyncSession, token: str) -> AuthSession:
        try:
            rotation = await self._refresh_tokens.rotate(token)
        except RefreshConflictError as error:
            raise REFRESH_CONFLICT from error
        except InvalidRefreshTokenError as error:
            raise INVALID_REFRESH_TOKEN from error
        # Read fresh: the status may have changed since this request's session loaded anything.
        user = await db.scalar(
            select(VendorUser)
            .where(VendorUser.id == rotation.subject_id)
            .execution_options(populate_existing=True)
        )
        vendor = (
            await db.scalar(
                select(Vendor)
                .where(Vendor.id == user.vendor_id)
                .execution_options(populate_existing=True)
            )
            if user is not None
            else None
        )
        if (
            user is None
            or vendor is None
            or not user_may_sign_in(user)
            or not vendor_may_sign_in(vendor)
        ):
            # A suspended vendor, a disabled user: the session ends here, not at expiry.
            await self._refresh_tokens.revoke_family(rotation.session.family_id)
            raise INVALID_REFRESH_TOKEN
        return AuthSession(user, vendor, self._access_token(user), rotation.session)

    async def family_of(self, token: str) -> str | None:
        return await self._refresh_tokens.family_id_of(token)

    async def logout(self, token: str) -> None:
        await self._refresh_tokens.revoke_by_token(token)

    async def change_password(
        self,
        db: AsyncSession,
        user: VendorUser,
        vendor: Vendor,
        current_password: str,
        new_password: str,
    ) -> AuthSession:
        """Sets a new password, ends every refresh family and starts one new session.

        The access tokens already issued stay valid until they expire (at most 15 minutes).
        """
        check = await self._passwords.verify_login(user.password_hash, current_password)
        if not check.ok:
            raise INVALID_CURRENT_PASSWORD
        try:
            check_password(
                new_password, email=user.email, min_length=self._settings.password_min_length
            )
        except PasswordPolicyError as error:
            raise ApiError(422, "weak_password", str(error)) from error
        if new_password == current_password:
            raise ApiError(
                422, "weak_password", "The new password must differ from the current one"
            )
        user.password_hash = await self._passwords.hash(new_password)
        await db.commit()
        # The commit comes first: a login that reads the new generation also sees the new hash.
        generation = await self._refresh_tokens.revoke_all(user.id)
        try:
            return await self._start_session(user, vendor, generation)
        except StaleSessionError as error:
            # A concurrent change or disabling won; this one's session is void.
            raise INVALID_CREDENTIALS from error

    async def end_sessions_of_user(self, user_id: uuid.UUID) -> None:
        """Ends every session of one user (call it when a user is disabled)."""
        await self._refresh_tokens.revoke_all(user_id)

    async def end_sessions_of_vendor(self, db: AsyncSession, vendor_id: uuid.UUID) -> int:
        """Ends every session of every user of a vendor, and returns how many users that was.

        Phase 3 calls this when an admin changes a vendor's status (suspend, reject): refreshing
        is refused for those statuses anyway, but this also ends the sessions at once, so a
        vendor that is approved again does not get its old sessions back. Access tokens already
        issued expire on their own within 15 minutes, and `current_vendor_user` refuses a
        suspended vendor's tokens meanwhile.
        """
        user_ids = list(
            await db.scalars(select(VendorUser.id).where(VendorUser.vendor_id == vendor_id))
        )
        for user_id in user_ids:
            await self._refresh_tokens.revoke_all(user_id)
        return len(user_ids)

    async def _start_session(
        self, user: VendorUser, vendor: Vendor, generation: int
    ) -> AuthSession:
        refresh = await self._refresh_tokens.start_family(user.id, generation)
        return AuthSession(user, vendor, self._access_token(user), refresh)

    def _access_token(self, user: VendorUser) -> IssuedToken:
        return self._tokens.issue(
            user_id=user.id, vendor_id=user.vendor_id, role=VendorUserRole(user.role)
        )
