"""Reads an uploaded `.xlsx` or `.csv` into rows, safely.

The file is hostile until proven otherwise. Everything here is bounded before any row is looked
at: the size (checked by the caller while the body streams in), the unpacked size and shape of an
`.xlsx` (a zip: a small file can unpack to gigabytes), the number of columns, the length of a
cell, and the number of data rows. An `.xlsx` is read with `openpyxl` in streaming mode, with
`defusedxml` installed so XML entity tricks are refused; macros and external links are refused;
formula cells are flagged so the importer can reject them (a value is wanted, never a formula).

Nothing here knows about products: it returns the rows of the first sheet, keyed by column name.
"""

import csv
import io
import logging
import zipfile
from collections.abc import Collection
from dataclasses import dataclass

from openpyxl import load_workbook

from vendor_api.core.errors import ApiError

logger = logging.getLogger("vendor_api.import")

MAX_COLUMNS = 40
# Longer than any field a product can hold (4000), so a legitimate cell is never cut off here and a
# multi-megabyte cell never reaches the validators.
MAX_CELL_CHARS = 5000
# The unpacked size of an `.xlsx`, over every file in the zip, and the most files it may hold.
MAX_UNPACKED_BYTES = 50 * 1024 * 1024
MAX_ZIP_ENTRIES = 200
# One entry that unpacks to this many times its packed size (and is not tiny) is a zip bomb.
MAX_COMPRESSION_RATIO = 100
# Parts of a workbook that have no place in a product list: macros, links to other files and
# embedded objects can run code or fetch things. A workbook that has one is refused.
FORBIDDEN_PARTS = ("xl/vbaProject.bin", "xl/externalLinks/", "xl/embeddings/", "xl/activeX/")
XLSX_MAGIC = b"PK\x03\x04"

# Python's csv module refuses a field longer than this (default 128 KiB): lower, and the same
# order of magnitude as MAX_CELL_CHARS.
csv.field_size_limit(MAX_CELL_CHARS * 2)


@dataclass(frozen=True)
class Cell:
    value: object
    # An `.xlsx` cell that holds a formula (its text starts with `=`). Never true for CSV.
    formula: bool = False


@dataclass(frozen=True)
class SheetRow:
    # The row number in the spreadsheet: the header is row 1, the first data row is row 2.
    number: int
    cells: dict[str, Cell]


@dataclass(frozen=True)
class Sheet:
    format: str  # "csv" or "xlsx"
    rows: list[SheetRow]
    # Columns in the file that are not known and were left out. Their content is never read.
    ignored_columns: list[str]


def invalid_file(message: str) -> ApiError:
    return ApiError(422, "invalid_file", message)


def column_name(value: object) -> str:
    """`Variant SKU`, `variant-sku` and `variant_sku` are the same column."""
    text = str(value if value is not None else "").replace("﻿", "").strip().lower()
    for separator in (" ", "-", " "):
        text = text.replace(separator, "_")
    while "__" in text:
        text = text.replace("__", "_")
    return text.strip("_")


def is_blank(cells: list[Cell]) -> bool:
    return all(
        cell.value is None or (isinstance(cell.value, str) and not cell.value.strip())
        for cell in cells
    )


def read_sheet(
    data: bytes, *, max_rows: int, known: Collection[str], required: Collection[str]
) -> Sheet:
    """The first sheet of an `.xlsx` or the whole `.csv`, as rows keyed by column name.

    `known` are the column names that are read (others are listed as ignored) and `required` the
    ones the header must contain. Raises `ApiError` (422) for a file that cannot be used.
    """
    if data.startswith(XLSX_MAGIC):
        file_format, records = "xlsx", _read_xlsx(data, max_rows)
    else:
        file_format, records = "csv", _read_csv(data, max_rows)
    if not records:
        raise invalid_file("The file is empty. The first row must be the column names")
    header_number, header = records[0]
    if header_number != 1:
        raise invalid_file("The first row must be the column names")
    # Blank cells at the end of a row (an .xlsx pads every row to a fixed width) are not columns.
    width = max((i + 1 for i, cell in enumerate(header) if not is_blank([cell])), default=0)
    if width > MAX_COLUMNS:
        raise invalid_file(f"The file has more than {MAX_COLUMNS} columns")

    names = [column_name(cell.value) for cell in header]
    wanted = set(known)
    seen: dict[str, int] = {}
    for index, name in enumerate(names):
        if name in wanted:
            if name in seen:
                raise ApiError(422, "duplicate_columns", f"The column {name} appears twice")
            seen[name] = index
    missing = [name for name in required if name not in seen]
    if missing:
        raise ApiError(
            422, "missing_columns", "The file has no column named " + ", ".join(sorted(missing))
        )
    ignored = [
        str(cell.value).strip()
        for name, cell in zip(names, header, strict=False)
        if name and name not in wanted
    ]
    rows = [
        SheetRow(
            number,
            {
                name: (cells[index] if index < len(cells) else Cell(None))
                for name, index in seen.items()
            },
        )
        for number, cells in records[1:]
    ]
    return Sheet(file_format, rows, ignored)


