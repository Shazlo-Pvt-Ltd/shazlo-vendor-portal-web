"""Bulk product import: one spreadsheet, many products, a report for every row.

**The sheet.** One row is one *variant*; rows that share a product `sku` are one product with
several variants. The first row of a product gives its details (title, category, ...); the other
rows may repeat them (they must match) or leave them blank. Money is in rupees (`999.50`) and is
converted to paise exactly. Images cannot be imported (an image is an uploaded asset): imported
products are drafts, and the vendor adds images afterwards and submits them.

**Rules are the API's rules.** Each product is validated with `CreateProductBody`, the same model
`POST /v1/vendor/products` uses, so a row that imports could also have been created by hand and the
limits never drift apart. This module adds what only a spreadsheet needs: reading cells (numbers,
yes/no, text), refusing formulas and cells a spreadsheet would run as one, finding duplicates in
the file and in the database, and mapping every error to a row and a column.

**What gets written** depends on the mode: `validate` writes nothing; `import` creates every
product whose rows are all valid and reports the rest; `all_or_nothing` creates nothing unless
the whole file is valid. Products are created in one transaction, each inside a savepoint, so one
product that fails (for example a SKU taken a moment ago by another request) is reported and the
others still import. A product is never half imported.

**Importing the same file again creates nothing new.** A product whose SKU already exists with
the same details and variants is reported as `unchanged`; one that exists with different details
is an error (the import never overwrites: edit it through the products API).
"""

import math
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from vendor_api.api.products import CreateProductBody
from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import (
    Product,
    ProductRevision,
    ProductRevisionVariant,
    ProductVariant,
    Vendor,
)
from vendor_api.services.import_sheet import MAX_CELL_CHARS, Cell, SheetRow, read_sheet
from vendor_api.services.products import (
    ImageInput,
    ProductContent,
    ProductService,
    VariantInput,
    conflict_of,
)

# The columns of the template, in order. The first row of a file names them.
COLUMNS = (
    "sku",
    "title",
    "description",
    "category",
    "subcategory",
    "gender",
    "fabric",
    "weight_grams",
    "returnable",
    "return_window_days",
    "variant_sku",
    "size",
    "color",
    "price",
    "mrp",
    "is_active",
)
REQUIRED = ("sku", "title", "category", "gender", "variant_sku", "price")
# Needed on every row; the rest of REQUIRED are details of the product, needed on its first row.
REQUIRED_ON_EVERY_ROW = ("sku", "variant_sku", "price")
# Details of the product itself: given on its first row, repeated or blank on the others.
PRODUCT_COLUMNS = (
    "title",
    "description",
    "category",
    "subcategory",
    "gender",
    "fabric",
    "weight_grams",
    "returnable",
    "return_window_days",
)
# What `CreateProductBody` calls a field, as the column that holds it.
BODY_FIELD_COLUMNS = {
    "sku": "sku",
    "title": "title",
    "description": "description",
    "category": "category",
    "subcategory": "subcategory",
    "gender": "gender",
    "fabric": "fabric",
    "weight_grams": "weight_grams",
    "returnable": "returnable",
    "return_window_days": "return_window_days",
}
VARIANT_FIELD_COLUMNS = {
    "sku": "variant_sku",
    "size": "size",
    "color": "color",
    "price_paise": "price",
    "mrp_paise": "mrp",
    "is_active": "is_active",
}
# A cell that starts with one of these is run as a formula by Excel, LibreOffice and Google Sheets
# (and `\t`, `\r` are used to hide one). Such text is refused instead of stored, so it can never
# come back out in an export that someone opens in a spreadsheet.
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")
FORMULA_STARTS_NUMERIC = ("=", "@", "\t", "\r")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MONEY = re.compile(r"^\d{1,13}(\.\d{1,2})?$")
TRUE_WORDS = frozenset({"yes", "y", "true", "1"})
FALSE_WORDS = frozenset({"no", "n", "false", "0"})
MAX_REPORTED_ERRORS = 500


class ImportMode(StrEnum):
    VALIDATE = "validate"
    IMPORT = "import"
    ALL_OR_NOTHING = "all_or_nothing"


@dataclass(frozen=True)
class RowError:
    row: int
    column: str | None
    code: str
    message: str


@dataclass
class ProductResult:
    sku: str
    rows: list[int]
    # created | unchanged | valid (checked, nothing written) | rejected
    status: str
    product_id: uuid.UUID | None = None


