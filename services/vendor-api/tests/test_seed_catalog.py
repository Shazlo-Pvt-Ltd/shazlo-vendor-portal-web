"""The dev seed's catalog: vendors in every state, products in every state, reviews to do.

Inserting it at all proves every row obeys the database's rules (the triggers and checks that
guard submitted content). The rest checks the shape, that a second run changes nothing, and
that the admin endpoints really see what the seed promises.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from shazlo_security.passwords import PasswordService
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import IDENTITY_ISSUER, JWKS_URL, Api, Identity, make_api

from vendor_api import cli
from vendor_api.core.security import password_config
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    BrandProfile,
    Product,
    Review,
    ReviewEvent,
    Vendor,
    VendorStatusEvent,
)
from vendor_api.services.seed import (
    DEV_SEED_PASSWORD,
    SEED_OWNER_EMAIL,
    SEED_PENDING_EMAIL,
    SEED_PENDING_SLUG,
    SEED_REVIEWER_ID,
    SEED_SLUG,
    SEED_SUSPENDED_EMAIL,
    CatalogSeed,
    seed_demo_catalog,
    seed_demo_vendor,
)

PASSWORD = DEV_SEED_PASSWORD


@pytest.fixture
def cheap(settings: Settings, override: Any) -> Settings:
    result: Settings = override(
        settings,
        jwt_issuer="https://vendor-api.test",
        identity_jwks_url=JWKS_URL,
        identity_issuer=IDENTITY_ISSUER,
        argon2_memory_cost_kib=8,
        argon2_time_cost=1,
    )
    return result


@pytest.fixture
def hasher(cheap: Settings) -> PasswordService:
    return PasswordService(password_config(cheap))


@pytest.fixture
async def seeded(session: AsyncSession, hasher: PasswordService) -> CatalogSeed:
    assert await seed_demo_vendor(session, hasher, PASSWORD) is True
    catalog = await seed_demo_catalog(session, hasher, PASSWORD)
    assert catalog is not None
    return catalog


@pytest.fixture
def identity() -> Identity:
    return Identity()


@pytest.fixture
async def api(
    cheap: Settings, session: AsyncSession, seeded: CatalogSeed, identity: Identity
) -> AsyncIterator[Api]:
    redis = FakeAsyncRedis()
    async for made in make_api(cheap, session, redis, identity.client):
        yield made
    await redis.aclose()


@pytest.fixture
def admin(identity: Identity) -> dict[str, str]:
    """The headers of a reviewer (an identity-api token with the `vendor_reviewer` role)."""
    return {"Authorization": f"Bearer {identity.token(['vendor_reviewer'])}"}


async def count(session: AsyncSession, model: Any, *where: Any) -> int:
    return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0


# --- What it makes -----------------------------------------------------------------------


async def test_the_seed_makes_vendors_in_three_states(
    session: AsyncSession, seeded: CatalogSeed
) -> None:
    states = dict((await session.execute(select(Vendor.slug, Vendor.status))).all())
    assert states == {
        SEED_SLUG: "approved",
        SEED_PENDING_SLUG: "pending",
        "demo-suspended": "suspended",
    }
    assert len(seeded.vendors) == 3
    # Every vendor has its audit trail from the start.
    assert await count(session, VendorStatusEvent) == 3
    suspended = await session.scalar(select(Vendor).where(Vendor.slug == "demo-suspended"))
    assert suspended is not None and suspended.status_reason


async def test_the_demo_vendors_products_are_in_the_states_the_seed_promises(
    session: AsyncSession, seeded: CatalogSeed
) -> None:
    rows = (await session.execute(select(Product.sku, Product.status, Product.version))).all()
    assert {sku: (status, version) for sku, status, version in rows} == {
        "KURTA-DEMO-01": ("approved", 1),
        "TOTE-DEMO-03": ("pending_review", 1),
        "SCARF-DEMO-02": ("draft", 1),
    }
    kurta = await session.scalar(select(Product).where(Product.sku == "KURTA-DEMO-01"))
    assert kurta is not None
    assert kurta.live_revision_id is not None and kurta.pending_revision_id is not None
    assert kurta.live_revision_id != kurta.pending_revision_id
    assert len(seeded.products) == 3


async def test_the_brand_profile_has_a_live_version_and_one_in_review(
    session: AsyncSession, seeded: CatalogSeed
) -> None:
    demo = await session.scalar(select(Vendor.id).where(Vendor.slug == SEED_SLUG))
    states = (
        await session.execute(
            select(BrandProfile.version, BrandProfile.state)
            .where(BrandProfile.vendor_id == demo)
            .order_by(BrandProfile.version)
        )
    ).all()
    assert [(v, s) for v, s in states] == [(1, "published"), (2, "pending_review")]


async def test_four_reviews_wait_and_two_were_decided_by_the_seed_reviewer(
    session: AsyncSession, seeded: CatalogSeed
) -> None:
    assert await count(session, Review, Review.status == "pending") == 4 == seeded.pending_reviews
    decided = (await session.scalars(select(Review).where(Review.status == "approved"))).all()
    assert len(decided) == 2
    assert {r.reviewer_id for r in decided} == {SEED_REVIEWER_ID}
    # Each review has the submission in its trail; the decided ones also the decision.
    assert await count(session, ReviewEvent, ReviewEvent.action == "submitted") == 6
    assert await count(session, ReviewEvent, ReviewEvent.action == "approved") == 2


# --- Running it again and without a demo vendor ------------------------------------------


async def test_a_second_run_changes_nothing(
    session: AsyncSession, hasher: PasswordService, seeded: CatalogSeed
) -> None:
    before = [
        await count(session, model)
        for model in (Vendor, Product, BrandProfile, Review, ReviewEvent, VendorStatusEvent)
    ]
    assert await seed_demo_catalog(session, hasher, PASSWORD) is None
    after = [
        await count(session, model)
        for model in (Vendor, Product, BrandProfile, Review, ReviewEvent, VendorStatusEvent)
    ]
    assert after == before


async def test_without_the_demo_vendor_there_is_nothing_to_fill(
    session: AsyncSession, hasher: PasswordService
) -> None:
    assert await seed_demo_catalog(session, hasher, PASSWORD) is None
    assert await count(session, Vendor) == 0


# --- It works through the API ------------------------------------------------------------


async def test_the_owners_sign_in_as_their_vendors_state_allows(api: Api) -> None:
    assert (await api.login(SEED_OWNER_EMAIL, PASSWORD)).status_code == 200
    pending = await api.login(SEED_PENDING_EMAIL, PASSWORD)
    assert pending.status_code == 200  # a pending vendor can sign in: it must be able to submit
    assert pending.json()["vendor"]["status"] == "pending"
    suspended = await api.login(SEED_SUSPENDED_EMAIL, PASSWORD)
    assert (suspended.status_code, suspended.json()["error"]["code"]) == (403, "vendor_not_allowed")


async def test_the_admin_queue_shows_the_four_pending_reviews_with_their_diffs(
    api: Api, admin: dict[str, str]
) -> None:
    queue = (await api.http.get("/v1/admin/reviews", headers=admin)).json()
    assert queue["total"] == 4
    by_title = {item["title"]: item for item in queue["items"]}
    assert set(by_title) == {
        "Demo Brand",
        "Demo Pending Brand",
        "Block-print cotton kurta (new cut)",
        "Canvas tote bag",
    }
    assert {i["vendor"]["name"] for i in queue["items"]} == {"Demo Brand", "Demo Pending Brand"}

    brand = (
        await api.http.get(f"/v1/admin/reviews/{by_title['Demo Brand']['id']}", headers=admin)
    ).json()
    assert [c["field"] for c in brand["changes"]] == ["tagline", "categories"]
    assert brand["base"]["version"] == 1 and brand["content"]["version"] == 2

    kurta = (
        await api.http.get(
            f"/v1/admin/reviews/{by_title['Block-print cotton kurta (new cut)']['id']}",
            headers=admin,
        )
    ).json()
    assert [c["field"] for c in kurta["changes"]] == [
        "title",
        "variants[KURTA-DEMO-01-M].price_paise",
        "images[1]",
    ]

    first = (
        await api.http.get(
            f"/v1/admin/reviews/{by_title['Demo Pending Brand']['id']}", headers=admin
        )
    ).json()
    assert first["base"] is None  # a first submission: everything is new


async def test_the_admin_sees_the_pending_application_and_the_suspended_vendor(
    api: Api, admin: dict[str, str]
) -> None:
    pending = (await api.http.get("/v1/admin/vendors", headers=admin)).json()
    assert [v["slug"] for v in pending["items"]] == [SEED_PENDING_SLUG]
    suspended = (await api.http.get("/v1/admin/vendors?status=suspended", headers=admin)).json()
    assert [v["slug"] for v in suspended["items"]] == ["demo-suspended"]


async def test_a_reviewer_can_work_through_the_seeded_queue(
    api: Api, admin: dict[str, str], session: AsyncSession
) -> None:
    """The seed is a real starting point: every pending review can be decided."""
    queue = (await api.http.get("/v1/admin/reviews", headers=admin)).json()
    for item in queue["items"]:
        detail = (await api.http.get(f"/v1/admin/reviews/{item['id']}", headers=admin)).json()
        version = detail["content"]["version"]
        response = await api.http.post(
            f"/v1/admin/reviews/{item['id']}/approve",
            json={"version": version},
            headers=admin,
        )
        assert response.status_code == 200, (item["title"], response.text)
    assert await count(session, Review, Review.status == "pending") == 0
    kurta = await session.scalar(select(Product).where(Product.sku == "KURTA-DEMO-01"))
    assert kurta is not None and kurta.pending_revision_id is None
    assert kurta.version == 2  # the live content changed once


def test_the_command_prints_what_it_made_and_never_the_password(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    catalog = CatalogSeed(
        vendors=["Demo Brand (approved)"], products=["KURTA-DEMO-01 (approved)"], pending_reviews=4
    )
    cli._print_catalog(catalog)
    out = capsys.readouterr().out
    assert "Demo Brand (approved)" in out and "KURTA-DEMO-01" in out
    assert "4 reviews are waiting" in out
    assert "super_admin" in out  # how to review
    assert PASSWORD not in out and "password-" not in out
