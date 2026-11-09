import hashlib
import json
import logging
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.app import create_app
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    AuthToken,
    TokenPurpose,
    Vendor,
    VendorStatusEvent,
    VendorUser,
    VendorUserStatus,
)
from vendor_api.db.session import get_session
from vendor_api.services.email import (
    ConsoleEmailSender,
    EmailSender,
    EmailService,
    EmailTemplate,
)
from vendor_api.services.signup import SignupService

PASSWORD = "correct horse battery"  # noqa: S105
EMAIL = "asha@atelier.test"
SIGNUP: dict[str, Any] = {
    "brand_name": "Atelier Rouge",
    "contact_name": "Asha Rao",
    "email": "Asha@Atelier.test",
    "phone": "+91 98765 43210",
    "product_type": "apparel",
    "price_min_paise": 99_900,
    "price_max_paise": 499_900,
    "password": PASSWORD,
    "terms_accepted": True,
}


@dataclass
class RecordingSender:
    """Records what the app tries to send, and forwards it to the console backend (which logs
    only the template outside dev), so the log assertions see the real log lines."""

    inner: EmailSender
    sent: list[tuple[str, EmailTemplate, Mapping[str, object]]] = field(default_factory=list)

    async def send(self, to: str, template: EmailTemplate, context: Mapping[str, object]) -> None:
        self.sent.append((to, template, dict(context)))
        await self.inner.send(to, template, context)

    def tokens(self) -> list[str]:
        return [str(context["token"]) for _, _, context in self.sent if "token" in context]


@dataclass
class Api:
    http: httpx.AsyncClient
    app: FastAPI
    sender: RecordingSender

    async def signup(self, **changes: Any) -> httpx.Response:
        return await self.http.post("/v1/auth/signup", json={**SIGNUP, **changes})

    async def verify(self, token: str) -> httpx.Response:
        return await self.http.post("/v1/auth/verify-email", json={"token": token})

    async def resend(self, email: str) -> httpx.Response:
        return await self.http.post("/v1/auth/resend-verification", json={"email": email})


@pytest.fixture
def api_settings(settings: Settings, override: Any) -> Settings:
    # Small costs keep the password tests fast.
    result: Settings = override(settings, argon2_memory_cost_kib=8, argon2_time_cost=1)
    return result


@pytest.fixture
async def api(api_settings: Settings, session: AsyncSession) -> AsyncIterator[Api]:
    # A private Redis per test: the rate limits count in it, and tests must not share counters.
    redis = FakeAsyncRedis()
    app = create_app(api_settings, readiness_checks={}, redis=redis)
    sender = RecordingSender(ConsoleEmailSender("https://vendors.test", show_links=False))
    app.state.emails = EmailService(sender, retry_delay_seconds=0)

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session  # rolled back after the test, so tests share no rows

    app.dependency_overrides[get_session] = test_session
    # A crash inside the app becomes a 500 response, as it would behind a real server.
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="https://vendors.test") as http:
        yield Api(http, app, sender)
    await redis.aclose()


async def rows[T](session: AsyncSession, model: type[T]) -> list[T]:
    """All rows of a table, freshly read (bulk updates do not refresh objects already loaded)."""
    result = await session.scalars(select(model).execution_options(populate_existing=True))
    return list(result)


async def count(session: AsyncSession, model: type[Any]) -> int:
    return int(await session.scalar(select(func.count()).select_from(model)) or 0)


def body_without_request_id(response: httpx.Response) -> Any:
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        body["error"].pop("request_id", None)
    return body


# --- Signup ------------------------------------------------------------------------------