@dataclass
class ImportReport:
    mode: ImportMode
    file_format: str
    rows_read: int
    ignored_columns: list[str]
    committed: bool
    products: list[ProductResult]
    errors: list[RowError]
    errors_truncated: bool
    rows_with_errors: int = 0

    def count(self, status: str) -> int:
        return sum(1 for product in self.products if product.status == status)


class CellError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --- Reading cells -----------------------------------------------------------------------


def read_text(cell: Cell, numeric: bool = False) -> str | None:
    """The cell as trimmed text, or None if it is empty. Refuses formulas and anything a
    spreadsheet would run as one. In a number column a leading `-` or `+` is a sign, not a
    formula: the number checks refuse a negative amount with a clearer message."""
    value = cell.value
    if cell.formula:
        raise CellError("formula", "Formulas are not allowed. Paste the value, not the formula")
    if value is None:
        return None
    if isinstance(value, bool):
        text = "yes" if value else "no"
    elif isinstance(value, int | float | Decimal):
        text = _number_text(value)
    elif isinstance(value, datetime | date | time | timedelta):
        raise CellError("invalid_text", "This cell holds a date or time, not text")
    elif isinstance(value, str):
        text = value.strip().strip(" ").strip()
    else:
        raise CellError("invalid_text", "This cell holds something that is not text or a number")
    if not text:
        return None
    if len(text) > MAX_CELL_CHARS:
        raise CellError("too_long", f"Text is longer than {MAX_CELL_CHARS} characters")
    if CONTROL.search(text):
        raise CellError("invalid_characters", "Text contains control characters")
    if text.startswith(FORMULA_STARTS if not numeric else FORMULA_STARTS_NUMERIC):
        raise CellError(
            "formula_like",
            f"Text may not start with {text[0]!r}: a spreadsheet would run it as a formula. "
            "Remove that character",
        )
    return text


def _number_text(value: float | Decimal) -> str:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise CellError("invalid_number", "This is not a number")
        if value == int(value):
            return str(int(value))
    return str(value)


def read_int(cell: Cell, low: int, high: int) -> int | None:
    text = read_text(cell, numeric=True)
    if text is None:
        return None
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise CellError("invalid_number", "Use a whole number, for example 350") from None
    if not number.is_finite() or number != number.to_integral_value() or "e" in text.lower():
        raise CellError("invalid_number", "Use a whole number, for example 350")
    if not low <= number <= high:
        raise CellError("out_of_range", f"Use a number from {low} to {high}")
    return int(number)


def read_bool(cell: Cell) -> bool | None:
    if isinstance(cell.value, bool):
        return cell.value
    text = read_text(cell)
    if text is None:
        return None
    word = text.lower()
    if word in TRUE_WORDS:
        return True
    if word in FALSE_WORDS:
        return False
    raise CellError("invalid_choice", "Use yes or no")


def read_paise(cell: Cell) -> int | None:
    """Rupees such as `999` or `999.50` as exact paise. No signs, commas, symbols or exponent."""
    value = cell.value
    if isinstance(value, float) and math.isfinite(value) and abs(value) < 1e13:
        cents = round(value * 100)
        if abs(value * 100 - cents) > 1e-6:
            raise CellError("invalid_number", "Use at most 2 decimal places")
        text: str | None = f"{Decimal(cents) / 100:.2f}"
    else:
        text = read_text(cell, numeric=True)
    if text is None:
        return None
    if not MONEY.match(text):
        raise CellError(
            "invalid_number", "Use an amount in rupees such as 999 or 999.50 (no symbols or commas)"
        )
    return int(Decimal(text) * 100)


# --- Parsed rows and products ------------------------------------------------------------


@dataclass
class ParsedRow:
    number: int
    values: dict[str, object] = field(default_factory=dict)


@dataclass
class Group:
    """The rows that share one product SKU."""

    sku: str
    rows: list[ParsedRow] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    content: ProductContent | None = None
    status: str = "valid"
    product_id: uuid.UUID | None = None

    @property
    def key(self) -> str:
        return self.sku.lower()

    @property
    def numbers(self) -> list[int]:
        return [row.number for row in self.rows]

    def fail(self, row: int, column: str | None, code: str, message: str) -> None:
        self.errors.append(RowError(row, column, code, message))


