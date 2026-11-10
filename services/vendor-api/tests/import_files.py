"""Builders for import test files: a CSV or an .xlsx made from rows of cells."""

import csv
import io
import zipfile
from typing import Any

from openpyxl import Workbook

from vendor_api.services.product_import import COLUMNS


def good_row(**changes: Any) -> dict[str, Any]:
    """One valid row (a product with one variant); a test bends a field at a time."""
    row: dict[str, Any] = {
        "sku": "KURTA-001",
        "title": "Block-print kurta",
        "description": "Hand block printed.",
        "category": "kurtas",
        "subcategory": "",
        "gender": "women",
        "fabric": "cotton",
        "weight_grams": "350",
        "returnable": "yes",
        "return_window_days": "7",
        "variant_sku": "KURTA-001-M",
        "size": "M",
        "color": "Indigo",
        "price": "1499",
        "mrp": "1999",
        "is_active": "yes",
    }
    return {**row, **changes}


def more_variant(sku: str = "KURTA-001", **changes: Any) -> dict[str, Any]:
    """A further row of the same product: details left blank, a new variant."""
    blank = dict.fromkeys(COLUMNS, "")
    return {
        **blank,
        "sku": sku,
        "variant_sku": "KURTA-001-L",
        "size": "L",
        "color": "Indigo",
        "price": "1499",
        "mrp": "1999",
        **changes,
    }


def csv_bytes(
    rows: list[dict[str, Any]],
    columns: tuple[str, ...] | list[str] = COLUMNS,
    delimiter: str = ",",
    bom: bool = False,
    header: list[str] | None = None,
) -> bytes:
    """`columns` picks the cells of each row; `header` (default: the same) is what the first row
    says, for a file whose column names are spelled differently."""
    out = io.StringIO(newline="")
    writer = csv.writer(out, delimiter=delimiter)
    writer.writerow(header or columns)
    for row in rows:
        writer.writerow([row.get(name, "") for name in columns])
    data = out.getvalue().encode("utf-8")
    return b"\xef\xbb\xbf" + data if bom else data


def xlsx_bytes(
    rows: list[dict[str, Any]],
    columns: tuple[str, ...] | list[str] = COLUMNS,
    formulas: dict[tuple[int, str], str] | None = None,
    extra_sheet: bool = False,
) -> bytes:
    """An .xlsx whose first sheet holds the rows. `formulas` puts a real formula in a cell:
    `{(row number, column): "=1+1"}` (the header is row 1)."""
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # noqa: S101
    sheet.append(list(columns))
    for row in rows:
        sheet.append([row.get(name) if row.get(name) != "" else None for name in columns])
    for (number, column), formula in (formulas or {}).items():
        sheet.cell(row=number, column=list(columns).index(column) + 1).value = formula
    if extra_sheet:
        workbook.create_sheet("Notes").append(["sku", "title"])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def with_parts(xlsx: bytes, parts: dict[str, bytes]) -> bytes:
    """The workbook with extra (or replaced) files inside its zip."""
    source = zipfile.ZipFile(io.BytesIO(xlsx))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            if entry.filename not in parts:
                target.writestr(entry.filename, source.read(entry.filename))
        for name, content in parts.items():
            target.writestr(name, content)
    return out.getvalue()
