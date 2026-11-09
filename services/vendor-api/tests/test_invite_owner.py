import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from shazlo_security.passwords import PasswordService
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import Api, make_account, make_api, record_emails

from vendor_api import cli
from vendor_api.core.security import password_config
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    AuthToken,
    Vendor,
    VendorStatus,
    VendorStatusEvent,
    VendorUser,
)
from vendor_api.services.email import EmailTemplate, OutgoingEmail
from vendor_api.services.team import TeamError, TeamService

OWNER_PASSWORD = "a long owner passphrase"  # noqa: S105


@pytest.fixture
def api_settings(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        jwt_issuer="https://vendor-api.test",
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
        refresh_reuse_grace_seconds=0,
    )
    return result


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis()
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture
async def api(
    api_settings: Settings, session: AsyncSession, redis: FakeAsyncRedis
) -> AsyncIterator[Api]:
    async for api in make_api(api_settings, session, redis):
        yield api


@pytest.fixture
def team(api_settings: Settings) -> TeamService:
    return TeamService(api_settings)


async def migrated_vendor(
    session: AsyncSession,
    slug: str = "mongo-brand",
    email: str = "brand@mongo.test",
    **changes: Any,
) -> Vendor:
    """A vendor as the Phase 8 migration leaves it: the row exists, there is no user."""
    values: dict[str, Any] = {
        "name": "Mongo Brand",
        "slug": slug,
        "email": email,
        "phone": "+911234567890",
        "contact_name": "Migrated",
        "product_type": "apparel",
        "price_min_paise": 10_000,
        "price_max_paise": 90_000,
        "status": VendorStatus.APPROVED,
    }
    vendor = Vendor(**{**values, **changes})
    session.add(vendor)
    await session.commit()
    return vendor


async def owner_of(session: AsyncSession, vendor: Vendor) -> VendorUser | None:
    return await session.scalar(
        select(VendorUser)
        .where(VendorUser.vendor_id == vendor.id, VendorUser.role == "owner")
        .execution_options(populate_existing=True)
    )


async def test_a_vendor_without_an_owner_gets_an_invited_one(
    session: AsyncSession, team: TeamService
) -> None:
    vendor = await migrated_vendor(session)
    outgoing = await team.invite_owner(session, vendor)

    assert (outgoing.to, outgoing.template) == ("brand@mongo.test", EmailTemplate.STAFF_INVITE)
    assert outgoing.context["vendor_name"] == "Mongo Brand"
    owner = await owner_of(session, vendor)
    assert owner is not None
    assert (owner.email, owner.status, owner.password_hash) == ("brand@mongo.test", "invited", None)
    assert vendor.status == VendorStatus.APPROVED  # kept as it was
    assert (await session.scalars(select(VendorStatusEvent))).all() == []


async def test_the_owner_sets_a_password_through_the_link_and_signs_in(
    api: Api, session: AsyncSession, team: TeamService
) -> None:
    vendor = await migrated_vendor(session)
    outgoing = await team.invite_owner(session, vendor)
    assert (await api.login("brand@mongo.test", OWNER_PASSWORD)).status_code == 401  # not yet

    response = await api.http.post(
        "/v1/auth/set-password",
        json={"token": outgoing.context["token"], "password": OWNER_PASSWORD},
    )
    assert response.status_code == 204
    login = await api.login("brand@mongo.test", OWNER_PASSWORD)
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "owner"
    assert login.json()["vendor"]["status"] == "approved"


async def test_inviting_again_sends_a_new_link_and_ends_the_old_one(
    api: Api, session: AsyncSession, team: TeamService
) -> None:
    vendor = await migrated_vendor(session)
    first = await team.invite_owner(session, vendor)
    second = await team.invite_owner(session, vendor)
    assert first.context["token"] != second.context["token"]
    assert len((await session.scalars(select(VendorUser))).all()) == 1  # not a second owner

    old = await api.http.post(
        "/v1/auth/set-password", json={"token": first.context["token"], "password": OWNER_PASSWORD}
    )
    assert old.status_code == 400
    new = await api.http.post(
        "/v1/auth/set-password", json={"token": second.context["token"], "password": OWNER_PASSWORD}
    )
    assert new.status_code == 204


async def test_the_address_can_be_corrected_while_the_owner_is_still_invited(
    session: AsyncSession, team: TeamService
) -> None:
    vendor = await migrated_vendor(session)
    await team.invite_owner(session, vendor)
    outgoing = await team.invite_owner(session, vendor, email="Right.Address@Mongo.test")
    assert outgoing.to == "right.address@mongo.test"
    owner = await owner_of(session, vendor)
    assert owner is not None
    assert owner.email == "right.address@mongo.test"


@pytest.mark.parametrize("status", [VendorStatus.PENDING, VendorStatus.APPROVED])
async def test_the_vendors_status_can_be_set_with_an_audit_event(
    session: AsyncSession, team: TeamService, status: VendorStatus
) -> None:
    vendor = await migrated_vendor(session, status=VendorStatus.REJECTED)
    await team.invite_owner(session, vendor, status=status)
    assert vendor.status == status
    (event,) = (await session.scalars(select(VendorStatusEvent))).all()
    assert (event.from_status, event.to_status) == ("rejected", status.value)
    assert (event.actor_type, event.actor_id) == ("system", None)
    assert event.reason


