import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from vendor_api.core.errors import ApiError
from vendor_api.db.models import (
    ActorType,
    Asset,
    AssetKind,
    AssetStatus,
    Product,
    ProductImage,
    ProductRevision,
    ProductRevisionVariant,
    ProductStatus,
    ProductVariant,
    Review,
    ReviewAction,
    ReviewEvent,
    ReviewStatus,
    ReviewSubject,
    Vendor,
)
from vendor_api.db.scoped import scoped_select
from vendor_api.services.outbox import OutboxWriter

Clock = Callable[[], datetime]

PRODUCT_NOT_FOUND = ApiError(404, "product_not_found", "Product not found")
SKU_TAKEN = ApiError(409, "sku_taken", "You already use this SKU (SKUs ignore letter case)")
PRODUCT_IN_REVIEW = ApiError(
    409,
    "product_in_review",
    "This product has a version in review. Wait for the decision before changing it",
)
PRODUCT_ARCHIVED = ApiError(409, "product_archived", "This product is archived")
NOTHING_TO_SUBMIT = ApiError(
    409, "nothing_to_submit", "There are no unsubmitted changes to send for review"
)

MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class VariantInput:
    """A variant as the vendor lists it. The SKU is its identity: the same SKU in a later
    revision is the same variant (the central app keeps updating one `variant_id`)."""

    sku: str
    size: str
    color: str
    price_paise: int
    mrp_paise: int
    is_active: bool


@dataclass(frozen=True)
class ImageInput:
    asset_id: uuid.UUID
    alt_text: str | None


@dataclass(frozen=True)
class ProductContent:
    """The whole content of one revision. The API has already checked the shape."""

    title: str
    description: str | None
    category: str
    subcategory: str | None
    gender: str
    fabric: str | None
    weight_grams: int | None
    returnable: bool
    return_window_days: int | None
    variants: list[VariantInput]
    images: list[ImageInput]


@dataclass(frozen=True)
class VariantView:
    id: uuid.UUID
    sku: str
    size: str
    color: str
    price_paise: int
    mrp_paise: int
    is_active: bool


@dataclass(frozen=True)
class ImageView:
    asset_id: uuid.UUID
    url: str
    position: int
    alt_text: str | None


@dataclass(frozen=True)
class RevisionView:
    revision: ProductRevision
    variants: list[VariantView]
    images: list[ImageView]
    # The latest review of this revision, if it was ever submitted.
    review: Review | None

    @property
    def state(self) -> str:
        """`editing` (not submitted), `in_review`, `rejected` or `withdrawn`; `approved` is the
        live revision."""
        if self.review is None:
            return "editing" if self.revision.submitted_at is None else "in_review"
        return {
            ReviewStatus.PENDING: "in_review",
            ReviewStatus.APPROVED: "approved",
            ReviewStatus.REJECTED: "rejected",
            ReviewStatus.WITHDRAWN: "withdrawn",
        }[ReviewStatus(self.review.status)]


@dataclass(frozen=True)
class ProductView:
    product: Product
    live: RevisionView | None
    # The revision being edited or reviewed (or the last rejected one): never what shoppers see.
    working: RevisionView | None


@dataclass(frozen=True)
class ProductSummary:
    product: Product
    # From the latest revision: the one the vendor last worked on.
    title: str
    category: str


