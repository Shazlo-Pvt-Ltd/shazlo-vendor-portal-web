import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.db.models import (
    ActorType,
    Asset,
    AssetKind,
    AssetStatus,
    BrandProfile,
    BrandProfileState,
    Review,
    ReviewAction,
    ReviewEvent,
    ReviewSubject,
    Vendor,
)
from vendor_api.db.scoped import scoped_select

Clock = Callable[[], datetime]

NO_PUBLISHED_PROFILE = ApiError(
    404, "no_published_profile", "No brand profile has been approved yet"
)
REVIEW_PENDING = ApiError(
    409,
    "review_pending",
    "A version of the brand profile is already in review. "
    "You can keep editing the draft, but submit it after that review is decided",
)


@dataclass(frozen=True)
class BrandContent:
    """What a vendor writes on the brand page. The API has already checked the shape."""

    brand_name: str
    tagline: str | None
    about: str | None
    logo_asset_id: uuid.UUID | None
    banner_asset_id: uuid.UUID | None
    website_url: str | None
    instagram_handle: str | None
    categories: list[str]
    price_min_paise: int
    price_max_paise: int


@dataclass(frozen=True)
class ProfileView:
    """A profile version with the image URLs its asset ids point at."""

    profile: BrandProfile
    logo_url: str | None
    banner_url: str | None
    # Only for the draft: the version now in review, which blocks a new submission.
    in_review_version: int | None = None


