import uuid
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from shazlo_security.rate_limit import Check
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import CurrentVendorUser, Limits, current_vendor_user
from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.session import get_session
from vendor_api.services.import_template import csv_template, xlsx_template
from vendor_api.services.product_import import ImportMode, ImportReport, ProductImportService

router = APIRouter(prefix="/vendor/products/import", tags=["products-import"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
# What a browser or a tool may call a spreadsheet or a CSV. The bytes decide the format (an .xlsx
# is a zip), so this only turns away things that are plainly something else.
ACCEPTED_TYPES = frozenset(
    {
        "text/csv",
        "application/csv",
        "text/plain",
        "application/vnd.ms-excel",
        XLSX_TYPE,
        "application/octet-stream",
    }
)


def get_imports(request: Request) -> ProductImportService:
    return cast(ProductImportService, request.app.state.product_import)


Imports = Annotated[ProductImportService, Depends(get_imports)]


async def read_body(request: Request, limit: int) -> bytes:
    """The request body, refused as soon as it is over `limit` bytes (the declared length is
    checked first; a body that does not declare one is cut off while it streams in)."""
    too_large = ApiError(
        413, "file_too_large", f"The file is larger than {limit // 1024} KB. Split it in parts"
    )
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise too_large
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise too_large
        chunks.append(chunk)
    return b"".join(chunks)


class RowErrorOut(BaseModel):
    # The row as numbered in the spreadsheet (the column names are row 1).
    row: int
    column: str | None
    code: str
    message: str


class ProductResultOut(BaseModel):
    sku: str
    rows: list[int]
    # created, unchanged (already exists with the same details), valid (checked, nothing written)
    # or rejected (see `errors`).
    status: str
    product_id: uuid.UUID | None


class SummaryOut(BaseModel):
    products: int
    created: int
    unchanged: int
    valid: int
    rejected: int
    rows_read: int
    rows_with_errors: int


class ImportReportOut(BaseModel):
    mode: str
    file_format: str
    # Whether anything was written.
    committed: bool
    summary: SummaryOut
    ignored_columns: list[str]
    products: list[ProductResultOut]
    errors: list[RowErrorOut]
    # True if there are more errors than are listed (the first ones are).
    errors_truncated: bool


def report_out(report: ImportReport) -> ImportReportOut:
    return ImportReportOut(
        mode=report.mode,
        file_format=report.file_format,
        committed=report.committed,
        summary=SummaryOut(
            products=len(report.products),
            created=report.count("created"),
            unchanged=report.count("unchanged"),
            valid=report.count("valid"),
            rejected=report.count("rejected"),
            rows_read=report.rows_read,
            rows_with_errors=report.rows_with_errors,
        ),
        ignored_columns=report.ignored_columns,
        products=[
            ProductResultOut(sku=p.sku, rows=p.rows, status=p.status, product_id=p.product_id)
            for p in report.products
        ],
        errors=[
            RowErrorOut(row=e.row, column=e.column, code=e.code, message=e.message)
            for e in report.errors
        ],
        errors_truncated=report.errors_truncated,
    )


@router.post(
    "",
    openapi_extra={
        "requestBody": {
            "required": True,
            "description": "The file itself, as the request body (not a multipart form).",
            "content": {
                "text/csv": {"schema": {"type": "string", "format": "binary"}},
                XLSX_TYPE: {"schema": {"type": "string", "format": "binary"}},
            },
        }
    },
)
async def import_products(
    request: Request,
    response: Response,
    db: Db,
    imports: Imports,
    limits: Limits,
    current: Current,
    mode: Annotated[
        ImportMode,
        Query(
            description="`validate` writes nothing; `import` creates every valid product and "
            "reports the rest; `all_or_nothing` creates nothing unless the whole file is valid."
        ),
    ] = ImportMode.IMPORT,
) -> ImportReportOut:
    """Imports products from a `.xlsx` or `.csv` sent as the request body. Always `200` with a
    report listing every rejected row (row, column, reason); file-level problems are `413`, `415`
    or `422`. One row is one variant; rows with the same `sku` are one product. Download the
    template for the columns. Imported products are drafts without images. Uploading the same
    file again creates nothing new. Limited per vendor."""
    no_store(response)
    settings = cast(Settings, request.app.state.settings)
    await limits.check(
        "bulk_import",
        [Check("vendor", str(current.vendor.id), settings.rate_limit_bulk_import_vendor)],
    )
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_TYPES:
        raise ApiError(
            415, "unsupported_file_type", "Send a .xlsx or .csv file as the request body"
        )
    data = await read_body(request, settings.import_max_bytes)
    report = await imports.run(db, current.vendor, current.user.id, data, mode)
    return report_out(report)


@router.get("/template")
async def import_template(
    current: Current,
    file_format: Annotated[Literal["xlsx", "csv"], Query(alias="format")] = "xlsx",
) -> Response:
    """The sample file: the columns, three example rows (two products, three variants) and, in
    the Excel version, an instructions sheet. Uploading it untouched with `mode=validate` shows what
    a clean report looks like."""
    del current  # only here to require a signed-in vendor
    if file_format == "csv":
        content, media_type = csv_template(), "text/csv; charset=utf-8"
    else:
        content, media_type = xlsx_template(), XLSX_TYPE
    return Response(
        content,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="shazlo-product-import-template.{file_format}"'
            ),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