class ProductImportService:
    """Reads, checks and (depending on the mode) imports a product spreadsheet. See the module
    docstring for the sheet, the rules and what each mode writes."""

    def __init__(self, settings: Settings, products: ProductService) -> None:
        self._settings = settings
        self._products = products

    async def run(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        data: bytes,
        mode: ImportMode,
    ) -> ImportReport:
        sheet = await run_in_threadpool(
            read_sheet,
            data,
            max_rows=self._settings.import_max_rows,
            known=COLUMNS,
            required=REQUIRED,
        )
        groups = self._group(sheet.rows)
        for group in groups:
            self._validate(group)
        self._check_duplicates_in_file(groups)
        await self._check_database(db, vendor.id, groups)

        report = ImportReport(
            mode=mode,
            file_format=sheet.format,
            rows_read=len(sheet.rows),
            ignored_columns=sheet.ignored_columns,
            committed=False,
            products=[],
            errors=[],
            errors_truncated=False,
        )
        creatable = [group for group in groups if group.status == "valid"]
        has_errors = any(group.status == "rejected" for group in groups)
        if mode == ImportMode.ALL_OR_NOTHING and has_errors:
            self._finish(report, groups)
            return report
        if mode != ImportMode.VALIDATE and creatable:
            await self._create(db, vendor, user_id, creatable, atomic=mode != ImportMode.IMPORT)
            report.committed = any(group.status == "created" for group in groups)
        self._finish(report, groups)
        return report

    # --- Step 1: rows into products ----------------------------------------------------------

    def _group(self, rows: list[SheetRow]) -> list[Group]:
        groups: dict[str, Group] = {}
        for row in rows:
            parsed, errors = self._parse_row(row)
            sku = str(parsed.values.get("sku") or "")
            group = groups.setdefault(sku.lower() or f"\0row{row.number}", Group(sku=sku))
            group.rows.append(parsed)
            for error in errors:
                group.fail(error.row, error.column, error.code, error.message)
        return list(groups.values())

    def _parse_row(self, row: SheetRow) -> tuple[ParsedRow, list[RowError]]:
        parsed = ParsedRow(row.number)
        errors: list[RowError] = []
        readers: dict[str, Callable[[Cell], Any]] = {
            "weight_grams": lambda c: read_int(c, 1, 1_000_000),
            "return_window_days": lambda c: read_int(c, 0, 30),
            "returnable": read_bool,
            "is_active": read_bool,
            "price": read_paise,
            "mrp": read_paise,
        }
        for column in COLUMNS:
            cell = row.cells.get(column, Cell(None))
            try:
                value = readers.get(column, read_text)(cell)
            except CellError as error:
                errors.append(RowError(row.number, column, error.code, error.message))
                continue
            if value is None and column in REQUIRED_ON_EVERY_ROW:
                errors.append(RowError(row.number, column, "required", "This is required"))
            parsed.values[column] = value
        gender = parsed.values.get("gender")
        if isinstance(gender, str):
            parsed.values["gender"] = gender.lower()
        return parsed, errors

    # --- Step 2: one product's rows ----------------------------------------------------------

    def _validate(self, group: Group) -> None:
        if not group.rows:
            return
        first = group.rows[0]
        for column in REQUIRED:
            missing = column not in REQUIRED_ON_EVERY_ROW and first.values.get(column) is None
            if missing and not any(
                e.row == first.number and e.column == column for e in group.errors
            ):
                group.fail(first.number, column, "required", "This is required")
        # Details are on the first row; later rows repeat them or leave them blank.
        for row in group.rows[1:]:
            for column in PRODUCT_COLUMNS:
                value = row.values.get(column)
                if value is not None and value != first.values.get(column):
                    group.fail(
                        row.number,
                        column,
                        "conflicting_value",
                        f"This differs from row {first.number}. A product's details must be the "
                        "same on every row of it, or blank",
                    )
        seen_variants: dict[str, int] = {}
        seen_looks: dict[tuple[str, str], int] = {}
        for row in group.rows:
            variant_sku = row.values.get("variant_sku")
            if isinstance(variant_sku, str):
                earlier = seen_variants.setdefault(variant_sku.lower(), row.number)
                if earlier != row.number:
                    group.fail(
                        row.number,
                        "variant_sku",
                        "duplicate_variant_sku",
                        f"The same variant SKU is on row {earlier}",
                    )
            look = (
                str(row.values.get("size") or "").lower(),
                str(row.values.get("color") or "").lower(),
            )
            earlier_look = seen_looks.setdefault(look, row.number)
            if earlier_look != row.number:
                group.fail(
                    row.number,
                    "size",
                    "duplicate_variant",
                    f"Row {earlier_look} has the same size and colour for this product",
                )
        if first.values.get("returnable") and first.values.get("return_window_days") is None:
            group.fail(
                first.number,
                "return_window_days",
                "required",
                "This is required when the product is returnable",
            )
        if group.errors:
            group.status = "rejected"
            return
        payload = self._payload(group)
        try:
            body = CreateProductBody.model_validate(payload)
        except ValidationError as error:
            self._map_validation_errors(group, error)
            group.status = "rejected"
            return
        group.content = ProductContent(
            title=body.title,
            description=body.description,
            category=body.category,
            subcategory=body.subcategory,
            gender=body.gender,
            fabric=body.fabric,
            weight_grams=body.weight_grams,
            returnable=body.returnable,
            return_window_days=body.return_window_days,
            variants=[VariantInput(**v.model_dump()) for v in body.variants],
            images=[ImageInput(**i.model_dump()) for i in body.images],
        )

    def _payload(self, group: Group) -> dict[str, object]:
        first = group.rows[0].values
        payload: dict[str, object] = {"sku": group.sku}
        for column in PRODUCT_COLUMNS:
            value = first.get(column)
            if value is not None:
                payload[column] = value
        payload["variants"] = [
            {
                "sku": row.values["variant_sku"],
                "size": row.values.get("size") or "",
                "color": row.values.get("color") or "",
                "price_paise": row.values["price"],
                "mrp_paise": row.values.get("mrp") or row.values["price"],
                "is_active": True
                if row.values.get("is_active") is None
                else row.values["is_active"],
            }
            for row in group.rows
        ]
        return payload

    def _map_validation_errors(self, group: Group, error: ValidationError) -> None:
        """The API's own validation said no: attribute each message to a row and a column."""
        for item in error.errors():
            location = [part for part in item["loc"] if part != "body"]
            message = str(item["msg"]).removeprefix("Value error, ")
            row, column = group.rows[0].number, None
            if location and location[0] == "variants" and len(location) >= 3:
                index = location[1]
                if isinstance(index, int) and index < len(group.rows):
                    row = group.rows[index].number
                column = VARIANT_FIELD_COLUMNS.get(str(location[2]))
            elif location and location[0] == "variants" and len(location) >= 2:
                index = location[1]
                if isinstance(index, int) and index < len(group.rows):
                    row = group.rows[index].number
                if "mrp" in message:
                    column = "mrp"
            elif location:
                column = BODY_FIELD_COLUMNS.get(str(location[0]))
            group.fail(row, column, "invalid_value", message)

    # --- Step 3: across products and against the database ------------------------------------

    def _check_duplicates_in_file(self, groups: list[Group]) -> None:
        seen: dict[str, tuple[int, str]] = {}
        for group in groups:
            for row in group.rows:
                variant_sku = row.values.get("variant_sku")
                if not isinstance(variant_sku, str):
                    continue
                owner = seen.setdefault(variant_sku.lower(), (row.number, group.key))
                if owner[1] != group.key:
                    group.fail(
                        row.number,
                        "variant_sku",
                        "duplicate_variant_sku",
                        f"Row {owner[0]} uses this variant SKU for another product",
                    )
                    group.status = "rejected"

    async def _check_database(
        self, db: AsyncSession, vendor_id: uuid.UUID, groups: list[Group]
    ) -> None:
        live = [group for group in groups if group.status == "valid" and group.content]
        if not live:
            return
        keys = [group.key for group in live]
        existing = {
            product.sku_key: product
            for product in await db.scalars(
                select(Product)
                .where(Product.vendor_id == vendor_id, Product.sku_key.in_(keys))
                .execution_options(populate_existing=True)
            )
        }
        variant_keys = sorted(
            {v.sku.lower() for group in live if group.content for v in group.content.variants}
        )
        owners: dict[str, str] = {}
        if variant_keys:
            rows = await db.execute(
                select(ProductVariant.sku_key, Product.sku_key)
                .join(Product, Product.id == ProductVariant.product_id)
                .where(
                    ProductVariant.vendor_id == vendor_id,
                    ProductVariant.sku_key.in_(variant_keys),
                )
            )
            owners = {row[0]: row[1] for row in rows}
        for group in live:
            if group.content is None:
                continue
            for row, variant in zip(group.rows, group.content.variants, strict=True):
                owner = owners.get(variant.sku.lower())
                if owner is not None and owner != group.key:
                    group.fail(
                        row.number,
                        "variant_sku",
                        "variant_sku_taken",
                        "You already use this variant SKU on another product",
                    )
            product = existing.get(group.key)
            if product is not None and not group.errors:
                if await self._same_as_existing(db, product, group.content):
                    group.status = "unchanged"
                    group.product_id = product.id
                    continue
                group.fail(
                    group.rows[0].number,
                    "sku",
                    "sku_exists",
                    "A product with this SKU already exists with different details. "
                    "An import never changes a product: edit it in the portal",
                )
            if group.errors:
                group.status = "rejected"

    async def _same_as_existing(
        self, db: AsyncSession, product: Product, content: ProductContent
    ) -> bool:
        """Whether the product's latest revision already says what the file says (images are not
        compared: the file cannot have any)."""
        revision = await db.scalar(
            select(ProductRevision)
            .where(ProductRevision.product_id == product.id)
            .order_by(ProductRevision.version.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        if revision is None:
            return False
        same_details = (
            revision.title,
            revision.description,
            revision.category,
            revision.subcategory,
            revision.gender,
            revision.fabric,
            revision.weight_grams,
            revision.returnable,
            revision.return_window_days,
        ) == (
            content.title,
            content.description,
            content.category,
            content.subcategory,
            content.gender,
            content.fabric,
            content.weight_grams,
            content.returnable,
            content.return_window_days,
        )
        if not same_details:
            return False
        rows = await db.execute(
            select(ProductVariant, ProductRevisionVariant)
            .join(ProductRevisionVariant, ProductRevisionVariant.variant_id == ProductVariant.id)
            .where(ProductRevisionVariant.revision_id == revision.id)
        )
        stored = {
            v.sku_key: (v.size, v.color, rv.price_paise, rv.mrp_paise, rv.is_active)
            for v, rv in rows
        }
        wanted = {
            v.sku.lower(): (v.size, v.color, v.price_paise, v.mrp_paise, v.is_active)
            for v in content.variants
        }
        return stored == wanted

    # --- Step 4: writing ---------------------------------------------------------------------

    async def _create(
        self,
        db: AsyncSession,
        vendor: Vendor,
        user_id: uuid.UUID,
        groups: list[Group],
        *,
        atomic: bool,
    ) -> None:
        """Creates the products in one transaction, each inside a savepoint. With `atomic` the
        first failure undoes everything."""
        try:
            for group in groups:
                if group.content is None:
                    continue
                try:
                    async with db.begin_nested():
                        product = await self._products.stage_create(
                            db, vendor, user_id, group.sku, group.content
                        )
                except (IntegrityError, ApiError) as error:
                    problem = self._problem_of(error)
                    group.fail(group.rows[0].number, "sku", problem.code, problem.message)
                    group.status = "rejected"
                    if atomic:
                        raise
                    continue
                group.status = "created"
                group.product_id = product.id
            await db.commit()
        except (IntegrityError, ApiError):
            await db.rollback()
            for group in groups:
                if group.status == "created":
                    group.status, group.product_id = "valid", None
        except BaseException:
            await db.rollback()
            raise

    @staticmethod
    def _problem_of(error: IntegrityError | ApiError) -> ApiError:
        if isinstance(error, ApiError):
            return error
        try:
            return conflict_of(error)
        except IntegrityError:
            return ApiError(409, "conflict", "This product could not be saved")

    # --- The report --------------------------------------------------------------------------

    def _finish(self, report: ImportReport, groups: list[Group]) -> None:
        errors = sorted(
            (error for group in groups for error in group.errors),
            key=lambda e: (e.row, e.column or ""),
        )
        first_by_row: dict[int, RowError] = {}
        additional: list[RowError] = []
        for error in errors:
            if error.row in first_by_row:
                additional.append(error)
            else:
                first_by_row[error.row] = error
        report.rows_with_errors = len(first_by_row)
        if len(errors) > MAX_REPORTED_ERRORS:
            extra_slots = max(0, MAX_REPORTED_ERRORS - report.rows_with_errors)
            report.errors = sorted(
                [*first_by_row.values(), *additional[:extra_slots]],
                key=lambda e: (e.row, e.column or ""),
            )
        else:
            report.errors = errors
        report.errors_truncated = len(report.errors) < len(errors)
        report.products = [
            ProductResult(group.sku, group.numbers, group.status, group.product_id)
            for group in groups
        ]