async def test_signup_creates_a_pending_vendor_and_an_unverified_owner(
    api: Api, session: AsyncSession
) -> None:
    response = await api.signup()
    assert response.status_code == 202
    assert response.headers["cache-control"] == "no-store"

    (vendor,) = await rows(session, Vendor)
    assert (vendor.name, vendor.slug, vendor.email) == ("Atelier Rouge", "atelier-rouge", EMAIL)
    assert (vendor.status, vendor.price_min_paise, vendor.price_max_paise) == (
        "pending",
        99_900,
        499_900,
    )
    assert vendor.phone == "+91 98765 43210"
    assert (vendor.contact_name, vendor.product_type) == ("Asha Rao", "apparel")

    (owner,) = await rows(session, VendorUser)
    assert owner.vendor_id == vendor.id
    assert (owner.email, owner.role, owner.status) == (EMAIL, "owner", "active")
    assert owner.email_verified_at is None  # cannot be trusted to sign in until verified
    assert owner.last_login_at is None
    assert owner.password_hash is not None
    assert owner.password_hash.startswith("$argon2id$")
    assert PASSWORD not in owner.password_hash
    assert owner.terms_accepted_at is not None
    assert abs(datetime.now(UTC) - owner.terms_accepted_at) < timedelta(minutes=1)

    (event,) = await rows(session, VendorStatusEvent)
    assert event.vendor_id == vendor.id
    assert (event.from_status, event.to_status) == (None, "pending")
    assert (event.actor_type, event.actor_id) == ("vendor", owner.id)


async def test_signup_sends_one_verification_email_with_a_24_hour_token(
    api: Api, session: AsyncSession
) -> None:
    await api.signup()
    ((to, template, context),) = api.sender.sent
    assert (to, template) == (EMAIL, EmailTemplate.VERIFY_EMAIL)
    assert context["expires_in_minutes"] == 24 * 60
    assert context["token"]

    (stored,) = await rows(session, AuthToken)
    (owner,) = await rows(session, VendorUser)
    assert stored.vendor_user_id == owner.id
    assert stored.purpose == TokenPurpose.VERIFY_EMAIL
    assert stored.used_at is None
    assert stored.expires_at - owner.terms_accepted_at == timedelta(hours=24)  # type: ignore[operator]


async def test_only_the_hash_of_the_token_is_stored(api: Api, session: AsyncSession) -> None:
    await api.signup()
    (token,) = api.sender.tokens()
    assert len(token) >= 43  # 256 bits, base64url
    (stored,) = await rows(session, AuthToken)
    assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
    for value in (stored.token_hash, str(stored.purpose), str(stored.expires_at)):
        assert token not in value
    assert token not in json.dumps({k: str(v) for k, v in vars(stored).items()})


async def test_the_response_has_no_email_hash_or_token(api: Api) -> None:
    response = await api.signup()
    (token,) = api.sender.tokens()
    for secret in (EMAIL, "Asha", token, PASSWORD, "argon2", "atelier-rouge"):
        assert secret.lower() not in response.text.lower()
    assert set(response.json()) == {"status", "message"}


@pytest.mark.parametrize(
    "variant", [EMAIL, "ASHA@ATELIER.TEST", "  Asha@Atelier.Test  ", "aSHa@atelier.TEST"]
)
async def test_a_registered_email_gets_the_same_response_in_any_letter_case(
    api: Api, session: AsyncSession, variant: str
) -> None:
    first = await api.signup()
    second = await api.signup(
        email=variant, brand_name="Another Name", password="another password 1"
    )

    assert second.status_code == first.status_code == 202
    assert second.json() == first.json()
    assert second.headers["cache-control"] == first.headers["cache-control"]
    # Only the email differs: "you already have an account", and nothing was created.
    assert [(to, template) for to, template, _ in api.sender.sent] == [
        (EMAIL, EmailTemplate.VERIFY_EMAIL),
        (EMAIL, EmailTemplate.ACCOUNT_EXISTS),
    ]
    assert api.sender.sent[1][2] == {}
    assert await count(session, Vendor) == 1
    assert await count(session, VendorUser) == 1
    assert await count(session, AuthToken) == 1
    assert await count(session, VendorStatusEvent) == 1


