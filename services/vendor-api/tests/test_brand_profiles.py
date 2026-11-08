import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from factories import (
    count,
    make_asset,
    make_profile,
    saved_asset,
    saved_profile,
    saved_user,
    saved_vendor,
)
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import (
    Asset,
    AssetKind,
    AssetStatus,
    BrandProfile,
    BrandProfileState,
)

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
# A submitted profile needs a category and a submission time.
SUBMITTED: dict[str, Any] = {
    "state": BrandProfileState.PENDING_REVIEW,
    "categories": ["dresses"],
    "submitted_at": NOW,
}
PUBLISHED: dict[str, Any] = {
    "state": BrandProfileState.PUBLISHED,
    "categories": ["dresses"],
    "submitted_at": NOW,
    "published_at": NOW,
}


async def two_vendors(session: AsyncSession) -> tuple[Any, Any]:
    first = await saved_vendor(session, slug="first", email="owner@first.test")
    second = await saved_vendor(session, slug="second", email="owner@second.test")
    return first, second


# --- assets ------------------------------------------------------------------------------


async def test_asset_defaults(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    asset = Asset(
        vendor_id=vendor.id,
        kind=AssetKind.PRODUCT_IMAGE,
        public_id="shazlo/p-1",
        url="https://res.cloudinary.test/p-1.jpg",
        created_by=user.id,
    )
    session.add(asset)
    await session.flush()
    await session.refresh(asset)
    assert isinstance(asset.id, uuid.UUID)
    assert asset.provider == "cloudinary"
    assert asset.status == AssetStatus.PENDING
    assert (asset.format, asset.bytes, asset.width, asset.height) == (None, None, None, None)
    assert asset.created_at is not None
    assert asset.updated_at is not None


@pytest.mark.parametrize("kind", list(AssetKind))
async def test_every_asset_kind_is_accepted(session: AsyncSession, kind: AssetKind) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    await saved_asset(session, vendor, user, kind=kind)


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"kind": "avatar"}, "ck_assets_kind_values"),
        ({"provider": "s3"}, "ck_assets_provider_values"),
        ({"status": "uploaded"}, "ck_assets_status_values"),
        ({"public_id": "   "}, "ck_assets_public_id_not_blank"),
        ({"url": "http://insecure.test/a.png"}, "ck_assets_url_https"),
        ({"url": "ftp://x.test/a.png"}, "ck_assets_url_https"),
        ({"url": "https://has space.test/a.png"}, "ck_assets_url_https"),
        ({"url": "javascript:alert(1)"}, "ck_assets_url_https"),
        ({"bytes": 0}, "ck_assets_bytes_positive"),
        ({"width": 0}, "ck_assets_width_positive"),
        ({"height": -1}, "ck_assets_height_positive"),
        ({"status": "ready", "format": None}, "ck_assets_ready_has_metadata"),
        ({"status": "ready", "bytes": None}, "ck_assets_ready_has_metadata"),
        ({"status": "ready", "width": None}, "ck_assets_ready_has_metadata"),
        ({"status": "ready", "height": None}, "ck_assets_ready_has_metadata"),
    ],
    ids=str,
)
async def test_bad_assets_are_refused(
    session: AsyncSession, changes: dict[str, Any], constraint: str
) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    session.add(make_asset(vendor, user, **changes))
    with pytest.raises(IntegrityError, match=constraint):
        await session.flush()


