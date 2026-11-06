from collections.abc import Callable
from typing import Any, cast

import pytest
from pydantic import ValidationError
from shazlo_security.passwords import PasswordService
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from identity_api.api.admins import CreateAdminRequest
from identity_api.core.errors import ApiError
from identity_api.core.security import password_config
from identity_api.core.settings import Settings
from identity_api.db.models import Admin, Role
from identity_api.services.admins import AdminService, violated_constraint
from identity_api.services.refresh_tokens import RefreshTokenStore


class DriverError(Exception):
    """Stands in for asyncpg's error, which carries the constraint name."""

    def __init__(self, constraint_name: str | None) -> None:
        super().__init__("integrity error")
        self.constraint_name = constraint_name


def integrity_error(constraint_name: str | None) -> IntegrityError:
    # SQLAlchemy's asyncpg adapter raises its own error from asyncpg's, so the name is on
    # `orig.__cause__`.
    orig = Exception("adapted")
    orig.__cause__ = DriverError(constraint_name)
    return IntegrityError("INSERT INTO admins ...", {}, orig)


class FailingCommitSession:
    """Just enough of AsyncSession for `create_admin` to reach a commit that fails."""

    def __init__(self, error: IntegrityError) -> None:
        self._error = error
        self.rolled_back = False

    async def scalars(self, _statement: Any) -> list[Role]:
        return [Role(name="vendor_reviewer", description="")]

    async def scalar(self, _statement: Any) -> None:
        return None  # no admin with this email yet: the race happens after this check

    def add(self, _admin: Admin) -> None:
        pass

    async def commit(self) -> None:
        raise self._error

    async def rollback(self) -> None:
        self.rolled_back = True


@pytest.fixture
def service(settings: Settings, override: Callable[..., Settings]) -> AdminService:
    fast = override(settings, argon2_memory_cost_kib=8, argon2_time_cost=1)
    return AdminService(fast, PasswordService(password_config(fast)), cast(RefreshTokenStore, None))


async def create(service: AdminService, db: FailingCommitSession) -> Admin:
    return await service.create_admin(
        cast(AsyncSession, db),
        email="new@shazlo.test",
        display_name="New Admin",
        password="an initial password",
        roles=["vendor_reviewer"],
    )


async def test_email_unique_violation_on_commit_is_409(service: AdminService) -> None:
    db = FailingCommitSession(integrity_error("uq_admins_email"))
    with pytest.raises(ApiError) as raised:
        await create(service, db)
    assert (raised.value.status_code, raised.value.code) == (409, "email_taken")
    assert db.rolled_back


@pytest.mark.parametrize(
    "constraint", ["fk_admin_roles_role_name_roles", "ck_admins_email_lower", None]
)
async def test_other_integrity_errors_are_not_email_taken(
    service: AdminService, constraint: str | None
) -> None:
    db = FailingCommitSession(integrity_error(constraint))
    with pytest.raises(IntegrityError):
        await create(service, db)
    assert db.rolled_back


def test_constraint_name_is_read_from_orig_too() -> None:
    error = IntegrityError("INSERT", {}, DriverError("uq_admins_email"))
    assert violated_constraint(error) == "uq_admins_email"


INSERT_ADMIN = text(
    "INSERT INTO admins (email, password_hash, display_name) VALUES (:email, 'x', 'A')"
)


async def test_real_duplicate_email_names_the_unique_constraint(session: AsyncSession) -> None:
    """With Postgres and asyncpg, the name the service matches on is really there."""
    await session.execute(INSERT_ADMIN, {"email": "dup@shazlo.test"})
    with pytest.raises(IntegrityError) as raised:
        await session.execute(INSERT_ADMIN, {"email": "dup@shazlo.test"})
    assert violated_constraint(raised.value) == "uq_admins_email"


async def test_real_other_violation_names_its_own_constraint(session: AsyncSession) -> None:
    with pytest.raises(IntegrityError) as raised:
        await session.execute(INSERT_ADMIN, {"email": "Mixed@shazlo.test"})
    assert violated_constraint(raised.value) == "ck_admins_email_lower"


@pytest.mark.parametrize("email", [" New@Shazlo.Test ", "NEW@shazlo.test", "\tnew@shazlo.test\n"])
def test_create_request_normalises_email_before_the_pattern(email: str) -> None:
    body = CreateAdminRequest(
        email=email, display_name="New", password="  padded password  ", roles=["vendor_reviewer"]
    )
    assert body.email == "new@shazlo.test"
    assert body.password == "  padded password  "  # passwords are never trimmed


@pytest.mark.parametrize("email", ["not-an-email", "   ", " a b@shazlo.test"])
def test_create_request_still_rejects_bad_email(email: str) -> None:
    with pytest.raises(ValidationError):
        CreateAdminRequest(email=email, display_name="New", password="x", roles=["vendor_reviewer"])