class BrandProfileService:
    """A vendor's brand page: edit the draft, submit it for review, read the published version.

    **Versions** (see `BrandProfile`): a vendor edits the one `draft`; submitting turns it into
    `pending_review`, and from then on it is frozen history. So the vendor never edits what is in
    review or live: the next edit opens a new draft (seeded from the latest version) while the
    old version waits for its decision. Only one version may be in review at a time, so a second
    submission waits until the first is approved or rejected.

    Every write first locks the vendor's row. That serialises one vendor's concurrent requests
    (two tabs saving, a save racing a submit) without touching any other vendor. Every query goes
    through the caller's vendor id, so another vendor's profile cannot be reached.

    Commits its own changes.
    """

    def __init__(self, clock: Clock = lambda: datetime.now(UTC)) -> None:
        self._clock = clock

    # --- Reading ---------------------------------------------------------------------------

    async def get_draft(self, db: AsyncSession, vendor: Vendor, user_id: uuid.UUID) -> ProfileView:
        """The draft to edit. If there is none (never started, or the last one was submitted),
        a new one is made from the latest version, or from the vendor's signup details."""
        await self._lock_vendor(db, vendor.id)
        draft = await self._ensure_draft(db, vendor, user_id)
        await db.commit()
        return await self._view(db, draft, with_review_state=True)

    async def get_published(self, db: AsyncSession, vendor: Vendor) -> ProfileView:
        profile = await db.scalar(
            scoped_select(BrandProfile, vendor.id)
            .where(BrandProfile.state == BrandProfileState.PUBLISHED)
            .execution_options(populate_existing=True)
        )
        if profile is None:
            raise NO_PUBLISHED_PROFILE
        return await self._view(db, profile)

    # --- Writing ---------------------------------------------------------------------------

    async def save_draft(
        self, db: AsyncSession, vendor: Vendor, user_id: uuid.UUID, content: BrandContent
    ) -> ProfileView:
        """Replaces the draft's content (it is made first if there is none)."""
        try:
            await self._lock_vendor(db, vendor.id)
            await self._check_assets(db, vendor.id, content)
            draft = await self._ensure_draft(db, vendor, user_id)
            _apply(draft, content)
            draft.updated_by = user_id
            await db.flush()
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        return await self._view(db, draft, with_review_state=True)

    async def submit(self, db: AsyncSession, vendor: Vendor, user_id: uuid.UUID) -> ProfileView:
        """Sends the draft for review: the draft becomes `pending_review` and a pending review
        and its first audit event are written, all in one transaction."""
        try:
            await self._lock_vendor(db, vendor.id)
            draft = await self._draft(db, vendor.id)
            if draft is None:
                raise ApiError(409, "nothing_to_submit", "There is no draft to submit")
            if await self._in_review_version(db, vendor.id) is not None:
                raise REVIEW_PENDING
            if not draft.categories:
                raise ApiError(
                    422, "profile_incomplete", "Add at least one category before you submit"
                )
            # An image may have been deleted since the draft was saved.
            await self._check_assets(db, vendor.id, _content_of(draft))
            now = self._clock()
            draft.state = BrandProfileState.PENDING_REVIEW
            draft.submitted_at = now
            draft.updated_by = user_id
            review = Review(
                vendor_id=vendor.id,
                subject=ReviewSubject.BRAND_PROFILE,
                brand_profile_id=draft.id,
                submitted_by=user_id,
                submitted_at=now,
            )
            db.add(review)
            await db.flush()
            db.add(
                ReviewEvent(
                    review_id=review.id,
                    action=ReviewAction.SUBMITTED,
                    actor_type=ActorType.VENDOR,
                    actor_id=user_id,
                )
            )
            await db.flush()
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        return await self._view(db, draft)

    # --- Helpers ---------------------------------------------------------------------------

    async def _lock_vendor(self, db: AsyncSession, vendor_id: uuid.UUID) -> None:
        await db.execute(select(Vendor.id).where(Vendor.id == vendor_id).with_for_update())

    async def _draft(self, db: AsyncSession, vendor_id: uuid.UUID) -> BrandProfile | None:
        draft: BrandProfile | None = await db.scalar(
            scoped_select(BrandProfile, vendor_id)
            .where(BrandProfile.state == BrandProfileState.DRAFT)
            .execution_options(populate_existing=True)
        )
        return draft

    async def _in_review_version(self, db: AsyncSession, vendor_id: uuid.UUID) -> int | None:
        return await db.scalar(
            select(BrandProfile.version).where(
                BrandProfile.vendor_id == vendor_id,
                BrandProfile.state == BrandProfileState.PENDING_REVIEW,
            )
        )

    async def _ensure_draft(
        self, db: AsyncSession, vendor: Vendor, user_id: uuid.UUID
    ) -> BrandProfile:
        """The vendor's draft, created if needed. The caller holds the vendor lock and commits."""
        draft = await self._draft(db, vendor.id)
        if draft is not None:
            return draft
        latest = await db.scalar(
            scoped_select(BrandProfile, vendor.id).order_by(BrandProfile.version.desc()).limit(1)
        )
        if latest is not None:
            content = _content_of(latest)
        else:
            content = BrandContent(
                brand_name=vendor.name.strip()[:120] or "My brand",
                tagline=None,
                about=None,
                logo_asset_id=None,
                banner_asset_id=None,
                website_url=None,
                instagram_handle=None,
                categories=[],
                price_min_paise=vendor.price_min_paise,
                price_max_paise=vendor.price_max_paise,
            )
        draft = BrandProfile(
            vendor_id=vendor.id,
            version=latest.version + 1 if latest is not None else 1,
            state=BrandProfileState.DRAFT,
            updated_by=user_id,
            **_columns(content),
        )
        db.add(draft)
        await db.flush()
        return draft

    async def _check_assets(
        self, db: AsyncSession, vendor_id: uuid.UUID, content: BrandContent
    ) -> None:
        """The images must be this vendor's, ready, and of the right kind. Another vendor's file
        gets the same answer as one that does not exist."""
        wanted = (
            ("logo_asset_id", content.logo_asset_id, AssetKind.BRAND_LOGO),
            ("banner_asset_id", content.banner_asset_id, AssetKind.BRAND_BANNER),
        )
        for field, asset_id, kind in wanted:
            if asset_id is None:
                continue
            found = await db.scalar(
                scoped_select(Asset, vendor_id).where(
                    Asset.id == asset_id,
                    Asset.kind == kind,
                    Asset.status == AssetStatus.READY,
                )
            )
            if found is None:
                raise ApiError(
                    422, "invalid_asset", f"{field} must be one of your uploaded {kind} images"
                )

    async def _view(
        self, db: AsyncSession, profile: BrandProfile, with_review_state: bool = False
    ) -> ProfileView:
        urls: dict[uuid.UUID, str] = {}
        ids = [i for i in (profile.logo_asset_id, profile.banner_asset_id) if i is not None]
        if ids:
            rows = await db.execute(
                select(Asset.id, Asset.url).where(
                    Asset.vendor_id == profile.vendor_id, Asset.id.in_(ids)
                )
            )
            urls = {row.id: row.url for row in rows}
        in_review = (
            await self._in_review_version(db, profile.vendor_id) if with_review_state else None
        )
        return ProfileView(
            profile,
            logo_url=urls.get(profile.logo_asset_id) if profile.logo_asset_id else None,
            banner_url=urls.get(profile.banner_asset_id) if profile.banner_asset_id else None,
            in_review_version=in_review,
        )


def _columns(content: BrandContent) -> dict[str, object]:
    return {
        "brand_name": content.brand_name,
        "tagline": content.tagline,
        "about": content.about,
        "logo_asset_id": content.logo_asset_id,
        "banner_asset_id": content.banner_asset_id,
        "website_url": content.website_url,
        "instagram_handle": content.instagram_handle,
        "categories": list(content.categories),
        "price_min_paise": content.price_min_paise,
        "price_max_paise": content.price_max_paise,
    }


def _apply(profile: BrandProfile, content: BrandContent) -> None:
    for column, value in _columns(content).items():
        setattr(profile, column, value)


def _content_of(profile: BrandProfile) -> BrandContent:
    return BrandContent(
        brand_name=profile.brand_name,
        tagline=profile.tagline,
        about=profile.about,
        logo_asset_id=profile.logo_asset_id,
        banner_asset_id=profile.banner_asset_id,
        website_url=profile.website_url,
        instagram_handle=profile.instagram_handle,
        categories=list(profile.categories),
        price_min_paise=profile.price_min_paise,
        price_max_paise=profile.price_max_paise,
    )
