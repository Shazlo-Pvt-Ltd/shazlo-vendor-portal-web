import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.base import Base
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

HASH = "a" * 64  # looks like a SHA-256 hex digest; the schema only checks the shape


def make_vendor(slug: str = "acme", email: str = "owner@acme.test", **changes: Any) -> Vendor:
    values: dict[str, Any] = {
        "name": "Acme",
        "slug": slug,
        "email": email,
        "phone": "+911234567890",
        "contact_name": "Asha",
        "product_type": "apparel",
        "price_min_paise": 49_900,
        "price_max_paise": 499_900,
    }
    return Vendor(**{**values, **changes})


def make_user(vendor: Vendor, email: str = "asha@acme.test", **changes: Any) -> VendorUser:
    values: dict[str, Any] = {
        "vendor_id": vendor.id,
        "email": email,
        "password_hash": "not-a-real-hash",  # noqa: S106  (placeholder; hashing comes later)
        "role": VendorUserRole.STAFF,
        "status": VendorUserStatus.ACTIVE,
    }
    return VendorUser(**{**values, **changes})


async def saved_vendor(session: AsyncSession, **changes: Any) -> Vendor:
    vendor = make_vendor(**changes)
    session.add(vendor)
    await session.flush()
    return vendor


async def saved_user(session: AsyncSession, vendor: Vendor, **changes: Any) -> VendorUser:
    user = make_user(vendor, **changes)
    session.add(user)
    await session.flush()
    return user


async def count(session: AsyncSession, model: Any) -> int:
    return await session.scalar(select(func.count()).select_from(model)) or 0


# --- vendors -----------------------------------------------------------------------------