async def test_a_pending_asset_needs_no_metadata_yet(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    await saved_asset(
        session,
        vendor,
        user,
        status=AssetStatus.PENDING,
        format=None,
        bytes=None,
        width=None,
        height=None,
    )


async def test_a_public_id_is_unique_across_vendors(session: AsyncSession) -> None:
    first, second = await two_vendors(session)
    first_user = await saved_user(session, first, email="a@first.test")
    second_user = await saved_user(session, second, email="a@second.test")
    await saved_asset(session, first, first_user, public_id="shazlo/same")
    session.add(make_asset(second, second_user, public_id="shazlo/same"))
    with pytest.raises(IntegrityError, match="uq_assets_public_id"):
        await session.flush()


async def test_the_format_is_length_limited(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    session.add(make_asset(vendor, user, format="x" * 17))
    with pytest.raises(DBAPIError, match="too long"):
        await session.flush()


async def test_an_asset_needs_an_existing_vendor_and_creator(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    session.add(make_asset(vendor, user, created_by=uuid.uuid4()))
    with pytest.raises(IntegrityError, match="fk_assets_created_by_vendor_users"):
        await session.flush()


async def test_a_vendor_with_assets_cannot_be_deleted(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    await saved_asset(session, vendor, user)
    with pytest.raises(IntegrityError, match="fk_assets_vendor_id_vendors"):
        await session.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor.id})


# --- brand profiles: defaults and content limits ----------------------------------------


async def test_profile_defaults(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor)
    await session.refresh(profile)
    assert isinstance(profile.id, uuid.UUID)
    assert profile.state == BrandProfileState.DRAFT
    assert profile.categories == []
    assert (profile.tagline, profile.about, profile.website_url) == (None, None, None)
    assert (profile.logo_asset_id, profile.banner_asset_id) == (None, None)
    assert (profile.submitted_at, profile.published_at, profile.updated_by) == (None, None, None)
    assert profile.created_at is not None
    assert profile.updated_at is not None


async def test_a_full_profile_round_trips(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    logo = await saved_asset(session, vendor, user)
    banner = await saved_asset(
        session, vendor, user, public_id="shazlo/banner-1", kind=AssetKind.BRAND_BANNER
    )
    await saved_profile(
        session,
        vendor,
        brand_name="Atelier Rouge",
        tagline="Slow fashion from Jaipur",
        about="A long story. " * 20,
        logo_asset_id=logo.id,
        banner_asset_id=banner.id,
        website_url="https://atelier.test",
        instagram_handle="atelier.rouge_1",
        categories=["dresses", "kurtas"],
        updated_by=user.id,
    )
    profile = await session.scalar(select(BrandProfile))
    assert profile is not None
    assert profile.categories == ["dresses", "kurtas"]
    assert profile.logo_asset_id == logo.id
    assert profile.banner_asset_id == banner.id


@pytest.mark.parametrize(
    ("field", "limit"),
    [("brand_name", 120), ("tagline", 160), ("about", 4000), ("website_url", 500)],
)
async def test_text_limits_are_the_contracts(session: AsyncSession, field: str, limit: int) -> None:
    vendor = await saved_vendor(session)
    prefix = "https://" if field == "website_url" else ""
    at_limit = prefix + "a" * (limit - len(prefix))
    await saved_profile(session, vendor, **{field: at_limit})
    session.add(make_profile(vendor, version=2, **{field: at_limit + "a"}))
    with pytest.raises(DBAPIError, match="too long"):
        await session.flush()


async def test_a_blank_brand_name_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, brand_name="   "))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_brand_name_not_blank"):
        await session.flush()


@pytest.mark.parametrize("url", ["https://atelier.test", "https://atelier.test/a?b=c#d"])
async def test_https_website_urls_are_accepted(session: AsyncSession, url: str) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, website_url=url)


@pytest.mark.parametrize(
    "url",
    ["http://atelier.test", "atelier.test", "ftp://atelier.test", "https://a b.test", "https://"],
)
async def test_other_website_urls_are_refused(session: AsyncSession, url: str) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, website_url=url))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_website_https"):
        await session.flush()


@pytest.mark.parametrize("handle", ["a", "atelier.rouge", "At_el.ier_9", "x" * 30])
async def test_good_instagram_handles_are_accepted(session: AsyncSession, handle: str) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, instagram_handle=handle)


@pytest.mark.parametrize("handle", ["", "@atelier", "has space", "dash-ed", "ünï", "x" * 31])
async def test_bad_instagram_handles_are_refused(session: AsyncSession, handle: str) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, instagram_handle=handle))
    with pytest.raises((IntegrityError, DBAPIError), match="instagram_handle|too long"):
        await session.flush()


