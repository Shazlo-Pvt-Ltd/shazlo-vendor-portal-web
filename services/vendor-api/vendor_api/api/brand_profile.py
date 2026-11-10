import re
import uuid
from datetime import datetime
from typing import Annotated, Self, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import CurrentVendorUser, current_vendor_user
from vendor_api.db.session import get_session
from vendor_api.services.brand_profiles import BrandContent, BrandProfileService, ProfileView

router = APIRouter(prefix="/vendor/brand-profile", tags=["brand-profile"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]

# Money is integer paise. The cap (about 10 billion rupees) only keeps absurd values out.
MAX_PAISE = 1_000_000_000_000
MAX_CATEGORIES = 20
HTTPS_URL = re.compile(r"^https://[^\s]+$")
INSTAGRAM_HANDLE = re.compile(r"^[A-Za-z0-9._]{1,30}$")


def get_brand_profiles(request: Request) -> BrandProfileService:
    return cast(BrandProfileService, request.app.state.brand_profiles)


Profiles = Annotated[BrandProfileService, Depends(get_brand_profiles)]


def _blank_to_none(value: object) -> object:
    """An optional text field that arrives empty is the same as one that is not set."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


class BrandProfileBody(BaseModel):
    """The whole editable content of the draft. A `PUT` replaces it, so a field left out is
    cleared; send the page as the editor shows it. The limits are the ones of the published
    contract (ADR 0003), so what is saved here can always be published."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "brand_name": "Atelier Rao",
                    "tagline": "Block prints, made slowly",
                    "about": "A small studio in Jaipur.",
                    "logo_asset_id": "3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c",
                    "banner_asset_id": None,
                    "website_url": "https://atelier.example",
                    "instagram_handle": "atelier.rao",
                    "categories": ["kurtas", "dupattas"],
                    "price_min_paise": 99900,
                    "price_max_paise": 999900,
                }
            ]
        },
    )

    brand_name: str = Field(min_length=1, max_length=120)
    tagline: str | None = Field(default=None, max_length=160)
    about: str | None = Field(default=None, max_length=4000)
    logo_asset_id: uuid.UUID | None = None
    banner_asset_id: uuid.UUID | None = None
    website_url: str | None = Field(default=None, max_length=500)
    instagram_handle: str | None = Field(default=None, max_length=31)
    categories: list[str] = Field(default_factory=list, max_length=MAX_CATEGORIES)
    price_min_paise: int = Field(ge=0, le=MAX_PAISE)
    price_max_paise: int = Field(ge=0, le=MAX_PAISE)

    @field_validator("brand_name", mode="before")
    @classmethod
    def _trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("tagline", "about", "website_url", mode="before")
    @classmethod
    def _trim_optional(cls, value: object) -> object:
        return _blank_to_none(value)

    @field_validator("instagram_handle", mode="before")
    @classmethod
    def _trim_handle(cls, value: object) -> object:
        value = _blank_to_none(value)
        # People paste "@brand"; the stored handle has no "@".
        return value.removeprefix("@") if isinstance(value, str) else value

    @field_validator("website_url")
    @classmethod
    def _https_only(cls, value: str | None) -> str | None:
        if value is not None and not HTTPS_URL.match(value):
            raise ValueError("must be an https:// address without spaces")
        return value

    @field_validator("instagram_handle")
    @classmethod
    def _handle_format(cls, value: str | None) -> str | None:
        if value is not None and not INSTAGRAM_HANDLE.match(value):
            raise ValueError("use 1 to 30 letters, digits, dots or underscores")
        return value

    @field_validator("categories")
    @classmethod
    def _clean_categories(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value]
        if any(not item or len(item) > 80 for item in cleaned):
            raise ValueError("each category must be 1 to 80 characters")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("categories must not repeat")
        return cleaned

    @model_validator(mode="after")
    def _price_range(self) -> Self:
        if self.price_max_paise < self.price_min_paise:
            raise ValueError("price_max_paise must not be below price_min_paise")
        return self


class BrandProfileOut(BaseModel):
    id: uuid.UUID
    version: int
    state: str
    brand_name: str
    tagline: str | None
    about: str | None
    logo_asset_id: uuid.UUID | None
    logo_url: str | None
    banner_asset_id: uuid.UUID | None
    banner_url: str | None
    website_url: str | None
    instagram_handle: str | None
    categories: list[str]
    price_min_paise: int
    price_max_paise: int
    submitted_at: datetime | None
    published_at: datetime | None
    updated_at: datetime


class DraftOut(BrandProfileOut):
    # The version now in review, if any: while it is set, submitting waits (409 review_pending).
    in_review_version: int | None


def _out(view: ProfileView) -> dict[str, object]:
    profile = view.profile
    return {
        "id": profile.id,
        "version": profile.version,
        "state": profile.state,
        "brand_name": profile.brand_name,
        "tagline": profile.tagline,
        "about": profile.about,
        "logo_asset_id": profile.logo_asset_id,
        "logo_url": view.logo_url,
        "banner_asset_id": profile.banner_asset_id,
        "banner_url": view.banner_url,
        "website_url": profile.website_url,
        "instagram_handle": profile.instagram_handle,
        "categories": list(profile.categories),
        "price_min_paise": profile.price_min_paise,
        "price_max_paise": profile.price_max_paise,
        "submitted_at": profile.submitted_at,
        "published_at": profile.published_at,
        "updated_at": profile.updated_at,
    }


def profile_out(view: ProfileView) -> BrandProfileOut:
    return BrandProfileOut(**_out(view))


def draft_out(view: ProfileView) -> DraftOut:
    return DraftOut(**_out(view), in_review_version=view.in_review_version)


@router.get("")
async def get_draft(response: Response, db: Db, profiles: Profiles, current: Current) -> DraftOut:
    """The draft to edit. The first time (and after a submission) it is created from the latest
    version, or from the details given at signup, so the editor always has something to show."""
    no_store(response)
    return draft_out(await profiles.get_draft(db, current.vendor, current.user.id))


@router.put("")
async def save_draft(
    body: BrandProfileBody, response: Response, db: Db, profiles: Profiles, current: Current
) -> DraftOut:
    """Replaces the draft's content. It never changes the published version. Staff and owner can
    both edit; images must be this vendor's ready logo and banner uploads."""
    no_store(response)
    view = await profiles.save_draft(
        db, current.vendor, current.user.id, BrandContent(**body.model_dump())
    )
    return draft_out(view)


@router.post("/submit")
async def submit(
    response: Response, db: Db, profiles: Profiles, current: Current
) -> BrandProfileOut:
    """Sends the draft for review. It needs at least one category, and only one version can be in
    review at a time (409 `review_pending`). While it waits, the vendor can keep editing a new
    draft. The submitted version can no longer be changed."""
    no_store(response)
    return profile_out(await profiles.submit(db, current.vendor, current.user.id))


@router.get("/published")
async def get_published(
    response: Response, db: Db, profiles: Profiles, current: Current
) -> BrandProfileOut:
    """The version shoppers see: the last one an admin approved (404 until there is one)."""
    no_store(response)
    return profile_out(await profiles.get_published(db, current.vendor))