@dataclass(frozen=True)
class ProductPage:
    items: list[ProductSummary]
    total: int
    limit: int
    offset: int


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class ProductService:
    """A vendor's catalog: create, list, read, edit, submit, delete or archive products.

    **Content lives in revisions.** A product's `live_revision_id` is what shoppers see and its
    `pending_revision_id` is the revision being edited or reviewed. An edit never touches the
    live revision: editing an approved product adds a new revision (the next version number) and
    points `pending_revision_id` at it, while the status stays `approved`. A revision that was
    submitted is frozen by the database, so while one is in review the product cannot be edited
    (`409 product_in_review`): there is room for one pending revision, and a decision comes soon.

    **Variants** keep their identity (SKU, size, colour) across revisions; each revision says
    which variants it offers and at what price. **SKUs** are unique per vendor ignoring case, for
    products and for variants, and stay reserved when a product is archived.

    Every write first locks the product row, so two requests on one product run one after the
    other. Every query goes through the caller's vendor id: another vendor's product is a 404.
    Commits its own changes.
    """

    def __init__(
        self, clock: Clock = lambda: datetime.now(UTC), events: OutboxWriter | None = None
    ) -> None:
        self._clock = clock
        self._events = events  # tells the central app when a live product is archived

    # --- Reading ---------------------------------------------------------------------------

    async def list_products(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        *,
        status: ProductStatus | None,
        category: str | None,
        search: str | None,
        limit: int,
        offset: int,
    ) -> ProductPage:
        """The vendor's products, most recently changed first. Archived ones are left out unless
        `status=archived` asks for them."""
        newest = aliased(ProductRevision)
        latest = (
            select(newest.id)
            .where(newest.product_id == Product.id)
            .order_by(newest.version.desc())
            .limit(1)
            .correlate(Product)
            .scalar_subquery()
        )
        conditions: list[Any] = []
        if status is not None:
            conditions.append(Product.status == status)
        else:
            conditions.append(Product.status != ProductStatus.ARCHIVED)
        if category:
            conditions.append(func.lower(ProductRevision.category) == category.lower())
        if search:
            pattern = _like(search.lower())
            conditions.append(
                or_(
                    Product.sku_key.like(pattern, escape="\\"),
                    func.lower(ProductRevision.title).like(pattern, escape="\\"),
                )
            )
        base = (
            scoped_select(Product, vendor_id)
            .add_columns(ProductRevision.title, ProductRevision.category)
            .join(ProductRevision, ProductRevision.id == latest)
            .where(*conditions)
        )
        total = await db.scalar(select(func.count()).select_from(base.order_by(None).subquery()))
        rows = await db.execute(
            base.order_by(Product.updated_at.desc(), Product.id)
            .limit(limit)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
        items = [ProductSummary(row[0], row.title, row.category) for row in rows]
        return ProductPage(items, total or 0, limit, offset)

    async def get(
        self, db: AsyncSession, vendor_id: uuid.UUID, product_id: uuid.UUID
    ) -> ProductView:
        product = await self._product(db, vendor_id, product_id)
        return await self._view(db, product)

    # --- Writing ---------------------------------------------------------------------------

    async def create(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        sku: str,
        content: ProductContent,
    ) -> ProductView:
        """A new `draft` product with revision 1 as its pending (editable) revision."""
        try:
            product = await self.stage_create(db, vendor, user_id, sku, content)
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            raise _conflict(error) from error
        except BaseException:
            await db.rollback()
            raise
        return await self._view(db, product)

    async def stage_create(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        sku: str,
        content: ProductContent,
    ) -> Product:
        """`create` without the commit or the rollback, for a caller that creates many products in
        one transaction (the bulk import) and decides what to do with a failure. A uniqueness
        clash raises `IntegrityError`; `conflict_of` turns it into the API's answer."""
        await self._check_assets(db, vendor.id, content)
        product = Product(vendor_id=vendor.id, sku=sku)
        db.add(product)
        await db.flush()
        revision = await self._new_revision(db, product, user_id, 1, content)
        product.pending_revision_id = revision.id
        await self._write_children(db, product, revision, content)
        await db.flush()
        return product

    async def update(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        product_id: uuid.UUID,
        content: ProductContent,
    ) -> ProductView:
        """Replaces the content of the editable revision. If there is none (an approved product
        with nothing pending, or a rejected one) a new revision is made, so what is live does not
        change."""
        try:
            product = await self._product(db, vendor.id, product_id, lock=True)
            if product.status == ProductStatus.ARCHIVED:
                raise PRODUCT_ARCHIVED
            await self._check_assets(db, vendor.id, content)
            revision = await self._editable_revision(db, product)
            if revision is None:
                version = await db.scalar(
                    select(func.max(ProductRevision.version)).where(
                        ProductRevision.product_id == product.id
                    )
                )
                revision = await self._new_revision(
                    db, product, user_id, (version or 0) + 1, content
                )
                product.pending_revision_id = revision.id
                if product.live_revision_id is None:
                    product.status = ProductStatus.DRAFT  # a rejected product is being reworked
            else:
                _apply(revision, content)
                await db.execute(
                    delete(ProductRevisionVariant).where(
                        ProductRevisionVariant.revision_id == revision.id
                    )
                )
                await db.execute(
                    delete(ProductImage).where(ProductImage.revision_id == revision.id)
                )
                await db.flush()
            await self._write_children(db, product, revision, content)
            await db.flush()
            await db.commit()
        except IntegrityError as error:
            await db.rollback()
            raise _conflict(error) from error
        except BaseException:
            await db.rollback()
            raise
        return await self._view(db, product)

    async def submit(
        self, db: AsyncSession, vendor: Vendor, user_id: uuid.UUID, product_id: uuid.UUID
    ) -> ProductView:
        """Sends the editable revision for review: it is stamped `submitted_at` (and frozen), a
        pending review and its `submitted` audit event are written, all in one transaction. A
        product that was never approved becomes `pending_review`."""
        try:
            product = await self._product(db, vendor.id, product_id, lock=True)
            if product.status == ProductStatus.ARCHIVED:
                raise PRODUCT_ARCHIVED
            revision = await self._editable_revision(db, product)
            if revision is None:
                raise NOTHING_TO_SUBMIT
            await self._check_complete(db, vendor.id, revision)
            now = self._clock()
            revision.submitted_at = now
            if product.live_revision_id is None:
                product.status = ProductStatus.PENDING_REVIEW
            review = Review(
                vendor_id=vendor.id,
                subject=ReviewSubject.PRODUCT,
                product_revision_id=revision.id,
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
        return await self._view(db, product)

    async def delete(self, db: AsyncSession, vendor: Vendor, product_id: uuid.UUID) -> None:
        """Removes a product that was never submitted. Anything that was ever submitted is
        **archived** instead (kept as history, its SKU stays reserved); archiving an approved
        product takes it off sale and raises its `version`. A product in review cannot be
        removed. Deleting an archived product again does nothing."""
        try:
            product = await self._product(db, vendor.id, product_id, lock=True)
            if product.status == ProductStatus.ARCHIVED:
                return
            if await self._in_review(db, product):
                raise PRODUCT_IN_REVIEW
            ever_submitted = await db.scalar(
                select(
                    exists().where(
                        ProductRevision.product_id == product.id,
                        ProductRevision.submitted_at.is_not(None),
                    )
                )
            )
            # The two revision pointers and the revisions point at each other: clear them first.
            was_live = product.live_revision_id is not None
            product.pending_revision_id = None
            if not ever_submitted:
                product.live_revision_id = None
            await db.flush()
            # Revisions that were never submitted can go (their variants and images cascade).
            await db.execute(
                delete(ProductRevision).where(
                    ProductRevision.product_id == product.id,
                    ProductRevision.submitted_at.is_(None),
                )
            )
            if not ever_submitted:
                await db.execute(
                    delete(ProductVariant).where(ProductVariant.product_id == product.id)
                )
                await db.execute(delete(Product).where(Product.id == product.id))
            else:
                product.status = ProductStatus.ARCHIVED
                if was_live:
                    product.version += 1  # the live product changed: it is no longer on sale
                    if self._events is not None:
                        await self._events.product_archived(db, product, self._clock())
            await db.flush()
            await db.commit()
        except BaseException:
            await db.rollback()
            raise

    # --- Helpers ---------------------------------------------------------------------------

    async def _product(
        self, db: AsyncSession, vendor_id: uuid.UUID, product_id: uuid.UUID, lock: bool = False
    ) -> Product:
        query = (
            scoped_select(Product, vendor_id)
            .where(Product.id == product_id)
            .execution_options(populate_existing=True)
        )
        if lock:
            query = query.with_for_update()
        product: Product | None = await db.scalar(query)
        if product is None:
            raise PRODUCT_NOT_FOUND  # another vendor's id looks the same as one that is not there
        return product

    async def _revision(
        self, db: AsyncSession, revision_id: uuid.UUID | None
    ) -> ProductRevision | None:
        if revision_id is None:
            return None
        return await db.scalar(
            select(ProductRevision)
            .where(ProductRevision.id == revision_id)
            .execution_options(populate_existing=True)
        )

    async def _in_review(self, db: AsyncSession, product: Product) -> bool:
        if product.pending_revision_id is None:
            return False
        return bool(
            await db.scalar(
                select(
                    exists().where(
                        Review.product_revision_id == product.pending_revision_id,
                        Review.status == ReviewStatus.PENDING,
                    )
                )
            )
        )

    async def _editable_revision(
        self, db: AsyncSession, product: Product
    ) -> ProductRevision | None:
        """The pending revision if it is still being edited; None if there is none or the last
        one was already decided. Raises while one is in review."""
        pending = await self._revision(db, product.pending_revision_id)
        if pending is None:
            return None
        if pending.submitted_at is None:
            return pending
        if await self._in_review(db, product):
            raise PRODUCT_IN_REVIEW
        return None

    async def _new_revision(
        self,
        db: AsyncSession,
        product: Product,
        user_id: uuid.UUID,
        version: int,
        content: ProductContent,
    ) -> ProductRevision:
        revision = ProductRevision(
            product_id=product.id,
            vendor_id=product.vendor_id,
            version=version,
            created_by=user_id,
        )
        _apply(revision, content)
        db.add(revision)
        await db.flush()
        return revision

    async def _write_children(
        self, db: AsyncSession, product: Product, revision: ProductRevision, content: ProductContent
    ) -> None:
        """Adds the revision's variants (new identities as needed) and ordered images."""
        existing = {
            v.sku_key: v
            for v in await db.scalars(
                select(ProductVariant)
                .where(ProductVariant.product_id == product.id)
                .execution_options(populate_existing=True)
            )
        }
        keys = [v.sku.lower() for v in content.variants]
        if keys:
            taken = await db.scalar(
                select(func.count())
                .select_from(ProductVariant)
                .where(
                    ProductVariant.vendor_id == product.vendor_id,
                    ProductVariant.sku_key.in_(keys),
                    ProductVariant.product_id != product.id,
                )
            )
            if taken:
                raise SKU_TAKEN
        for item in content.variants:
            variant = existing.get(item.sku.lower())
            if variant is None:
                variant = ProductVariant(
                    product_id=product.id,
                    vendor_id=product.vendor_id,
                    sku=item.sku,
                    size=item.size,
                    color=item.color,
                )
                db.add(variant)
                await db.flush()
            elif (variant.size, variant.color) != (item.size, item.color):
                raise ApiError(
                    422,
                    "variant_identity_changed",
                    f"Variant {variant.sku} is {variant.size or '-'}/{variant.color or '-'}; "
                    "a size or colour cannot change. Use a new SKU for a different variant",
                )
            db.add(
                ProductRevisionVariant(
                    revision_id=revision.id,
                    variant_id=variant.id,
                    product_id=product.id,
                    price_paise=item.price_paise,
                    mrp_paise=item.mrp_paise,
                    is_active=item.is_active,
                )
            )
        for position, image in enumerate(content.images, start=1):
            db.add(
                ProductImage(
                    revision_id=revision.id,
                    vendor_id=product.vendor_id,
                    asset_id=image.asset_id,
                    position=position,
                    alt_text=image.alt_text,
                )
            )

    async def _check_assets(
        self, db: AsyncSession, vendor_id: uuid.UUID, content: ProductContent
    ) -> None:
        """Every image must be this vendor's ready `product_image` asset. Another vendor's file
        gets the same answer as one that does not exist."""
        wanted = {image.asset_id for image in content.images}
        if not wanted:
            return
        found = set(
            await db.scalars(
                scoped_select(Asset, vendor_id)
                .with_only_columns(Asset.id)
                .where(
                    Asset.id.in_(wanted),
                    Asset.kind == AssetKind.PRODUCT_IMAGE,
                    Asset.status == AssetStatus.READY,
                )
            )
        )
        if found != wanted:
            raise ApiError(
                422, "invalid_asset", "Every image must be one of your uploaded product images"
            )

    async def _check_complete(
        self, db: AsyncSession, vendor_id: uuid.UUID, revision: ProductRevision
    ) -> None:
        active = await db.scalar(
            select(func.count())
            .select_from(ProductRevisionVariant)
            .where(
                ProductRevisionVariant.revision_id == revision.id,
                ProductRevisionVariant.is_active.is_(True),
            )
        )
        assets = list(
            await db.scalars(
                select(ProductImage.asset_id).where(ProductImage.revision_id == revision.id)
            )
        )
        missing = []
        if not active:
            missing.append("at least one active variant")
        if not assets:
            missing.append("at least one image")
        if missing:
            raise ApiError(422, "product_incomplete", "Add " + " and ".join(missing) + " to submit")
        usable = await db.scalar(
            select(func.count())
            .select_from(Asset)
            .where(
                Asset.vendor_id == vendor_id,
                Asset.id.in_(assets),
                Asset.status == AssetStatus.READY,
            )
        )
        if usable != len(assets):  # an image was deleted since it was added
            raise ApiError(
                422, "invalid_asset", "Every image must be one of your uploaded product images"
            )

    async def _view(self, db: AsyncSession, product: Product) -> ProductView:
        live = await self._revision(db, product.live_revision_id)
        working = await self._revision(db, product.pending_revision_id)
        if working is None:
            # Nothing pending: show the last version if it is not the live one (a rejected one).
            latest = await db.scalar(
                select(ProductRevision)
                .where(ProductRevision.product_id == product.id)
                .order_by(ProductRevision.version.desc())
                .limit(1)
                .execution_options(populate_existing=True)
            )
            if latest is not None and latest.id != product.live_revision_id:
                working = latest
        return ProductView(
            product,
            await self._revision_view(db, live) if live else None,
            await self._revision_view(db, working) if working else None,
        )

    async def _revision_view(self, db: AsyncSession, revision: ProductRevision) -> RevisionView:
        variant_rows = await db.execute(
            select(ProductVariant, ProductRevisionVariant)
            .join(ProductRevisionVariant, ProductRevisionVariant.variant_id == ProductVariant.id)
            .where(ProductRevisionVariant.revision_id == revision.id)
            .order_by(ProductVariant.sku_key)
            .execution_options(populate_existing=True)
        )
        variants = [
            VariantView(v.id, v.sku, v.size, v.color, rv.price_paise, rv.mrp_paise, rv.is_active)
            for v, rv in variant_rows
        ]
        image_rows = await db.execute(
            select(ProductImage, Asset.url)
            .join(Asset, Asset.id == ProductImage.asset_id)
            .where(ProductImage.revision_id == revision.id)
            .order_by(ProductImage.position)
        )
        images = [
            ImageView(image.asset_id, url, image.position, image.alt_text)
            for image, url in image_rows
        ]
        review = await db.scalar(
            select(Review)
            .where(Review.product_revision_id == revision.id)
            .order_by(Review.created_at.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        return RevisionView(revision, variants, images, review)


def _apply(revision: ProductRevision, content: ProductContent) -> None:
    revision.title = content.title
    revision.description = content.description
    revision.category = content.category
    revision.subcategory = content.subcategory
    revision.gender = content.gender
    revision.fabric = content.fabric
    revision.weight_grams = content.weight_grams
    revision.returnable = content.returnable
    revision.return_window_days = content.return_window_days


def conflict_of(error: IntegrityError) -> ApiError:
    """The API's answer for a uniqueness error raised by `stage_create` (or re-raises it)."""
    return _conflict(error)


def _conflict(error: IntegrityError) -> ApiError:
    """Maps the database's uniqueness errors (a race the pre-checks could not see) to answers."""
    message = str(error.orig)
    if "product_variants_product_id_size_color" in message:
        return ApiError(
            409, "variant_conflict", "Two variants of this product have the same size and colour"
        )
    if "sku_key" in message:
        return SKU_TAKEN
    raise error