async def test_the_original_account_is_untouched_by_a_second_signup(
    api: Api, session: AsyncSession
) -> None:
    await api.signup()
    (before,) = await rows(session, VendorUser)
    old_hash = before.password_hash
    await api.signup(password="attacker chosen pass", brand_name="Hijack")
    (after,) = await rows(session, VendorUser)
    assert after.password_hash == old_hash
    (vendor,) = await rows(session, Vendor)
    assert vendor.name == "Atelier Rouge"


async def test_a_staff_users_email_also_counts_as_registered(
    api: Api, session: AsyncSession
) -> None:
    await api.signup()
    (vendor,) = await rows(session, Vendor)
    session.add(
        VendorUser(vendor_id=vendor.id, email="staff@atelier.test", role="staff", status="invited")
    )
    await session.commit()
    response = await api.signup(email="staff@atelier.test", brand_name="Other Brand")
    assert response.status_code == 202
    assert api.sender.sent[-1][1] == EmailTemplate.ACCOUNT_EXISTS
    assert await count(session, Vendor) == 1


async def test_two_signups_racing_for_one_email_are_answered_alike(
    api: Api, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The existence check passes for both; the unique constraint stops the second."""
    first = await api.signup()

    async def not_seen(self: SignupService, db: AsyncSession, email: str) -> bool:
        return False

    monkeypatch.setattr(SignupService, "_email_taken", not_seen)
    second = await api.signup(brand_name="Racing Brand")

    assert second.status_code == 202
    assert second.json() == first.json()
    assert api.sender.sent[-1][1] == EmailTemplate.ACCOUNT_EXISTS
    assert await count(session, Vendor) == 1
    assert await count(session, VendorUser) == 1


async def test_the_password_is_hashed_for_a_registered_email_too(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A duplicate must cost about as much as a new signup, or the delay gives it away."""
    calls: list[str] = []
    passwords = api.app.state.passwords
    real_hash = passwords.hash

    async def counting_hash(password: str) -> str:
        calls.append("hash")
        return str(await real_hash(password))

    monkeypatch.setattr(passwords, "hash", counting_hash)
    await api.signup()
    await api.signup()
    assert calls == ["hash", "hash"]


@pytest.mark.parametrize(
    "password", ["short", "elevenchars", EMAIL, EMAIL.upper(), "   " + EMAIL + "   "]
)
async def test_a_weak_password_is_refused(api: Api, session: AsyncSession, password: str) -> None:
    response = await api.signup(password=password)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weak_password"
    assert password.strip() not in response.text
    assert await count(session, Vendor) == 0
    assert await count(session, VendorUser) == 0
    assert api.sender.sent == []


async def test_a_password_is_used_exactly_as_typed(api: Api, session: AsyncSession) -> None:
    typed = "  spaces around me  "
    assert (await api.signup(password=typed)).status_code == 202
    (owner,) = await rows(session, VendorUser)
    passwords = api.app.state.passwords
    assert (await passwords.verify_login(owner.password_hash, typed)).ok
    assert not (await passwords.verify_login(owner.password_hash, typed.strip())).ok


async def test_the_password_policy_is_the_shared_one(api: Api) -> None:
    long_enough = await api.signup(password="x" * 12, email="long@enough.test")
    assert long_enough.status_code == 202
    too_long = await api.signup(password="x" * 129, email="too@long.test")
    assert too_long.status_code == 422


@pytest.mark.parametrize("terms", [False])
async def test_terms_must_be_accepted(api: Api, session: AsyncSession, terms: bool) -> None:
    response = await api.signup(terms_accepted=terms)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "terms_not_accepted"
    assert await count(session, Vendor) == 0
    assert api.sender.sent == []


async def test_terms_are_required_not_defaulted(api: Api, session: AsyncSession) -> None:
    payload = {k: v for k, v in SIGNUP.items() if k != "terms_accepted"}
    response = await api.http.post("/v1/auth/signup", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert await count(session, Vendor) == 0


async def test_a_validation_error_never_echoes_the_password(api: Api) -> None:
    response = await api.signup(price_min_paise=500, price_max_paise=100)
    assert response.status_code == 422
    assert PASSWORD not in response.text
    assert EMAIL not in response.text.lower()


async def test_the_vendor_and_the_owner_are_created_together_or_not_at_all(
    api: Api, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(self: SignupService, db: AsyncSession, user_id: Any, now: Any) -> str:
        raise RuntimeError("boom")

    monkeypatch.setattr(SignupService, "_issue_token", fail)
    response = await api.signup()
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert await count(session, Vendor) == 0
    assert await count(session, VendorUser) == 0
    assert await count(session, VendorStatusEvent) == 0
    assert await count(session, AuthToken) == 0
    assert api.sender.sent == []


async def test_a_failing_email_provider_does_not_fail_signup(
    api: Api, session: AsyncSession
) -> None:
    class Broken:
        async def send(
            self, to: str, template: EmailTemplate, context: Mapping[str, object]
        ) -> None:
            raise ConnectionError("provider down")

    api.app.state.emails = EmailService(Broken(), attempts=2, retry_delay_seconds=0)
    response = await api.signup()
    assert response.status_code == 202
    assert await count(session, Vendor) == 1


# --- Slugs -------------------------------------------------------------------------------


async def test_slugs_come_from_the_brand_name_with_a_numeric_suffix_on_collision(
    api: Api, session: AsyncSession
) -> None:
    for number in range(3):
        await api.signup(email=f"owner{number}@atelier.test")
    slugs = sorted(vendor.slug for vendor in await rows(session, Vendor))
    assert slugs == ["atelier-rouge", "atelier-rouge-2", "atelier-rouge-3"]


async def test_a_slug_taken_by_a_different_name_is_skipped(api: Api, session: AsyncSession) -> None:
    session.add(
        Vendor(
            name="Atelier-Rouge!",
            slug="atelier-rouge",
            email="first@elsewhere.test",
            phone="+91 98765 43210",
            contact_name="Someone",
            product_type="apparel",
            price_min_paise=0,
            price_max_paise=0,
        )
    )
    await session.commit()
    await api.signup()
    slugs = {vendor.slug for vendor in await rows(session, Vendor)}
    assert slugs == {"atelier-rouge", "atelier-rouge-2"}


async def test_a_slug_taken_between_the_check_and_the_insert_is_retried(
    api: Api, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await api.signup(email="first@atelier.test")
    real = SignupService._free_slug
    calls: list[str] = []

    async def stale_then_real(self: SignupService, db: AsyncSession, base: str) -> str:
        calls.append(base)
        if len(calls) == 1:
            return "atelier-rouge"  # what the check saw before the other signup committed
        return await real(self, db, base)

    monkeypatch.setattr(SignupService, "_free_slug", stale_then_real)
    response = await api.signup(email="second@atelier.test")
    assert response.status_code == 202
    assert len(calls) == 2
    assert sorted(v.slug for v in await rows(session, Vendor)) == [
        "atelier-rouge",
        "atelier-rouge-2",
    ]
    assert await count(session, VendorUser) == 2


async def test_a_name_with_no_latin_letters_still_gets_a_valid_slug(
    api: Api, session: AsyncSession
) -> None:
    await api.signup(brand_name="कपड़े घर")
    (vendor,) = await rows(session, Vendor)
    assert vendor.slug == "vendor"


# --- Verification ------------------------------------------------------------------------


async def test_a_token_verifies_the_email_once(api: Api, session: AsyncSession) -> None:
    await api.signup()
    (token,) = api.sender.tokens()

    first = await api.verify(token)
    assert first.status_code == 204
    assert first.content == b""
    assert first.headers["cache-control"] == "no-store"
    (owner,) = await rows(session, VendorUser)
    assert owner.email_verified_at is not None
    (stored,) = await rows(session, AuthToken)
    assert stored.used_at is not None

    second = await api.verify(token)
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "invalid_token"


async def test_verifying_does_not_approve_the_vendor(api: Api, session: AsyncSession) -> None:
    await api.signup()
    await api.verify(api.sender.tokens()[0])
    (vendor,) = await rows(session, Vendor)
    assert vendor.status == "pending"  # an admin approves it (Phase 3)
    (owner,) = await rows(session, VendorUser)
    assert owner.status == VendorUserStatus.ACTIVE


async def test_an_expired_token_is_refused(api: Api, session: AsyncSession) -> None:
    await api.signup()
    (token,) = api.sender.tokens()
    await session.execute(
        update(AuthToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    response = await api.verify(token)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_token"
    (owner,) = await rows(session, VendorUser)
    assert owner.email_verified_at is None
    (stored,) = await rows(session, AuthToken)
    assert stored.used_at is None


async def test_a_token_works_until_it_expires(api: Api, session: AsyncSession) -> None:
    await api.signup()
    (token,) = api.sender.tokens()
    await session.execute(
        update(AuthToken).values(expires_at=datetime.now(UTC) + timedelta(minutes=1))
    )
    assert (await api.verify(token)).status_code == 204


async def test_the_lifetime_is_a_setting(
    api_settings: Settings, session: AsyncSession, override: Any
) -> None:
    short = override(api_settings, email_verification_ttl_minutes=10)
    app = create_app(short, readiness_checks={}, redis=FakeAsyncRedis())
    sender = RecordingSender(ConsoleEmailSender("https://v.test", show_links=False))
    app.state.emails = EmailService(sender, retry_delay_seconds=0)

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = test_session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://v.test") as http:
        await http.post("/v1/auth/signup", json=SIGNUP)
    assert sender.sent[0][2]["expires_in_minutes"] == 10
    (stored,) = await rows(session, AuthToken)
    (owner,) = await rows(session, VendorUser)
    assert stored.expires_at - owner.terms_accepted_at == timedelta(minutes=10)  # type: ignore[operator]


@pytest.mark.parametrize("kind", ["unknown", "used", "expired", "other_purpose", "garbage"])
async def test_every_kind_of_bad_token_gets_one_generic_error(
    api: Api, session: AsyncSession, kind: str
) -> None:
    await api.signup()
    (good,) = api.sender.tokens()
    reference = await api.verify("never-issued-token")

    if kind == "used":
        assert (await api.verify(good)).status_code == 204
        token = good
    elif kind == "expired":
        await session.execute(
            update(AuthToken).values(expires_at=datetime.now(UTC) - timedelta(hours=1))
        )
        token = good
    elif kind == "other_purpose":
        await session.execute(update(AuthToken).values(purpose=TokenPurpose.RESET_PASSWORD))
        token = good
    elif kind == "garbage":
        token = "%00' OR 1=1 --"
    else:
        token = "unknown-but-well-formed-" + "x" * 30

    response = await api.verify(token)
    assert response.status_code == reference.status_code == 400
    assert body_without_request_id(response) == body_without_request_id(reference)


async def test_a_reset_token_cannot_verify_an_email(api: Api, session: AsyncSession) -> None:
    await api.signup()
    (token,) = api.sender.tokens()
    await session.execute(update(AuthToken).values(purpose=TokenPurpose.INVITE))
    assert (await api.verify(token)).status_code == 400
    (owner,) = await rows(session, VendorUser)
    assert owner.email_verified_at is None


# --- Resend ------------------------------------------------------------------------------


async def test_resend_sends_a_new_link_and_ends_the_old_one(
    api: Api, session: AsyncSession
) -> None:
    await api.signup()
    (old,) = api.sender.tokens()

    response = await api.resend(EMAIL)
    assert response.status_code == 202
    assert [(to, template) for to, template, _ in api.sender.sent] == [
        (EMAIL, EmailTemplate.VERIFY_EMAIL),
        (EMAIL, EmailTemplate.VERIFY_EMAIL),
    ]
    new = api.sender.tokens()[1]
    assert new != old

    assert (await api.verify(old)).status_code == 400  # the newer token invalidated it
    assert (await api.verify(new)).status_code == 204
    # The ended one is kept as a spent row, not deleted.
    assert await count(session, AuthToken) == 2


async def test_resend_twice_leaves_only_the_last_token_valid(api: Api) -> None:
    await api.signup()
    await api.resend(EMAIL)
    await api.resend(EMAIL)
    first, second, third = api.sender.tokens()
    assert [(await api.verify(token)).status_code for token in (first, second, third)] == [
        400,
        400,
        204,
    ]


async def test_resend_matches_the_email_in_any_letter_case(api: Api) -> None:
    await api.signup()
    await api.resend("  ASHA@ATELIER.TEST ")
    assert len(api.sender.sent) == 2


async def test_resend_answers_alike_for_every_kind_of_email(
    api: Api, session: AsyncSession
) -> None:
    await api.signup(email="verified@atelier.test", brand_name="Verified Co")
    await api.verify(api.sender.tokens()[0])
    await api.signup(email="unverified@atelier.test", brand_name="Unverified Co")
    sent_before = len(api.sender.sent)

    unknown = await api.resend("nobody@nowhere.test")
    verified = await api.resend("verified@atelier.test")
    unverified = await api.resend("unverified@atelier.test")

    assert unknown.status_code == verified.status_code == unverified.status_code == 202
    assert unknown.json() == verified.json() == unverified.json()
    # Only the unverified one got an email.
    assert len(api.sender.sent) == sent_before + 1
    assert api.sender.sent[-1][0] == "unverified@atelier.test"


async def test_resend_skips_users_who_are_not_active(api: Api, session: AsyncSession) -> None:
    await api.signup()
    (vendor,) = await rows(session, Vendor)
    session.add_all(
        [
            VendorUser(
                vendor_id=vendor.id, email="invited@atelier.test", role="staff", status="invited"
            ),
            VendorUser(
                vendor_id=vendor.id, email="gone@atelier.test", role="staff", status="disabled"
            ),
        ]
    )
    await session.commit()
    sent_before = len(api.sender.sent)
    for email in ("invited@atelier.test", "gone@atelier.test"):
        assert (await api.resend(email)).status_code == 202
    assert len(api.sender.sent) == sent_before


async def test_resend_response_has_no_email_or_token(api: Api) -> None:
    await api.signup()
    response = await api.resend(EMAIL)
    assert EMAIL not in response.text
    assert api.sender.tokens()[-1] not in response.text


@pytest.mark.parametrize("payload", [{}, {"email": "nope"}, {"email": EMAIL, "x": 1}])
async def test_resend_validates_its_input(api: Api, payload: dict[str, Any]) -> None:
    response = await api.http.post("/v1/auth/resend-verification", json=payload)
    assert response.status_code == 422


# --- Logs --------------------------------------------------------------------------------


async def test_no_log_line_carries_a_password_a_token_or_a_hash(
    api: Api, session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        await api.signup()
        await api.signup()  # a duplicate
        await api.resend(EMAIL)
        await api.verify(api.sender.tokens()[-1])
        await api.verify(api.sender.tokens()[0])  # a refused token
        await api.signup(password="short")  # a refused password
    (owner,) = await rows(session, VendorUser)
    assert owner.password_hash is not None
    text = "\n".join(
        record.getMessage() + json.dumps(record.__dict__, default=str) for record in caplog.records
    )
    assert caplog.records
    for secret in [PASSWORD, owner.password_hash, *api.sender.tokens()]:
        assert secret not in text
    assert EMAIL not in text.lower()