async def test_no_event_is_written_when_the_status_does_not_change(
    session: AsyncSession, team: TeamService
) -> None:
    vendor = await migrated_vendor(session, status=VendorStatus.APPROVED)
    await team.invite_owner(session, vendor, status=VendorStatus.APPROVED)
    assert (await session.scalars(select(VendorStatusEvent))).all() == []


async def test_an_owner_who_already_set_a_password_is_left_alone(
    session: AsyncSession, team: TeamService, api_settings: Settings
) -> None:
    hasher = PasswordService(password_config(api_settings))
    account = await make_account(session, hasher)
    with pytest.raises(TeamError, match="is active"):
        await team.invite_owner(session, account.vendor)
    assert len((await session.scalars(select(AuthToken))).all()) == 0


async def test_an_address_that_belongs_to_another_user_is_refused(
    session: AsyncSession, team: TeamService, api_settings: Settings
) -> None:
    hasher = PasswordService(password_config(api_settings))
    await make_account(session, hasher, email="taken@else.test")
    vendor = await migrated_vendor(session)
    with pytest.raises(TeamError, match="already belongs"):
        await team.invite_owner(session, vendor, email="TAKEN@else.test")
    assert await owner_of(session, vendor) is None  # nothing was created


async def test_another_vendors_contact_address_is_refused(
    session: AsyncSession, team: TeamService
) -> None:
    await migrated_vendor(session, slug="other-brand", email="contact@other.test")
    vendor = await migrated_vendor(session)
    with pytest.raises(TeamError, match="another vendor's contact address"):
        await team.invite_owner(session, vendor, email="contact@other.test")
    assert await owner_of(session, vendor) is None


async def test_the_vendor_is_found_by_slug_or_id(session: AsyncSession, team: TeamService) -> None:
    by_slug = await migrated_vendor(session, slug="by-slug", email="a@mongo.test")
    by_id = await migrated_vendor(session, slug="by-id", email="b@mongo.test")
    assert (await team.invite_owner_of(session, "By-Slug")).to == "a@mongo.test"
    assert (await team.invite_owner_of(session, str(by_id.id))).to == "b@mongo.test"
    with pytest.raises(TeamError, match="no vendor"):
        await team.invite_owner_of(session, "nope")
    with pytest.raises(TeamError, match="no vendor"):
        await team.invite_owner_of(session, str(uuid.uuid4()))
    assert by_slug.slug == "by-slug"


async def test_the_invite_email_goes_out_through_the_app(
    api: Api, session: AsyncSession, team: TeamService
) -> None:
    sender = record_emails(api)
    vendor = await migrated_vendor(session)
    outgoing = await team.invite_owner(session, vendor)
    await api.app.state.emails.deliver(outgoing.to, outgoing.template, outgoing.context)
    assert [(to, template) for to, template, _ in sender.sent] == [
        ("brand@mongo.test", EmailTemplate.STAFF_INVITE)
    ]


# --- The command -------------------------------------------------------------------------


def test_invite_owner_command_reports_what_it_did(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    calls: list[tuple[str, str | None, VendorStatus | None]] = []

    async def fake(vendor: str, email: str | None, status: VendorStatus | None) -> str:
        calls.append((vendor, email, status))
        return "brand@mongo.test"

    monkeypatch.setattr(cli, "_invite_owner", fake)
    code = cli.main(["invite-owner", "--vendor", "mongo-brand", "--status", "approved"])
    assert code == 0
    assert calls == [("mongo-brand", None, VendorStatus.APPROVED)]
    out = capsys.readouterr().out
    assert "mongo-brand" in out
    assert "brand@mongo.test" in out


def test_invite_owner_command_shows_a_team_error_without_a_traceback(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fake(vendor: str, email: str | None, status: VendorStatus | None) -> str:
        raise TeamError("the owner of x is active: nothing to invite")

    monkeypatch.setattr(cli, "_invite_owner", fake)
    assert cli.main(["invite-owner", "--vendor", "x"]) == 1
    assert "nothing to invite" in capsys.readouterr().err


def test_invite_owner_needs_a_vendor_and_a_known_status(
    capsys: pytest.CaptureFixture[str],
) -> None:
    for argv in (["invite-owner"], ["invite-owner", "--vendor", "x", "--status", "gone"]):
        with pytest.raises(SystemExit):
            cli.main(argv)
    assert "usage" in capsys.readouterr().err.lower()


def test_outgoing_email_keeps_its_token_out_of_its_repr() -> None:
    """The token is in the context for the sender; a log line of the object must not show it."""
    outgoing = OutgoingEmail(
        "a@b.test", EmailTemplate.STAFF_INVITE, {"token": "secret-token-value"}
    )
    assert outgoing.context["token"] == "secret-token-value"
    assert "secret-token-value" not in repr(outgoing)
    assert "secret-token-value" not in str(outgoing)