# --- CSV ---------------------------------------------------------------------------------


def _read_csv(data: bytes, max_rows: int) -> list[tuple[int, list[Cell]]]:
    if b"\x00" in data:
        raise invalid_file("This is not a CSV file (it holds binary data)")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise invalid_file("Save the file as CSV UTF-8 (the text is not valid UTF-8)") from error
    first_line = text.split("\n", 1)[0]
    # Excel in some countries writes `;` between the columns, and a tab for "text".
    delimiter = max(",;\t", key=first_line.count)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    scan_limit = max_rows * 5 + 1000
    records: list[tuple[int, list[Cell]]] = []
    data_rows = 0
    try:
        for number, record in enumerate(reader, start=1):
            if number > scan_limit:
                raise _too_many_rows(max_rows)
            if len(record) > MAX_COLUMNS:
                raise invalid_file(f"The file has more than {MAX_COLUMNS} columns")
            cells = [Cell(value[: MAX_CELL_CHARS + 1]) for value in record]
            if number > 1:
                if is_blank(cells):
                    continue
                data_rows += 1
                if data_rows > max_rows:
                    raise _too_many_rows(max_rows)
            records.append((number, cells))
    except csv.Error as error:
        if "field larger" in str(error):
            raise invalid_file(
                f"A cell is longer than {MAX_CELL_CHARS * 2} characters. Shorten it"
            ) from error
        raise invalid_file(f"The CSV could not be read: {error}") from error
    return records


# --- XLSX --------------------------------------------------------------------------------


def _check_zip(data: bytes) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise invalid_file("This is not a valid .xlsx file") from error
    with archive:
        entries = archive.infolist()
        if len(entries) > MAX_ZIP_ENTRIES:
            raise invalid_file("This .xlsx file holds too many parts")
        names = {entry.filename for entry in entries}
        if "xl/workbook.xml" not in names or "[Content_Types].xml" not in names:
            raise invalid_file("This is not a valid .xlsx file")
        if any(name.startswith(FORBIDDEN_PARTS) for name in names):
            raise invalid_file(
                "This workbook has macros, links to other files or embedded objects. "
                "Save a plain .xlsx (or a CSV) with the values only"
            )
        if sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES:
            raise invalid_file("This .xlsx file is far too large once unpacked")
        for entry in entries:
            packed = max(entry.compress_size, 1)
            if entry.file_size > 1024 * 1024 and entry.file_size / packed > MAX_COMPRESSION_RATIO:
                raise invalid_file("This .xlsx file is not a normal spreadsheet")


def _read_xlsx(data: bytes, max_rows: int) -> list[tuple[int, list[Cell]]]:
    _check_zip(data)
    scan_limit = max_rows * 5 + 1000
    records: list[tuple[int, list[Cell]]] = []
    data_rows = 0
    workbook = None
    try:
        # read_only streams the sheet; keep_links=False never opens external workbooks;
        # data_only=False keeps formulas visible (as data_type "f") so they can be refused.
        workbook = load_workbook(
            io.BytesIO(data), read_only=True, data_only=False, keep_links=False
        )
        if not workbook.worksheets:
            raise invalid_file("The workbook has no sheets")
        sheet = workbook.worksheets[0]
        for number, row in enumerate(sheet.iter_rows(max_col=MAX_COLUMNS + 1), start=1):
            if number > scan_limit:
                raise _too_many_rows(max_rows)
            cells = [
                Cell(_limited(getattr(cell, "value", None)), getattr(cell, "data_type", "n") == "f")
                for cell in row
            ]
            if len(cells) > MAX_COLUMNS and not is_blank(cells[MAX_COLUMNS:]):
                raise invalid_file(f"The file has more than {MAX_COLUMNS} columns")
            if number > 1:
                if is_blank(cells):
                    continue
                data_rows += 1
                if data_rows > max_rows:
                    raise _too_many_rows(max_rows)
            records.append((number, cells))
    except ApiError:
        raise
    except Exception as error:  # an untrusted parser: whatever it raises means "bad file"
        # openpyxl, zipfile, defusedxml and expat raise many different types for a bad file.
        logger.info("rejected an unreadable .xlsx: %s", type(error).__name__)
        raise invalid_file("The .xlsx file could not be read. Is it a valid workbook?") from error
    finally:
        if workbook is not None:
            workbook.close()
    return records


def _limited(value: object) -> object:
    return value[: MAX_CELL_CHARS + 1] if isinstance(value, str) else value


def _too_many_rows(max_rows: int) -> ApiError:
    return ApiError(
        422,
        "too_many_rows",
        f"The file has more than {max_rows} rows. Split it into smaller files "
        "(and remove blank rows at the bottom)",
    )