# --- categories --------------------------------------------------------------------------


async def test_a_draft_may_have_no_categories(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, categories=[])


@pytest.mark.parametrize("state", ["pending_review", "published", "superseded", "rejected"])
async def test_anything_submitted_needs_a_category(session: AsyncSession, state: str) -> None:
    vendor = await saved_vendor(session)
    values = {**PUBLISHED, "state": state, "categories": []}
    if state in ("pending_review", "rejected"):
        values.pop("published_at")
    session.add(make_profile(vendor, **values))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_categories_required_on_submit"):
        await session.flush()


@pytest.mark.parametrize(
    "categories",
    [["dresses", "dresses"], [""], [" dresses"], ["dresses "], ["   "], ["x" * 81]],
    ids=["duplicate", "empty", "leading-space", "trailing-space", "blank", "too-long"],
)
async def test_unclean_category_lists_are_refused(
    session: AsyncSession, categories: list[str]
) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, categories=categories))
    with pytest.raises((IntegrityError, DBAPIError), match="categories_clean|too long"):
        await session.flush()


async def test_a_null_category_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    with pytest.raises(IntegrityError, match="ck_brand_profiles_categories_clean"):
        await session.execute(
            text(
                "INSERT INTO brand_profiles (vendor_id, version, brand_name, price_min_paise, "
                "price_max_paise, categories) VALUES (:v, 1, 'B', 0, 0, ARRAY['a', NULL])"
            ),
            {"v": vendor.id},
        )


async def test_categories_are_case_sensitive_like_the_contract(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, categories=["Dresses", "dresses"])


async def test_the_category_check_accepts_the_longest_allowed_name(
    session: AsyncSession,
) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, categories=["x" * 80, "y"])


# --- price range -------------------------------------------------------------------------


async def test_price_range_may_be_a_single_price(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, price_min_paise=1000, price_max_paise=1000)


async def test_price_max_below_min_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, price_min_paise=1000, price_max_paise=999))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_price_range"):
        await session.flush()


async def test_a_negative_price_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, price_min_paise=-1, price_max_paise=10))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_price_min_not_negative"):
        await session.flush()


# --- states and timestamps ---------------------------------------------------------------


async def test_an_unknown_state_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, state="approved"))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_state_values"):
        await session.flush()


@pytest.mark.parametrize("state", ["pending_review", "published", "superseded", "rejected"])
async def test_anything_submitted_has_a_submission_time(session: AsyncSession, state: str) -> None:
    vendor = await saved_vendor(session)
    published = state in ("published", "superseded")
    session.add(
        make_profile(
            vendor,
            state=state,
            categories=["dresses"],
            published_at=NOW if published else None,
        )
    )
    with pytest.raises(IntegrityError, match="ck_brand_profiles_submitted_at_set"):
        await session.flush()


@pytest.mark.parametrize(
    ("state", "published_at"),
    [
        ("draft", NOW),
        ("pending_review", NOW),
        ("rejected", NOW),
        ("published", None),
        ("superseded", None),
    ],
)
async def test_published_at_goes_with_the_published_states(
    session: AsyncSession, state: str, published_at: datetime | None
) -> None:
    vendor = await saved_vendor(session)
    session.add(
        make_profile(
            vendor,
            state=state,
            categories=["dresses"],
            submitted_at=NOW if state != "draft" else None,
            published_at=published_at,
        )
    )
    with pytest.raises(IntegrityError, match="ck_brand_profiles_published_at_matches_state"):
        await session.flush()


# --- one draft and one published per vendor ----------------------------------------------


async def test_a_second_draft_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, version=1)
    session.add(make_profile(vendor, version=2))
    with pytest.raises(IntegrityError, match="uq_brand_profiles_one_draft_per_vendor"):
        await session.flush()


async def test_a_second_published_profile_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, version=1, **PUBLISHED)
    session.add(make_profile(vendor, version=2, **PUBLISHED))
    with pytest.raises(IntegrityError, match="uq_brand_profiles_one_published_per_vendor"):
        await session.flush()