async def test_vendor_defaults(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await session.refresh(vendor)

    assert isinstance(vendor.id, uuid.UUID)
    assert vendor.status == VendorStatus.PENDING
    assert vendor.status_reason is None
    assert vendor.status_changed_at is None
    assert vendor.status_changed_by is None
    assert vendor.website_or_instagram is None
    assert vendor.created_at is not None
    assert vendor.updated_at is not None


async def test_vendor_email_is_stored_trimmed_and_lower_cased(session: AsyncSession) -> None:
    await saved_vendor(session, email="  Owner@Acme.TEST ")
    assert await session.scalar(select(Vendor.email)) == "owner@acme.test"


@pytest.mark.parametrize("email", ["Owner@Acme.test", "OWNER@ACME.TEST", " owner@acme.test"])
async def test_db_rejects_unnormalised_vendor_email_written_directly(
    session: AsyncSession, email: str
) -> None:
    # Bypasses the ORM normalisation: the database itself must refuse it.
    with pytest.raises(IntegrityError, match="ck_vendors_email_lower"):
        await session.execute(
            text(
                "INSERT INTO vendors (name, slug, email, phone, contact_name, product_type, "
                "price_min_paise, price_max_paise) "
                "VALUES ('B', 'second', :email, '1', 'B', 'x', 0, 0)"
            ),
            {"email": email},
        )


async def test_second_vendor_with_the_same_email_is_refused(session: AsyncSession) -> None:
    await saved_vendor(session, slug="first", email="owner@acme.test")
    session.add(make_vendor(slug="second", email="OWNER@acme.test"))  # ORM lower-cases it
    with pytest.raises(IntegrityError, match="uq_vendors_email"):
        await session.flush()


async def test_vendor_slug_is_unique(session: AsyncSession) -> None:
    await saved_vendor(session, slug="acme", email="a@acme.test")
    session.add(make_vendor(slug="acme", email="b@acme.test"))
    with pytest.raises(IntegrityError, match="uq_vendors_slug"):
        await session.flush()


@pytest.mark.parametrize("slug", ["acme", "acme-shop", "a1", "shop-2-go", "9"])
async def test_good_slugs_are_accepted(session: AsyncSession, slug: str) -> None:
    await saved_vendor(session, slug=slug)


@pytest.mark.parametrize(
    "slug", ["", "Acme", "acme_shop", "-acme", "acme-", "acme--shop", "acme shop", "acme/shop"]
)
async def test_bad_slugs_are_refused(session: AsyncSession, slug: str) -> None:
    session.add(make_vendor(slug=slug))
    with pytest.raises(IntegrityError, match="ck_vendors_slug_format"):
        await session.flush()


async def test_blank_name_is_refused(session: AsyncSession) -> None:
    session.add(make_vendor(name="   "))
    with pytest.raises(IntegrityError, match="ck_vendors_name_not_blank"):
        await session.flush()


@pytest.mark.parametrize(("low", "high"), [(0, 0), (0, 100), (49_900, 49_900), (1, 10**12)])
async def test_valid_price_ranges_are_accepted(session: AsyncSession, low: int, high: int) -> None:
    await saved_vendor(session, price_min_paise=low, price_max_paise=high)


async def test_price_range_cannot_be_inverted(session: AsyncSession) -> None:
    session.add(make_vendor(price_min_paise=500, price_max_paise=499))
    with pytest.raises(IntegrityError, match="ck_vendors_price_range"):
        await session.flush()


async def test_price_cannot_be_negative(session: AsyncSession) -> None:
    session.add(make_vendor(price_min_paise=-1, price_max_paise=100))
    with pytest.raises(IntegrityError, match="ck_vendors_price_min_not_negative"):
        await session.flush()


@pytest.mark.parametrize("status", list(VendorStatus))
async def test_every_vendor_status_is_accepted(session: AsyncSession, status: VendorStatus) -> None:
    vendor = await saved_vendor(session, status=status)
    assert vendor.status == status


@pytest.mark.parametrize("status", ["banned", "PENDING", "", "applied"])
async def test_unknown_vendor_status_is_refused(session: AsyncSession, status: str) -> None:
    session.add(make_vendor(status=status))
    with pytest.raises(IntegrityError, match="ck_vendors_status_values"):
        await session.flush()


async def test_updated_at_is_readable_after_update(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    created = vendor.updated_at
    vendor.name = "Acme Ltd"
    await session.flush()
    # Read straight off the instance: without eager defaults this lazy-loads (MissingGreenlet).
    assert vendor.updated_at >= created


# --- vendor users ------------------------------------------------------------------------


async def test_vendor_user_defaults(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = VendorUser(vendor_id=vendor.id, email="new@acme.test", role=VendorUserRole.STAFF)
    session.add(user)
    await session.flush()
    await session.refresh(user)

    assert isinstance(user.id, uuid.UUID)
    assert user.status == VendorUserStatus.INVITED
    assert user.password_hash is None
    assert user.email_verified_at is None
    assert user.terms_accepted_at is None
    assert user.last_login_at is None
    assert user.created_at is not None


async def test_user_email_is_unique_in_any_letter_case(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_user(session, vendor, email="asha@acme.test")
    session.add(make_user(vendor, email="ASHA@Acme.Test"))  # ORM lower-cases it
    with pytest.raises(IntegrityError, match="uq_vendor_users_email"):
        await session.flush()


async def test_user_emails_are_unique_across_vendors(session: AsyncSession) -> None:
    first = await saved_vendor(session, slug="first", email="first@acme.test")
    second = await saved_vendor(session, slug="second", email="second@acme.test")
    await saved_user(session, first, email="shared@acme.test")
    session.add(make_user(second, email="shared@acme.test"))
    with pytest.raises(IntegrityError, match="uq_vendor_users_email"):
        await session.flush()


@pytest.mark.parametrize("email", ["Asha@acme.test", " asha@acme.test", "asha@acme.test "])
async def test_db_rejects_unnormalised_user_email_written_directly(
    session: AsyncSession, email: str
) -> None:
    vendor = await saved_vendor(session)
    with pytest.raises(IntegrityError, match="ck_vendor_users_email_lower"):
        await session.execute(
            text(
                "INSERT INTO vendor_users (vendor_id, email, role) "
                "VALUES (:vendor_id, :email, 'staff')"
            ),
            {"vendor_id": vendor.id, "email": email},
        )


async def test_a_vendor_can_have_only_one_owner(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_user(session, vendor, email="one@acme.test", role=VendorUserRole.OWNER)
    session.add(make_user(vendor, email="two@acme.test", role=VendorUserRole.OWNER))
    with pytest.raises(IntegrityError, match="uq_vendor_users_one_owner_per_vendor"):
        await session.flush()


async def test_a_vendor_can_have_many_staff_and_each_vendor_its_own_owner(
    session: AsyncSession,
) -> None:
    first = await saved_vendor(session, slug="first", email="first@acme.test")
    second = await saved_vendor(session, slug="second", email="second@acme.test")
    await saved_user(session, first, email="o1@acme.test", role=VendorUserRole.OWNER)
    await saved_user(session, second, email="o2@acme.test", role=VendorUserRole.OWNER)
    for number in range(3):
        await saved_user(session, first, email=f"staff{number}@acme.test")
    assert await count(session, VendorUser) == 5


async def test_the_owner_slot_is_free_again_when_the_owner_becomes_staff(
    session: AsyncSession,
) -> None:
    vendor = await saved_vendor(session)
    owner = await saved_user(session, vendor, email="one@acme.test", role=VendorUserRole.OWNER)
    owner.role = VendorUserRole.STAFF
    await session.flush()
    await saved_user(session, vendor, email="two@acme.test", role=VendorUserRole.OWNER)


@pytest.mark.parametrize("role", ["admin", "OWNER", "", "vendor_owner"])
async def test_unknown_role_is_refused(session: AsyncSession, role: str) -> None:
    vendor = await saved_vendor(session)
    session.add(make_user(vendor, role=role))
    with pytest.raises(IntegrityError, match="ck_vendor_users_role_values"):
        await session.flush()


@pytest.mark.parametrize("status", ["pending", "ACTIVE", "", "deleted"])
async def test_unknown_user_status_is_refused(session: AsyncSession, status: str) -> None:
    vendor = await saved_vendor(session)
    session.add(make_user(vendor, status=status))
    with pytest.raises(IntegrityError, match="ck_vendor_users_status_values"):
        await session.flush()


@pytest.mark.parametrize("status", [VendorUserStatus.INVITED, VendorUserStatus.DISABLED])
async def test_a_user_without_a_password_is_fine_while_invited_or_disabled(
    session: AsyncSession, status: VendorUserStatus
) -> None:
    vendor = await saved_vendor(session)
    await saved_user(session, vendor, password_hash=None, status=status)


async def test_an_active_user_needs_a_password(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_user(vendor, password_hash=None, status=VendorUserStatus.ACTIVE))
    with pytest.raises(IntegrityError, match="ck_vendor_users_password_set_when_active"):
        await session.flush()


async def test_a_user_needs_a_vendor(session: AsyncSession) -> None:
    session.add(
        VendorUser(
            vendor_id=uuid.uuid4(),
            email="orphan@acme.test",
            role=VendorUserRole.STAFF,
            status=VendorUserStatus.INVITED,
        )
    )
    with pytest.raises(IntegrityError, match="fk_vendor_users_vendor_id_vendors"):
        await session.flush()


async def test_a_vendor_with_users_cannot_be_deleted(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_user(session, vendor)
    with pytest.raises(IntegrityError, match="fk_vendor_users_vendor_id_vendors"):
        await session.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor.id})


async def test_user_updated_at_is_readable_after_update(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    created = user.updated_at
    user.status = VendorUserStatus.DISABLED
    await session.flush()
    assert user.updated_at >= created


# --- vendor status events ----------------------------------------------------------------


def make_event(vendor: Vendor, **changes: Any) -> VendorStatusEvent:
    values: dict[str, Any] = {
        "vendor_id": vendor.id,
        "from_status": None,
        "to_status": VendorStatus.PENDING,
        "actor_type": ActorType.SYSTEM,
    }
    return VendorStatusEvent(**{**values, **changes})


async def test_creation_event_has_no_from_status_and_no_actor(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    event = make_event(vendor)
    session.add(event)
    await session.flush()
    await session.refresh(event)
    assert isinstance(event.id, int)
    assert event.from_status is None
    assert event.actor_id is None
    assert event.created_at is not None


async def test_events_come_back_in_order_of_their_ids(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    admin = uuid.uuid4()
    session.add_all(
        [
            make_event(vendor),
            make_event(
                vendor,
                from_status=VendorStatus.PENDING,
                to_status=VendorStatus.APPROVED,
                actor_type=ActorType.ADMIN,
                actor_id=admin,
                reason="looks good",
            ),
            make_event(
                vendor,
                from_status=VendorStatus.APPROVED,
                to_status=VendorStatus.SUSPENDED,
                actor_type=ActorType.ADMIN,
                actor_id=admin,
                reason="policy",
            ),
        ]
    )
    await session.flush()
    rows = (
        await session.scalars(
            select(VendorStatusEvent)
            .where(VendorStatusEvent.vendor_id == vendor.id)
            .order_by(VendorStatusEvent.id)
        )
    ).all()
    assert [row.to_status for row in rows] == ["pending", "approved", "suspended"]
    assert rows[0].id < rows[1].id < rows[2].id


@pytest.mark.parametrize("actor_type", [ActorType.ADMIN, ActorType.VENDOR])
async def test_an_admin_or_vendor_event_needs_an_actor_id(
    session: AsyncSession, actor_type: ActorType
) -> None:
    vendor = await saved_vendor(session)
    session.add(make_event(vendor, actor_type=actor_type, actor_id=None))
    with pytest.raises(IntegrityError, match="ck_vendor_status_events_actor_id_required"):
        await session.flush()


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"to_status": "banned"}, "ck_vendor_status_events_to_status_values"),
        ({"from_status": "banned"}, "ck_vendor_status_events_from_status_values"),
        ({"actor_type": "robot"}, "ck_vendor_status_events_actor_type_values"),
    ],
)
async def test_unknown_statuses_and_actor_types_are_refused(
    session: AsyncSession, changes: dict[str, Any], constraint: str
) -> None:
    vendor = await saved_vendor(session)
    session.add(make_event(vendor, **changes))
    with pytest.raises(IntegrityError, match=constraint):
        await session.flush()


async def test_events_cannot_be_updated(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_event(vendor))
    await session.flush()
    with pytest.raises(IntegrityError, match="append-only"):
        await session.execute(text("UPDATE vendor_status_events SET reason = 'rewritten'"))


async def test_events_cannot_be_deleted(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_event(vendor))
    await session.flush()
    with pytest.raises(IntegrityError, match="append-only"):
        await session.execute(text("DELETE FROM vendor_status_events"))


async def test_a_vendor_with_events_cannot_be_deleted(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_event(vendor))
    await session.flush()
    with pytest.raises(IntegrityError, match="fk_vendor_status_events_vendor_id_vendors"):
        await session.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor.id})


async def test_an_event_needs_a_vendor(session: AsyncSession) -> None:
    session.add(
        VendorStatusEvent(
            vendor_id=uuid.uuid4(), to_status=VendorStatus.PENDING, actor_type=ActorType.SYSTEM
        )
    )
    with pytest.raises(IntegrityError, match="fk_vendor_status_events_vendor_id_vendors"):
        await session.flush()


# --- auth tokens -------------------------------------------------------------------------


def make_token(user: VendorUser, **changes: Any) -> AuthToken:
    values: dict[str, Any] = {
        "vendor_user_id": user.id,
        "purpose": TokenPurpose.VERIFY_EMAIL,
        "token_hash": HASH,
        "expires_at": datetime.now(UTC) + timedelta(days=1),
    }
    return AuthToken(**{**values, **changes})


async def saved_token(session: AsyncSession, user: VendorUser, **changes: Any) -> AuthToken:
    token = make_token(user, **changes)
    session.add(token)
    await session.flush()
    return token


async def a_user(session: AsyncSession) -> VendorUser:
    return await saved_user(session, await saved_vendor(session))


async def test_token_defaults(session: AsyncSession) -> None:
    token = await saved_token(session, await a_user(session))
    await session.refresh(token)
    assert isinstance(token.id, uuid.UUID)
    assert token.used_at is None
    assert token.created_at is not None
    assert token.expires_at > token.created_at


@pytest.mark.parametrize("purpose", list(TokenPurpose))
async def test_every_token_purpose_is_accepted(
    session: AsyncSession, purpose: TokenPurpose
) -> None:
    await saved_token(session, await a_user(session), purpose=purpose)


async def test_unknown_purpose_is_refused(session: AsyncSession) -> None:
    user = await a_user(session)
    session.add(make_token(user, purpose="magic_link"))
    with pytest.raises(IntegrityError, match="ck_auth_tokens_purpose_values"):
        await session.flush()


async def test_token_hash_is_unique(session: AsyncSession) -> None:
    user = await a_user(session)
    await saved_token(session, user, token_hash="b" * 64)
    session.add(make_token(user, purpose=TokenPurpose.INVITE, token_hash="b" * 64))
    with pytest.raises(IntegrityError, match="uq_auth_tokens_token_hash"):
        await session.flush()


@pytest.mark.parametrize(
    "token_hash",
    ["", "a" * 63, "a" * 65, "A" * 64, "g" * 64, "plain-token-value", "a" * 63 + " "],
)
async def test_only_a_sha256_hex_digest_can_be_stored(
    session: AsyncSession, token_hash: str
) -> None:
    user = await a_user(session)
    session.add(make_token(user, token_hash=token_hash))
    with pytest.raises(IntegrityError, match="ck_auth_tokens_token_hash_sha256_hex"):
        await session.flush()


async def test_deleting_a_user_deletes_their_tokens(session: AsyncSession) -> None:
    user = await a_user(session)
    await saved_token(session, user, token_hash="c" * 64)
    await saved_token(session, user, token_hash="d" * 64, purpose=TokenPurpose.RESET_PASSWORD)
    assert await count(session, AuthToken) == 2

    await session.execute(text("DELETE FROM vendor_users WHERE id = :id"), {"id": user.id})
    assert await count(session, AuthToken) == 0


async def test_a_token_needs_a_user(session: AsyncSession) -> None:
    session.add(
        AuthToken(
            vendor_user_id=uuid.uuid4(),
            purpose=TokenPurpose.INVITE,
            token_hash=HASH,
            expires_at=datetime.now(UTC),
        )
    )
    with pytest.raises(IntegrityError, match="fk_auth_tokens_vendor_user_id_vendor_users"):
        await session.flush()


# --- the schema as a whole ---------------------------------------------------------------


def test_no_column_stores_a_plain_password_or_token() -> None:
    columns = {column.name for table in Base.metadata.tables.values() for column in table.columns}
    assert {"password_hash", "token_hash"} <= columns
    assert not columns & {"password", "token", "plain_password", "plain_token", "secret"}


async def test_session_fixture_isolates_tests(session: AsyncSession) -> None:
    # Earlier tests inserted vendors; their transactions were rolled back.
    assert await count(session, Vendor) == 0
    assert await count(session, VendorUser) == 0
