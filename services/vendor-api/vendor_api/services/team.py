import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    ActorType,
    TokenPurpose,
    Vendor,
    VendorStatus,
    VendorStatusEvent,
    VendorUser,
    VendorUserRole,
    VendorUserStatus,
)
from vendor_api.db.scoped import get_owned_or_404, scoped_select
from vendor_api.services import auth_tokens
from vendor_api.services.email import EmailTemplate, OutgoingEmail

Clock = Callable[[], datetime]

USER_NOT_FOUND = ApiError(404, "user_not_found", "User not found")
CANNOT_DISABLE_SELF = ApiError(409, "cannot_disable_self", "You cannot disable yourself")
OWNER_CANNOT_BE_DISABLED = ApiError(
    409, "owner_cannot_be_disabled", "The owner cannot be disabled: a vendor always keeps its owner"
)
NOT_INVITED = ApiError(409, "not_invited", "This user has already set a password")


class TeamError(Exception):
    """A team operation cannot be done. The message is safe to print (the CLI shows it)."""


class TeamService:
    """A vendor's users: invite staff, list, disable and enable, resend an invite. Also the
    invite of a vendor's owner, which the Phase 8 migration uses. Commits its own changes.

    Every user is looked up through the vendor id of the signed-in owner, so another vendor's
    user is a 404, never a 403 (it must not reveal that the id exists).
    """

    def __init__(self, settings: Settings, clock: Clock = lambda: datetime.now(UTC)) -> None:
        self._settings = settings
        self._clock = clock
        self._invite_ttl = timedelta(minutes=settings.invite_token_ttl_minutes)

    async def invite_staff(
        self, db: AsyncSession, vendor: Vendor, email: str
    ) -> OutgoingEmail | None:
        """Creates an `invited` staff user (no password) and returns the invite to send.

        An address that is already used anywhere (any vendor, any role) creates nothing and
        returns None: the owner gets the same answer either way, so the endpoint cannot be used
        to find out who is registered.
        """
        email = email.strip().lower()
        if await email_in_use(db, email):
            return None
        now = self._clock()
        try:
            user = VendorUser(
                vendor_id=vendor.id,
                email=email,
                role=VendorUserRole.STAFF,
                status=VendorUserStatus.INVITED,
            )
            db.add(user)
            await db.flush()
            token = auth_tokens.issue_token(db, user.id, TokenPurpose.INVITE, now, self._invite_ttl)
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return None  # a concurrent signup or invite took the address
        except Exception:
            await db.rollback()
            raise
        return self._invite_email(vendor, email, token)

    async def list_users(self, db: AsyncSession, vendor_id: uuid.UUID) -> list[VendorUser]:
        """The vendor's users, oldest first. A vendor has few, so there is no paging."""
        rows = await db.scalars(
            scoped_select(VendorUser, vendor_id)
            .order_by(VendorUser.created_at, VendorUser.id)
            .execution_options(populate_existing=True)
        )
        return list(rows)

    async def set_disabled(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        actor_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        disabled: bool,
    ) -> VendorUser:
        """Disables or enables a staff user.

        Disabling also ends the user's unused invite and reset links, so a disabled user cannot
        come back through an old email; the caller ends their sessions. Enabling restores
        `active`, or `invited` for a user who never set a password (they need a new invite).
        """
        user = await self._user_of_vendor(db, vendor_id, user_id)
        if user.id == actor_id:
            raise CANNOT_DISABLE_SELF
        if user.role == VendorUserRole.OWNER:
            raise OWNER_CANNOT_BE_DISABLED
        now = self._clock()
        try:
            if disabled:
                user.status = VendorUserStatus.DISABLED
                await auth_tokens.end_unused(
                    db, user.id, [TokenPurpose.INVITE, TokenPurpose.RESET_PASSWORD], now
                )
            elif user.status == VendorUserStatus.DISABLED:
                user.status = (
                    VendorUserStatus.ACTIVE
                    if user.password_hash is not None
                    else VendorUserStatus.INVITED
                )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return user

    async def resend_invite(
        self, db: AsyncSession, vendor: Vendor, user_id: uuid.UUID
    ) -> OutgoingEmail:
        """A new invite for a user who has not set a password yet; it ends the older ones."""
        user = await self._user_of_vendor(db, vendor.id, user_id)
        if user.status != VendorUserStatus.INVITED:
            raise NOT_INVITED
        return await self._reinvite(db, vendor, user)

    async def invite_owner(
        self,
        db: AsyncSession,
        vendor: Vendor,
        email: str | None = None,
        status: VendorStatus | None = None,
    ) -> OutgoingEmail:
        """Creates or re-invites a vendor's owner, for vendors that were migrated without a
        password (Phase 8). The email defaults to the vendor's. An owner who has already set a
        password is left alone (raises `TeamError`).

        `status` sets the vendor's status (with an audit event by the system); without it the
        vendor keeps the one it has.
        """
        email = (email or vendor.email).strip().lower()
        owner = await db.scalar(
            select(VendorUser)
            .where(VendorUser.vendor_id == vendor.id, VendorUser.role == VendorUserRole.OWNER)
            .execution_options(populate_existing=True)
        )
        if owner is not None and owner.status != VendorUserStatus.INVITED:
            raise TeamError(f"the owner of {vendor.slug} is {owner.status}: nothing to invite")
        if owner is None or owner.email != email:
            taken = await db.scalar(select(VendorUser.id).where(VendorUser.email == email))
            if taken is not None:
                raise TeamError(f"{email} already belongs to another user")
            # Another vendor's contact address too (as `email_in_use` checks for invites); this
            # vendor's own contact address is the usual choice and is fine.
            other_vendor = await db.scalar(
                select(Vendor.id).where(Vendor.email == email, Vendor.id != vendor.id)
            )
            if other_vendor is not None:
                raise TeamError(f"{email} is another vendor's contact address")
        now = self._clock()
        try:
            if status is not None and vendor.status != status:
                db.add(
                    VendorStatusEvent(
                        vendor_id=vendor.id,
                        from_status=vendor.status,
                        to_status=status,
                        actor_type=ActorType.SYSTEM,
                        reason="owner invited by the migration",
                    )
                )
                vendor.status = status
                vendor.status_changed_at = now
                vendor.status_reason = "owner invited by the migration"
            if owner is None:
                owner = VendorUser(
                    vendor_id=vendor.id,
                    email=email,
                    role=VendorUserRole.OWNER,
                    status=VendorUserStatus.INVITED,
                )
                db.add(owner)
                await db.flush()
            elif owner.email != email:
                owner.email = email  # still invited: the address may be corrected
            await auth_tokens.end_unused(db, owner.id, [TokenPurpose.INVITE], now)
            token = auth_tokens.issue_token(
                db, owner.id, TokenPurpose.INVITE, now, self._invite_ttl
            )
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            raise TeamError(f"could not invite {email}: it is already in use") from error
        except Exception:
            await db.rollback()
            raise
        return self._invite_email(vendor, email, token)

    async def invite_owner_of(
        self,
        db: AsyncSession,
        vendor_ref: str,
        email: str | None = None,
        status: VendorStatus | None = None,
    ) -> OutgoingEmail:
        """`invite_owner` for a vendor named by its slug or its id (what the CLI is given)."""
        try:
            condition = Vendor.id == uuid.UUID(vendor_ref)
        except ValueError:
            condition = Vendor.slug == vendor_ref.strip().lower()
        vendor = await db.scalar(
            select(Vendor).where(condition).execution_options(populate_existing=True)
        )
        if vendor is None:
            raise TeamError(f"no vendor with the slug or id {vendor_ref!r}")
        return await self.invite_owner(db, vendor, email, status)

    async def _reinvite(self, db: AsyncSession, vendor: Vendor, user: VendorUser) -> OutgoingEmail:
        now = self._clock()
        try:
            await auth_tokens.end_unused(db, user.id, [TokenPurpose.INVITE], now)
            token = auth_tokens.issue_token(db, user.id, TokenPurpose.INVITE, now, self._invite_ttl)
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return self._invite_email(vendor, user.email, token)

    def _invite_email(self, vendor: Vendor, email: str, token: str) -> OutgoingEmail:
        return OutgoingEmail(
            email,
            EmailTemplate.STAFF_INVITE,
            {
                "token": token,
                "expires_in_minutes": self._settings.invite_token_ttl_minutes,
                "vendor_name": vendor.name,
            },
        )

    async def _user_of_vendor(
        self, db: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID
    ) -> VendorUser:
        return await get_owned_or_404(db, VendorUser, user_id, vendor_id, USER_NOT_FOUND)


async def email_in_use(db: AsyncSession, email: str) -> bool:
    """Whether the address belongs to any user or any vendor, of any vendor."""
    if await db.scalar(select(VendorUser.id).where(VendorUser.email == email)) is not None:
        return True
    return await db.scalar(select(Vendor.id).where(Vendor.email == email)) is not None


__all__ = ["TeamError", "TeamService", "email_in_use"]