async def test_a_draft_and_a_published_profile_coexist(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, version=1, **PUBLISHED)
    await saved_profile(session, vendor, version=2)
    assert await count(session, BrandProfile) == 2


async def test_each_vendor_has_its_own_draft_and_published_profile(
    session: AsyncSession,
) -> None:
    first, second = await two_vendors(session)
    for vendor in (first, second):
        await saved_profile(session, vendor, version=1, **PUBLISHED)
        await saved_profile(session, vendor, version=2)
    assert await count(session, BrandProfile) == 4


async def test_history_is_not_limited(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    for version in (1, 2, 3):
        await saved_profile(
            session,
            vendor,
            version=version,
            **{**PUBLISHED, "state": BrandProfileState.SUPERSEDED},
        )
    for version in (4, 5):
        await saved_profile(
            session,
            vendor,
            version=version,
            state=BrandProfileState.REJECTED,
            categories=["dresses"],
            submitted_at=NOW,
        )
    await saved_profile(session, vendor, version=6, **PUBLISHED)
    await saved_profile(session, vendor, version=7)
    assert await count(session, BrandProfile) == 7


async def test_approving_a_draft_is_one_transaction_of_two_updates(
    session: AsyncSession,
) -> None:
    """The layout's promise: Phase 3 publishes a reviewed version with two UPDATEs, in order."""
    vendor = await saved_vendor(session)
    old = await saved_profile(session, vendor, version=1, **PUBLISHED)
    new = await saved_profile(
        session, vendor, version=2, state=BrandProfileState.PENDING_REVIEW,
        categories=["kurtas"], submitted_at=NOW,
    )  # fmt: skip

    await session.execute(
        update(BrandProfile)
        .where(BrandProfile.id == old.id)
        .values(state=BrandProfileState.SUPERSEDED)
    )
    await session.execute(
        update(BrandProfile)
        .where(BrandProfile.id == new.id)
        .values(state=BrandProfileState.PUBLISHED, published_at=NOW)
    )
    states = {
        profile.version: profile.state
        for profile in await session.scalars(
            select(BrandProfile).execution_options(populate_existing=True)
        )
    }
    assert states == {1: "superseded", 2: "published"}


async def test_publishing_before_superseding_is_refused(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, version=1, **PUBLISHED)
    new = await saved_profile(
        session, vendor, version=2, state=BrandProfileState.PENDING_REVIEW,
        categories=["kurtas"], submitted_at=NOW,
    )  # fmt: skip
    with pytest.raises(IntegrityError, match="uq_brand_profiles_one_published_per_vendor"):
        await session.execute(
            update(BrandProfile)
            .where(BrandProfile.id == new.id)
            .values(state=BrandProfileState.PUBLISHED, published_at=NOW)
        )


# --- version -----------------------------------------------------------------------------


async def test_versions_increase(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor, version=1, **PUBLISHED)
    await saved_profile(session, vendor, version=2, **{**PUBLISHED, "state": "superseded"})
    await saved_profile(session, vendor, version=5)  # gaps are fine
    assert await count(session, BrandProfile) == 3


@pytest.mark.parametrize("version", [0, -1])
async def test_a_version_starts_at_one(session: AsyncSession, version: int) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, version=version))
    with pytest.raises(IntegrityError, match="ck_brand_profiles_version_positive"):
        await session.flush()


