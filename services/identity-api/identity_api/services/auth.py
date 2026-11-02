from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.core.errors import ApiError
from identity_api.core.settings import Settings
from identity_api.db.models import Admin
from identity_api.services.password_policy import PasswordPolicyError, check_password
from identity_api.services.passwords import PasswordService
from identity_api.services.refresh_tokens import (
    InvalidRefreshTokenError,
    RefreshConflictError,
    RefreshSession,
    RefreshTokenStore,
    StaleSessionError,
)
from identity_api.services.tokens import IssuedToken, TokenIssuer, TokenWindowClosedError

# The audience of tokens the shell holds for identity-api itself (ADR 0009).
SELF_AUDIENCE = "identity-api"

INVALID_CREDENTIALS = ApiError(401, "invalid_credentials", "Invalid email or password")
INVALID_REFRESH_TOKEN = ApiError(401, "invalid_refresh_token", "Invalid or expired refresh token")
INVALID_CURRENT_PASSWORD = ApiError(
    400, "invalid_current_password", "The current password is wrong"
)
EXPIRED_ACCESS_TOKEN = ApiError(
    401, "unauthorized", "Missing or invalid access token", headers={"WWW-Authenticate": "Bearer"}
)
# Another request (usually a second tab) used the same refresh token a moment ago. The session
# is intact and the browser already has that request's new cookie, so the client retries.
REFRESH_CONFLICT = ApiError(
    409, "refresh_conflict", "The refresh token was just used by another request; retry"
)


@dataclass(frozen=True)
class AuthSession:
    admin: Admin
    access: IssuedToken
    refresh: RefreshSession


class AuthService:
    """Login, refresh, logout and change-password. Commits its own database changes."""

    def __init__(
        self,
        settings: Settings,
        passwords: PasswordService,
        issuer: TokenIssuer,
        refresh_tokens: RefreshTokenStore,
    ) -> None:
        self._settings = settings
        self._passwords = passwords
        self._issuer = issuer
        self._refresh_tokens = refresh_tokens

    async def login(self, db: AsyncSession, email: str, password: str) -> AuthSession:
        admin = await db.scalar(select(Admin).where(Admin.email == email.strip().lower()))
        verified_hash = admin.password_hash if admin else None
        check = await self._passwords.verify_login(verified_hash, password)
        # An unknown email, a wrong password and a deactivated admin all look the same.
        if admin is None or not check.ok or not admin.is_active:
            raise INVALID_CREDENTIALS
        # Read the session generation, then re-read the row (locked until the commit below). A
        # password change or deactivation commits before it bumps the generation, so either the
        # re-read sees it, or the generation read here is stale and `start_family` refuses it.
        generation = await self._refresh_tokens.generation(admin.id)
        await db.refresh(admin, ["password_hash", "is_active"], with_for_update=True)
        if admin.password_hash != verified_hash or not admin.is_active:
            await db.rollback()
            raise INVALID_CREDENTIALS
        if check.new_hash:
            admin.password_hash = check.new_hash
        admin.last_login_at = datetime.now(UTC)
        await db.commit()
        try:
            return await self._start_session(admin, generation)
        except StaleSessionError as error:
            raise INVALID_CREDENTIALS from error

    async def refresh(self, db: AsyncSession, token: str) -> AuthSession:
        try:
            rotation = await self._refresh_tokens.rotate(token)
        except RefreshConflictError as error:
            raise REFRESH_CONFLICT from error
        except InvalidRefreshTokenError as error:
            raise INVALID_REFRESH_TOKEN from error
        admin = await db.get(Admin, rotation.admin_id)
        if admin is None or not admin.is_active:
            await self._refresh_tokens.revoke_family(rotation.session.family_id)
            raise INVALID_REFRESH_TOKEN
        return AuthSession(admin, self._access_token(admin), rotation.session)

    async def family_of(self, token: str) -> str | None:
        return await self._refresh_tokens.family_id_of(token)

    async def logout(self, token: str) -> None:
        await self._refresh_tokens.revoke_by_token(token)

    async def change_password(
        self, db: AsyncSession, admin: Admin, current_password: str, new_password: str
    ) -> AuthSession:
        """Sets a new password, ends every refresh family and starts one new session.

        The access tokens already issued stay valid until they expire (at most 15 minutes).
        """
        check = await self._passwords.verify_login(admin.password_hash, current_password)
        if not check.ok:
            raise INVALID_CURRENT_PASSWORD
        try:
            check_password(
                new_password, email=admin.email, min_length=self._settings.password_min_length
            )
        except PasswordPolicyError as error:
            raise ApiError(422, "weak_password", str(error)) from error
        if new_password == current_password:
            raise ApiError(
                422, "weak_password", "The new password must differ from the current one"
            )
        admin.password_hash = await self._passwords.hash(new_password)
        admin.must_change_password = False
        await db.commit()
        # The commit comes first: a login that reads the new generation also sees the new hash.
        generation = await self._refresh_tokens.revoke_all(admin.id)
        try:
            return await self._start_session(admin, generation)
        except StaleSessionError as error:
            # A concurrent password change or deactivation won; this one's session is void.
            raise INVALID_CREDENTIALS from error

    def exchange_token(self, admin: Admin, audience: str, not_after: datetime) -> IssuedToken:
        """A short-lived token for exactly one other service, if one of the admin's roles is
        allowed there. It carries only those allowed roles.

        identity-api itself is never an exchange audience: only login and refresh issue its
        tokens, so a stolen access token cannot renew itself without the refresh cookie.

        Roles are read from the database, not from the token that asked, so a change of roles
        applies at once to new exchanges. `not_after` is the asking token's `exp`; the new token
        never outlives it.
        """
        if audience == SELF_AUDIENCE:
            raise ApiError(
                400,
                "audience_not_exchangeable",
                "identity-api tokens come from login and refresh only",
            )
        allowed = self._settings.audience_roles.get(audience)
        if allowed is None:
            raise ApiError(400, "unknown_audience", "Unknown audience")
        roles = sorted({role.name for role in admin.roles} & set(allowed))
        if not roles:
            raise ApiError(403, "audience_not_allowed", "Your roles do not allow this audience")
        try:
            return self._issuer.issue(
                subject=admin.id,
                roles=roles,
                audience=audience,
                ttl_seconds=self._settings.exchanged_token_ttl_seconds,
                not_after=not_after,
            )
        except TokenWindowClosedError as error:
            raise EXPIRED_ACCESS_TOKEN from error

    async def _start_session(self, admin: Admin, generation: int) -> AuthSession:
        refresh = await self._refresh_tokens.start_family(admin.id, generation)
        return AuthSession(admin, self._access_token(admin), refresh)

    def _access_token(self, admin: Admin) -> IssuedToken:
        return self._issuer.issue(
            subject=admin.id,
            roles=[role.name for role in admin.roles],
            audience=SELF_AUDIENCE,
            must_change_password=admin.must_change_password,
        )
