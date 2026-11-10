import re
import uuid
from datetime import datetime
from typing import Annotated, Literal, Self, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import CurrentVendorUser, current_vendor_user
from vendor_api.db.models import Gender, ProductStatus
from vendor_api.db.session import get_session
from vendor_api.services.products import (
    MAX_PAGE_SIZE,
    ImageInput,
    ProductContent,
    ProductService,
    ProductSummary,
    ProductView,
    RevisionView,
    VariantInput,
)

router = APIRouter(prefix="/vendor/products", tags=["products"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]

# Money is integer paise. The cap (about 10 billion rupees) only keeps absurd values out.
MAX_PAISE = 1_000_000_000_000
MAX_VARIANTS = 100
MAX_IMAGES = 10  # the database allows positions 1 to 10
SKU_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/ -]*$")


def get_products(request: Request) -> ProductService:
    return cast(ProductService, request.app.state.products)


Products = Annotated[ProductService, Depends(get_products)]


def _blank_to_none(value: object) -> object:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _clean_sku(value: str) -> str:
    value = value.strip()
    if not SKU_PATTERN.match(value):
        raise ValueError("use letters, digits, dots, dashes, slashes or spaces, starting with one")
    return value


class VariantBody(BaseModel):
    """A sellable variant. Its `sku` is its identity: the same SKU in a later edit is the same
    variant, so its size and colour cannot change (use a new SKU instead)."""

    model_config = ConfigDict(extra="forbid")

    sku: str = Field(min_length=1, max_length=64)
    size: str = Field(default="", max_length=32)
    color: str = Field(default="", max_length=32)
    price_paise: int = Field(gt=0, le=MAX_PAISE)
    mrp_paise: int = Field(gt=0, le=MAX_PAISE)
    is_active: bool = True

    @field_validator("sku", mode="before")
    @classmethod
    def _trim_sku(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("sku")
    @classmethod
    def _sku_format(cls, value: str) -> str:
        return _clean_sku(value)

    @field_validator("size", "color", mode="before")
    @classmethod
    def _trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _mrp(self) -> Self:
        if self.mrp_paise < self.price_paise:
            raise ValueError("mrp_paise must not be below price_paise")
        return self


class ImageBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: uuid.UUID
    alt_text: str | None = Field(default=None, max_length=200)

    @field_validator("alt_text", mode="before")
    @classmethod
    def _trim_alt(cls, value: object) -> object:
        return _blank_to_none(value)


class ProductContentBody(BaseModel):
    """The whole content of one revision. A `PUT` replaces it, so a field or list left out is
    cleared. Limits are the ones of the published contract (ADR 0003)."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    category: str = Field(min_length=1, max_length=100)
    subcategory: str | None = Field(default=None, max_length=100)
    gender: Gender
    fabric: str | None = Field(default=None, max_length=80)
    weight_grams: int | None = Field(default=None, gt=0, le=1_000_000)
    returnable: bool = False
    return_window_days: int | None = Field(default=None, ge=0, le=30)
    variants: list[VariantBody] = Field(default_factory=list, max_length=MAX_VARIANTS)
    images: list[ImageBody] = Field(default_factory=list, max_length=MAX_IMAGES)

    @field_validator("title", "category", mode="before")
    @classmethod
    def _trim_required(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("description", "subcategory", "fabric", mode="before")
    @classmethod
    def _trim_optional(cls, value: object) -> object:
        return _blank_to_none(value)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.returnable and self.return_window_days is None:
            raise ValueError("return_window_days is required when the product is returnable")
        if not self.returnable:
            self.return_window_days = None  # a window means nothing for a non-returnable product
        skus = [v.sku.lower() for v in self.variants]
        if len(set(skus)) != len(skus):
            raise ValueError("variant SKUs must not repeat (letter case is ignored)")
        looks = [(v.size.lower(), v.color.lower()) for v in self.variants]
        if len(set(looks)) != len(looks):
            raise ValueError("two variants cannot have the same size and colour")
        assets = [i.asset_id for i in self.images]
        if len(set(assets)) != len(assets):
            raise ValueError("an image can be used only once per product")
        return self

    def to_content(self) -> ProductContent:
        return ProductContent(
            title=self.title,
            description=self.description,
            category=self.category,
            subcategory=self.subcategory,
            gender=self.gender,
            fabric=self.fabric,
            weight_grams=self.weight_grams,
            returnable=self.returnable,
            return_window_days=self.return_window_days,
            variants=[VariantInput(**v.model_dump()) for v in self.variants],
            images=[ImageInput(**i.model_dump()) for i in self.images],
        )


class CreateProductBody(ProductContentBody):
    """A new product. The `sku` is its identity and cannot be changed afterwards."""

    sku: str = Field(min_length=1, max_length=64)

    @field_validator("sku", mode="before")
    @classmethod
    def _trim_sku(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("sku")
    @classmethod
    def _sku_format(cls, value: str) -> str:
        return _clean_sku(value)


class VariantOut(BaseModel):
    id: uuid.UUID
    sku: str
    size: str
    color: str
    price_paise: int
    mrp_paise: int
    is_active: bool


class ImageOut(BaseModel):
    asset_id: uuid.UUID
    url: str
    position: int
    alt_text: str | None


class ReviewOut(BaseModel):
    status: str
    reason: str | None
    decided_at: datetime | None


class RevisionOut(BaseModel):
    id: uuid.UUID
    version: int
    # `live`, or for the working revision: editing, in_review, rejected or withdrawn.
    state: str
    title: str
    description: str | None
    category: str
    subcategory: str | None
    gender: str
    fabric: str | None
    weight_grams: int | None
    returnable: bool
    return_window_days: int | None
    variants: list[VariantOut]
    images: list[ImageOut]
    submitted_at: datetime | None
    review: ReviewOut | None
    updated_at: datetime


class ProductOut(BaseModel):
    id: uuid.UUID
    sku: str
    status: str
    version: int
    created_at: datetime
    updated_at: datetime
    # What shoppers see: the approved revision. Null until the product is approved.
    live: RevisionOut | None
    # What the vendor is editing or has in review. Never changes `live` until it is approved.
    working: RevisionOut | None


class ProductSummaryOut(BaseModel):
    id: uuid.UUID
    sku: str
    status: str
    version: int
    title: str
    category: str
    has_pending_changes: bool
    updated_at: datetime


class ProductPageOut(BaseModel):
    items: list[ProductSummaryOut]
    total: int
    limit: int
    offset: int


def _revision_out(view: RevisionView, state: str | None = None) -> RevisionOut:
    revision = view.revision
    review = view.review
    return RevisionOut(
        id=revision.id,
        version=revision.version,
        state=state or view.state,
        title=revision.title,
        description=revision.description,
        category=revision.category,
        subcategory=revision.subcategory,
        gender=revision.gender,
        fabric=revision.fabric,
        weight_grams=revision.weight_grams,
        returnable=revision.returnable,
        return_window_days=revision.return_window_days,
        variants=[VariantOut(**vars_of(v)) for v in view.variants],
        images=[ImageOut(**vars_of(i)) for i in view.images],
        submitted_at=revision.submitted_at,
        review=(
            ReviewOut(status=review.status, reason=review.reason, decided_at=review.decided_at)
            if review is not None
            else None
        ),
        updated_at=revision.updated_at,
    )


def vars_of(view: object) -> dict[str, object]:
    return dict(vars(view))


def product_out(view: ProductView) -> ProductOut:
    product = view.product
    return ProductOut(
        id=product.id,
        sku=product.sku,
        status=product.status,
        version=product.version,
        created_at=product.created_at,
        updated_at=product.updated_at,
        live=_revision_out(view.live, "live") if view.live else None,
        working=_revision_out(view.working) if view.working else None,
    )


def summary_out(item: ProductSummary) -> ProductSummaryOut:
    product = item.product
    return ProductSummaryOut(
        id=product.id,
        sku=product.sku,
        status=product.status,
        version=product.version,
        title=item.title,
        category=item.category,
        has_pending_changes=product.pending_revision_id is not None,
        updated_at=product.updated_at,
    )


@router.get("")
async def list_products(
    response: Response,
    db: Db,
    products: Products,
    current: Current,
    status: Annotated[
        Literal["draft", "pending_review", "approved", "rejected", "archived"] | None,
        Query(description="Only products in this status. Archived ones show only when asked."),
    ] = None,
    category: Annotated[str | None, Query(max_length=100)] = None,
    q: Annotated[str | None, Query(max_length=100, description="Part of the SKU or title")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> ProductPageOut:
    """The vendor's products, most recently changed first."""
    no_store(response)
    page = await products.list_products(
        db,
        current.vendor.id,
        status=ProductStatus(status) if status else None,
        category=category.strip() if category else None,
        search=q.strip() if q else None,
        limit=limit,
        offset=offset,
    )
    return ProductPageOut(
        items=[summary_out(item) for item in page.items],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post("", status_code=201)
async def create_product(
    body: CreateProductBody, response: Response, db: Db, products: Products, current: Current
) -> ProductOut:
    """A new `draft` product. Images and variants can be added later, but are needed to submit.
    `409 sku_taken` if the vendor already uses the SKU (case is ignored, archived products keep
    theirs)."""
    no_store(response)
    view = await products.create(db, current.vendor, current.user.id, body.sku, body.to_content())
    response.headers["Location"] = f"/v1/vendor/products/{view.product.id}"
    return product_out(view)


@router.get("/{product_id}")
async def get_product(
    product_id: uuid.UUID, response: Response, db: Db, products: Products, current: Current
) -> ProductOut:
    no_store(response)
    return product_out(await products.get(db, current.vendor.id, product_id))


@router.put("/{product_id}")
async def update_product(
    product_id: uuid.UUID,
    body: ProductContentBody,
    response: Response,
    db: Db,
    products: Products,
    current: Current,
) -> ProductOut:
    """Replaces the content of the revision being edited. Editing an approved product leaves
    what is live untouched: it creates a new pending revision (`working`) that goes live only
    when approved. `409 product_in_review` while a version is in review. The SKU cannot change."""
    no_store(response)
    view = await products.update(db, current.vendor, current.user.id, product_id, body.to_content())
    return product_out(view)


@router.post("/{product_id}/submit")
async def submit_product(
    product_id: uuid.UUID, response: Response, db: Db, products: Products, current: Current
) -> ProductOut:
    """Sends the revision being edited for review. It needs at least one active variant and one
    image (`422 product_incomplete`). The submitted revision is frozen."""
    no_store(response)
    return product_out(await products.submit(db, current.vendor, current.user.id, product_id))


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: uuid.UUID, db: Db, products: Products, current: Current
) -> Response:
    """Deletes a product that was never submitted; archives one that was (it keeps its history
    and SKU, and an approved one goes off sale). `409 product_in_review` while in review."""
    await products.delete(db, current.vendor, product_id)
    response = Response(status_code=204)
    no_store(response)
    return response