async def test_a_version_cannot_repeat(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(
        session, vendor, version=1, state="rejected", categories=["a"], submitted_at=NOW
    )
    session.add(make_profile(vendor, version=1))
    with pytest.raises(
        IntegrityError, match="version must be higher|uq_brand_profiles_vendor_id_version"
    ):
        await session.flush()


@pytest.mark.parametrize("version", [1, 2, 3])
async def test_a_version_cannot_go_backwards(session: AsyncSession, version: int) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(
        session, vendor, version=3, state="rejected", categories=["a"], submitted_at=NOW
    )
    session.add(make_profile(vendor, version=version))
    with pytest.raises(IntegrityError, match="version must be higher"):
        await session.flush()


async def test_every_vendor_counts_its_own_versions(session: AsyncSession) -> None:
    first, second = await two_vendors(session)
    await saved_profile(session, first, version=7, **PUBLISHED)
    await saved_profile(session, second, version=1)  # not blocked by the other vendor's 7


async def test_a_version_never_changes(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, version=2)
    with pytest.raises(IntegrityError, match="version cannot change"):
        await session.execute(
            update(BrandProfile).where(BrandProfile.id == profile.id).values(version=3)
        )


async def test_other_updates_are_not_blocked_by_the_version_trigger(
    session: AsyncSession,
) -> None:
    vendor = await saved_vendor(session)
    profile = await saved_profile(session, vendor, version=2)
    profile.tagline = "Edited"
    await session.flush()
    await session.refresh(profile)
    assert profile.tagline == "Edited"
    assert profile.version == 2


# --- assets belong to the profile's vendor -----------------------------------------------


async def test_a_profile_cannot_use_another_vendors_logo(session: AsyncSession) -> None:
    first, second = await two_vendors(session)
    user = await saved_user(session, second, email="a@second.test")
    foreign = await saved_asset(session, second, user)
    session.add(make_profile(first, logo_asset_id=foreign.id))
    with pytest.raises(IntegrityError, match="fk_brand_profiles_logo_asset_id_assets"):
        await session.flush()


async def test_a_profile_cannot_use_another_vendors_banner(session: AsyncSession) -> None:
    first, second = await two_vendors(session)
    user = await saved_user(session, second, email="a@second.test")
    foreign = await saved_asset(session, second, user, kind=AssetKind.BRAND_BANNER)
    session.add(make_profile(first, banner_asset_id=foreign.id))
    with pytest.raises(IntegrityError, match="fk_brand_profiles_banner_asset_id_assets"):
        await session.flush()


async def test_a_profile_cannot_use_an_asset_that_does_not_exist(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, logo_asset_id=uuid.uuid4()))
    with pytest.raises(IntegrityError, match="fk_brand_profiles_logo_asset_id_assets"):
        await session.flush()


async def test_a_profile_can_use_its_own_vendors_assets(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    asset = await saved_asset(session, vendor, user)
    await saved_profile(session, vendor, logo_asset_id=asset.id, banner_asset_id=asset.id)


async def test_pointing_an_existing_profile_at_a_foreign_asset_is_refused(
    session: AsyncSession,
) -> None:
    first, second = await two_vendors(session)
    user = await saved_user(session, second, email="a@second.test")
    foreign = await saved_asset(session, second, user)
    profile = await saved_profile(session, first)
    with pytest.raises(IntegrityError, match="fk_brand_profiles_logo_asset_id_assets"):
        await session.execute(
            update(BrandProfile)
            .where(BrandProfile.id == profile.id)
            .values(logo_asset_id=foreign.id)
        )


async def test_an_asset_in_use_cannot_be_deleted(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    user = await saved_user(session, vendor)
    asset = await saved_asset(session, vendor, user)
    await saved_profile(session, vendor, logo_asset_id=asset.id)
    with pytest.raises(IntegrityError, match="fk_brand_profiles_logo_asset_id_assets"):
        await session.execute(text("DELETE FROM assets WHERE id = :id"), {"id": asset.id})


async def test_a_vendor_with_profiles_cannot_be_deleted(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    await saved_profile(session, vendor)
    with pytest.raises(IntegrityError, match="fk_brand_profiles_vendor_id_vendors"):
        await session.execute(text("DELETE FROM vendors WHERE id = :id"), {"id": vendor.id})


async def test_updated_by_must_be_a_vendor_user(session: AsyncSession) -> None:
    vendor = await saved_vendor(session)
    session.add(make_profile(vendor, updated_by=uuid.uuid4()))
    with pytest.raises(IntegrityError, match="fk_brand_profiles_updated_by_vendor_users"):
        await session.flush()
