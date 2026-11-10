"""The import's file reading, cell reading and validation: no database, no HTTP.

Reading is where a hostile upload meets the code, so this covers the bad files as well as the
good ones: binary junk, zip bombs, macros, XML entity tricks, formulas, huge files.
"""

import io
import zipfile
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import openpyxl
import pytest
from import_files import csv_bytes, good_row, more_variant, with_parts, xlsx_bytes

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.services import import_sheet
from vendor_api.services.import_sheet import Cell, read_sheet
from vendor_api.services.import_template import csv_template, xlsx_template
from vendor_api.services.product_import import (
    COLUMNS,
    REQUIRED,
    CellError,
    Group,
    ProductImportService,
    read_bool,
    read_int,
    read_paise,
    read_text,
)
from vendor_api.services.products import ProductService


def read(data: bytes, max_rows: int = 100) -> import_sheet.Sheet:
    return read_sheet(data, max_rows=max_rows, known=COLUMNS, required=REQUIRED)


def refused(data: bytes, code: str, max_rows: int = 100) -> ApiError:
    with pytest.raises(ApiError) as caught:
        read(data, max_rows)
    assert caught.value.code == code
    assert caught.value.status_code == 422
    return caught.value


# --- CSV ---------------------------------------------------------------------------------


def test_a_csv_is_read_into_rows_keyed_by_column() -> None:
    sheet = read(csv_bytes([good_row(), good_row(sku="SCARF", variant_sku="S-1")]))
    assert sheet.format == "csv"
    assert [row.number for row in sheet.rows] == [2, 3]
    assert sheet.rows[0].cells["title"].value == "Block-print kurta"
    assert sheet.rows[1].cells["sku"].value == "SCARF"
    assert sheet.ignored_columns == []


def test_a_header_only_file_has_no_rows() -> None:
    assert read(csv_bytes([])).rows == []


def test_the_byte_order_mark_excel_adds_is_ignored() -> None:
    assert read(csv_bytes([good_row()], bom=True)).rows[0].cells["sku"].value == "KURTA-001"


@pytest.mark.parametrize("delimiter", [";", "\t"])
def test_semicolon_and_tab_separated_files_are_read(delimiter: str) -> None:
    sheet = read(csv_bytes([good_row()], delimiter=delimiter))
    assert sheet.rows[0].cells["variant_sku"].value == "KURTA-001-M"


def test_column_names_ignore_case_spaces_and_dashes() -> None:
    header = [name.replace("_", " ").title() for name in COLUMNS]
    header[COLUMNS.index("variant_sku")] = "variant-sku"
    sheet = read(csv_bytes([good_row()], header=header))
    assert sheet.rows[0].cells["variant_sku"].value == "KURTA-001-M"
    assert sheet.rows[0].cells["return_window_days"].value == "7"


def test_unknown_columns_are_listed_and_never_read() -> None:
    data = csv_bytes(
        [{**good_row(), "notes": "=HYPERLINK(1)", "Internal ID": "9"}],
        columns=[*COLUMNS, "notes", "Internal ID"],
    )
    sheet = read(data)
    assert sheet.ignored_columns == ["notes", "Internal ID"]
    assert set(sheet.rows[0].cells) == set(COLUMNS)


def test_blank_rows_are_skipped_but_row_numbers_stay_the_spreadsheets() -> None:
    data = (
        csv_bytes([good_row()])
        + b",,,,,,,,,,,,,,,\n\n"
        + csv_bytes([good_row(sku="B")]).split(b"\n", 1)[1]
    )
    assert [row.number for row in read(data).rows] == [2, 5]


def test_a_quoted_newline_is_one_row() -> None:
    sheet = read(csv_bytes([good_row(description="line one\nline two"), good_row(sku="B")]))
    assert [row.number for row in sheet.rows] == [2, 3]
    assert sheet.rows[0].cells["description"].value == "line one\nline two"


def test_missing_required_columns_are_named() -> None:
    columns = [name for name in COLUMNS if name not in {"price", "gender"}]
    error = refused(csv_bytes([good_row()], columns=columns), "missing_columns")
    assert "gender" in error.message and "price" in error.message


def test_a_column_given_twice_is_refused() -> None:
    data = csv_bytes([good_row()], columns=[*COLUMNS, "Title"])
    refused(data, "duplicate_columns")


@pytest.mark.parametrize("data", [b"", b"\n\n", b"   \n"])
def test_an_empty_file_is_refused(data: bytes) -> None:
    error = refused(data, "invalid_file") if data == b"" else None
    if error is None:
        with pytest.raises(ApiError):
            read(data)


def test_a_file_that_is_not_utf8_is_refused_with_advice() -> None:
    error = refused(
        csv_bytes([good_row(title="Café")]).replace(b"\xc3\xa9", b"\xe9"), "invalid_file"
    )
    assert "UTF-8" in error.message


@pytest.mark.parametrize("junk", [b"\x00\x01\x02binary", b"a,b\x00c\n1,2\n", bytes(range(256))])
def test_binary_junk_is_not_a_csv(junk: bytes) -> None:
    with pytest.raises(ApiError) as caught:
        read(junk)
    assert caught.value.status_code == 422


def test_a_csv_with_an_unterminated_quote_is_refused() -> None:
    refused(csv_bytes([good_row()]) + b'sku,"never closed\n', "invalid_file")


def test_too_many_rows_are_refused_but_blank_rows_do_not_count() -> None:
    rows = [good_row(sku=f"S{i}", variant_sku=f"V{i}") for i in range(6)]
    error = refused(csv_bytes(rows), "too_many_rows", max_rows=5)
    assert "5 rows" in error.message
    assert len(read(csv_bytes(rows[:5]) + b"\n" * 50, max_rows=5).rows) == 5


def test_a_file_of_blank_rows_stops_early_instead_of_scanning_forever() -> None:
    refused(csv_bytes([good_row()]) + b"\n" * 2000, "too_many_rows", max_rows=2)


def test_a_wide_data_row_is_refused_even_with_a_valid_header() -> None:
    data = csv_bytes([]) + (b"," * (import_sheet.MAX_COLUMNS + 1000)) + b"\n"
    refused(data, "invalid_file")


def test_a_file_with_too_many_columns_is_refused() -> None:
    columns = [*COLUMNS, *[f"extra{i}" for i in range(import_sheet.MAX_COLUMNS)]]
    refused(csv_bytes([good_row()], columns=columns), "invalid_file")


def test_a_long_cell_is_cut_off_before_it_reaches_the_validators() -> None:
    sheet = read(csv_bytes([good_row(description="x" * 6_000)]))
    value = sheet.rows[0].cells["description"].value
    assert isinstance(value, str) and len(value) == import_sheet.MAX_CELL_CHARS + 1


def test_a_huge_cell_refuses_the_file() -> None:
    error = refused(csv_bytes([good_row(description="x" * 200_000)]), "invalid_file")
    assert "longer than" in error.message


# --- XLSX --------------------------------------------------------------------------------


def test_an_xlsx_is_read_like_a_csv_and_only_the_first_sheet_counts() -> None:
    sheet = read(xlsx_bytes([good_row(), good_row(sku="B", variant_sku="V2")], extra_sheet=True))
    assert sheet.format == "xlsx"
    assert [row.number for row in sheet.rows] == [2, 3]
    assert sheet.rows[0].cells["sku"].value == "KURTA-001"
    assert sheet.rows[0].cells["subcategory"].value is None  # an empty cell
    assert not sheet.rows[0].cells["title"].formula


def test_numbers_and_dates_keep_their_type_in_an_xlsx() -> None:
    book = openpyxl.Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(list(COLUMNS))
    row = {
        **good_row(),
        "price": 1499,
        "weight_grams": 350,
        "mrp": 1999.5,
        "size": date(2026, 1, 2),
    }
    sheet.append([row[name] for name in COLUMNS])
    out = io.BytesIO()
    book.save(out)
    cells = read(out.getvalue()).rows[0].cells
    assert cells["price"].value == 1499 and cells["mrp"].value == 1999.5
    assert isinstance(cells["size"].value, datetime)


def test_a_formula_cell_is_flagged() -> None:
    data = xlsx_bytes([good_row()], formulas={(2, "title"): "=1+1"})
    cells = read(data).rows[0].cells
    assert cells["title"].formula is True
    assert cells["sku"].formula is False


def test_an_xlsx_with_a_bad_zip_is_refused() -> None:
    refused(b"PK\x03\x04 this is not really a zip", "invalid_file")
    refused(xlsx_bytes([good_row()])[:300], "invalid_file")


def test_a_zip_that_is_not_a_workbook_is_refused() -> None:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("hello.txt", "hi")
    refused(out.getvalue(), "invalid_file")


@pytest.mark.parametrize(
    "part",
    ["xl/vbaProject.bin", "xl/externalLinks/externalLink1.xml", "xl/embeddings/oleObject1.bin"],
)
def test_macros_links_and_embedded_objects_are_refused(part: str) -> None:
    error = refused(with_parts(xlsx_bytes([good_row()]), {part: b"x"}), "invalid_file")
    assert "macros" in error.message


def test_a_zip_bomb_is_refused_by_ratio() -> None:
    bomb = with_parts(xlsx_bytes([good_row()]), {"xl/media/bomb.bin": bytes(3 * 1024 * 1024)})
    refused(bomb, "invalid_file")


def test_a_workbook_that_unpacks_to_too_much_is_refused() -> None:
    parts = {f"xl/media/p{i}.bin": bytes(1024 * 1024) for i in range(51)}
    refused(with_parts(xlsx_bytes([good_row()]), parts), "invalid_file")


def test_a_workbook_with_too_many_parts_is_refused() -> None:
    parts = {f"xl/media/p{i}.txt": b"x" for i in range(import_sheet.MAX_ZIP_ENTRIES + 1)}
    refused(with_parts(xlsx_bytes([good_row()]), parts), "invalid_file")


def test_defusedxml_is_active_in_openpyxl() -> None:
    assert openpyxl.DEFUSEDXML is True


def test_an_entity_declaration_in_the_workbook_xml_is_refused() -> None:
    book = xlsx_bytes([good_row()])
    sheet_xml = zipfile.ZipFile(io.BytesIO(book)).read("xl/worksheets/sheet1.xml").decode()
    attack = (
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>'
        + sheet_xml.split("?>", 1)[-1]
    )
    refused(with_parts(book, {"xl/worksheets/sheet1.xml": attack.encode()}), "invalid_file")


def test_too_many_rows_in_an_xlsx() -> None:
    rows = [good_row(sku=f"S{i}", variant_sku=f"V{i}") for i in range(6)]
    refused(xlsx_bytes(rows), "too_many_rows", max_rows=5)


# --- Reading cells -----------------------------------------------------------------------


def text(value: object, **kw: Any) -> str | None:
    return read_text(Cell(value, **kw))


def error_of(call: Any) -> CellError:
    with pytest.raises(CellError) as caught:
        call()
    return caught.value


def test_text_is_trimmed_and_empty_is_none() -> None:
    assert text("  hello  ") == "hello"
    assert text("  hello  ") == "hello"
    assert text("   ") is None and text(None) is None and text("") is None


def test_numbers_in_text_columns_become_text() -> None:
    assert text(38) == "38" and text(38.0) == "38" and text(12.5) == "12.5"
    assert text(Decimal("7")) == "7"
    assert text(True) == "yes"


@pytest.mark.parametrize(
    "value", ["=1+1", "=cmd|' /C calc'!A0", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "-"]
)
def test_text_a_spreadsheet_would_run_as_a_formula_is_refused(value: str) -> None:
    assert error_of(lambda: text(value)).code in {"formula_like", "formula"}


def test_a_real_formula_cell_is_refused_whatever_it_says() -> None:
    assert error_of(lambda: text("hello", formula=True)).code == "formula"
    assert error_of(lambda: text(None, formula=True)).code == "formula"


def test_a_formula_start_in_the_middle_is_fine() -> None:
    assert text("price = 5 - 3") == "price = 5 - 3"
    assert text("a+b") == "a+b"


@pytest.mark.parametrize("value", ["a\x00b", "a\x07b", "a\x1bb", "a\x7fb"])
def test_control_characters_are_refused(value: str) -> None:
    assert error_of(lambda: text(value)).code == "invalid_characters"


def test_newlines_and_tabs_inside_text_are_allowed() -> None:
    assert text("one\ntwo\tthree") == "one\ntwo\tthree"


@pytest.mark.parametrize("value", [datetime(2026, 1, 2, tzinfo=UTC), date(2026, 1, 2), object()])
def test_dates_and_other_objects_are_not_text(value: object) -> None:
    assert error_of(lambda: text(value)).code == "invalid_text"


def test_overlong_text_is_refused() -> None:
    assert error_of(lambda: text("x" * 5001)).code == "too_long"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("999", 99_900),
        ("999.5", 99_950),
        ("999.50", 99_950),
        ("0.99", 99),
        ("1499", 149_900),
        (1499, 149_900),
        (899.5, 89_950),
        (1999.99, 199_999),
        (Decimal("12.30"), 1_230),
        ("0", 0),
        ("  250  ", 25_000),
    ],
)
def test_money_is_read_as_exact_paise(value: object, expected: int) -> None:
    assert read_paise(Cell(value)) == expected


@pytest.mark.parametrize(
    "value",
    [
        "1,000",
        "₹500",
        "Rs 500",
        "500.999",
        "1e3",
        "-5",
        "+5",
        "abc",
        "12.",
        ".5",
        "NaN",
        "Infinity",
        "12345678901234",
        500.999,
        float("nan"),
        float("inf"),
        True,
        "5 0",
    ],
)
def test_money_that_is_not_a_plain_amount_is_refused(value: object) -> None:
    error = error_of(lambda: read_paise(Cell(value)))
    assert error.code == "invalid_number"


def test_money_blank_is_none() -> None:
    assert read_paise(Cell(None)) is None and read_paise(Cell("  ")) is None


def test_a_negative_amount_gets_the_money_message_not_the_formula_one() -> None:
    assert error_of(lambda: read_paise(Cell("-5"))).code == "invalid_number"
    assert error_of(lambda: read_int(Cell("-5"), 1, 10)).code == "out_of_range"


@pytest.mark.parametrize(("value", "expected"), [("350", 350), (350, 350), (350.0, 350), ("0", 0)])
def test_whole_numbers(value: object, expected: int) -> None:
    assert read_int(Cell(value), 0, 1_000_000) == expected


@pytest.mark.parametrize("value", ["3.5", 3.5, "1e2", "ten", "1,000", "NaN", "Infinity"])
def test_numbers_that_are_not_whole_are_refused(value: object) -> None:
    assert error_of(lambda: read_int(Cell(value), 0, 1_000_000)).code == "invalid_number"


def test_numbers_outside_the_range_are_refused() -> None:
    assert error_of(lambda: read_int(Cell("31"), 0, 30)).code == "out_of_range"
    assert error_of(lambda: read_int(Cell(0), 1, 10)).code == "out_of_range"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("yes", True),
        ("YES", True),
        ("Y", True),
        ("true", True),
        ("1", True),
        (True, True),
        ("no", False),
        ("No", False),
        ("n", False),
        ("false", False),
        ("0", False),
        (False, False),
        (1, True),
        (0, False),
        (1.0, True),
    ],
)
def test_yes_and_no(value: object, expected: bool) -> None:
    assert read_bool(Cell(value)) is expected


@pytest.mark.parametrize("value", ["maybe", "2", "yes please", 2])
def test_anything_else_is_not_a_yes_or_no(value: object) -> None:
    assert error_of(lambda: read_bool(Cell(value))).code == "invalid_choice"


def test_blank_yes_no_is_none() -> None:
    assert read_bool(Cell(None)) is None


# --- Rows into products ------------------------------------------------------------------


def groups_of(rows: list[dict[str, Any]], **kw: Any) -> list[Group]:
    """Everything the import does before it touches the database."""
    settings = Settings(_env_file=None, database_url="postgresql://u:p@h/d", redis_url="redis://h")
    service = ProductImportService(settings, ProductService())
    groups = service._group(read(csv_bytes(rows, **kw)).rows)
    for group in groups:
        service._validate(group)
    service._check_duplicates_in_file(groups)
    return groups


def problems(groups: list[Group]) -> list[tuple[int, str | None, str]]:
    return sorted((e.row, e.column, e.code) for group in groups for e in group.errors)


def test_a_good_row_is_a_valid_product_with_one_variant() -> None:
    (group,) = groups_of([good_row()])
    assert group.status == "valid" and group.errors == []
    content = group.content
    assert content is not None
    assert (content.title, content.category, content.gender) == (
        "Block-print kurta",
        "kurtas",
        "women",
    )
    assert (content.weight_grams, content.returnable, content.return_window_days) == (350, True, 7)
    (variant,) = content.variants
    assert (variant.sku, variant.size, variant.color) == ("KURTA-001-M", "M", "Indigo")
    assert (variant.price_paise, variant.mrp_paise, variant.is_active) == (149_900, 199_900, True)
    assert content.images == []


def test_rows_with_the_same_sku_are_one_product_with_several_variants() -> None:
    (group,) = groups_of(
        [good_row(), more_variant(), more_variant(variant_sku="KURTA-001-S", size="S")]
    )
    assert group.status == "valid"
    assert group.numbers == [2, 3, 4]
    assert group.content is not None
    assert [v.sku for v in group.content.variants] == ["KURTA-001-M", "KURTA-001-L", "KURTA-001-S"]


def test_the_sku_that_groups_rows_ignores_letter_case() -> None:
    groups = groups_of([good_row(), more_variant(sku="kurta-001")])
    assert len(groups) == 1 and groups[0].status == "valid"


def test_mrp_defaults_to_the_price_and_is_active_to_yes() -> None:
    (group,) = groups_of([good_row(mrp="", is_active="")])
    assert group.content is not None
    variant = group.content.variants[0]
    assert (variant.mrp_paise, variant.is_active) == (149_900, True)


def test_a_product_can_have_an_inactive_variant() -> None:
    (group,) = groups_of([good_row(is_active="no")])
    assert group.content is not None and group.content.variants[0].is_active is False


def test_details_repeated_on_later_rows_must_match_the_first() -> None:
    (group,) = groups_of(
        [
            good_row(),
            more_variant(title="Block-print kurta"),
            more_variant(variant_sku="K-S", size="S", title="Another title"),
        ]
    )
    assert group.status == "rejected"
    assert problems([group]) == [(4, "title", "conflicting_value")]


def test_every_required_cell_is_reported_with_its_row_and_column() -> None:
    row = good_row(sku="", title="", category="", gender="", variant_sku="", price="")
    assert problems(groups_of([row])) == [
        (2, "category", "required"),
        (2, "gender", "required"),
        (2, "price", "required"),
        (2, "sku", "required"),
        (2, "title", "required"),
        (2, "variant_sku", "required"),
    ]


def test_a_returnable_product_needs_its_window() -> None:
    assert problems(groups_of([good_row(return_window_days="")])) == [
        (2, "return_window_days", "required")
    ]
    (group,) = groups_of([good_row(returnable="no", return_window_days="")])
    assert group.status == "valid"


def test_the_apis_own_limits_are_applied_and_mapped_to_a_column() -> None:
    cases = [
        (good_row(title="x" * 201), "title"),
        (good_row(gender="kids"), "gender"),
        (good_row(variant_sku="bad;sku"), "variant_sku"),
        (good_row(sku="bad;sku", variant_sku="V1"), "sku"),
        (good_row(price="0"), "price"),
        (good_row(price="1500", mrp="1000"), "mrp"),
        (good_row(color="x" * 33), "color"),
        (good_row(fabric="x" * 81), "fabric"),
    ]
    for row, column in cases:
        found = problems(groups_of([row]))
        assert found and {c for _, c, _ in found} == {column}, (column, found)
        assert all(r == 2 for r, _, _ in found)


def test_an_error_on_a_later_variant_is_reported_on_that_row() -> None:
    found = problems(groups_of([good_row(), more_variant(price="0")]))
    assert found == [(3, "price", "invalid_value")]


def test_a_variant_sku_used_twice_in_a_product_is_reported_on_the_later_row() -> None:
    found = problems(groups_of([good_row(), more_variant(variant_sku="KURTA-001-M", size="L")]))
    assert (3, "variant_sku", "duplicate_variant_sku") in found


def test_two_variants_with_the_same_size_and_colour_are_reported() -> None:
    found = problems(groups_of([good_row(), more_variant(size="m", color="indigo")]))
    assert (3, "size", "duplicate_variant") in found


def test_a_variant_sku_used_by_two_products_is_reported_on_the_later_one() -> None:
    groups = groups_of([good_row(), good_row(sku="SCARF", variant_sku="kurta-001-m")])
    assert groups[0].status == "valid"
    assert groups[1].status == "rejected"
    assert problems(groups) == [(3, "variant_sku", "duplicate_variant_sku")]


def test_a_bad_product_does_not_stop_the_others_being_checked() -> None:
    groups = groups_of(
        [
            good_row(),
            good_row(sku="BAD", variant_sku="B1", price="x"),
            good_row(sku="OK2", variant_sku="V2"),
        ]
    )
    assert [g.status for g in groups] == ["valid", "rejected", "valid"]
    assert problems(groups) == [(3, "price", "invalid_number")]


def test_formulas_and_formula_like_text_never_become_a_product() -> None:
    for text_value in ['=HYPERLINK("http://evil")', "+1+1", "-2+3", "@SUM(1)"]:
        (group,) = groups_of([good_row(title=text_value)])
        assert group.status == "rejected" and group.content is None
        assert problems([group])[0][:2] == (2, "title")


def test_a_row_without_a_sku_is_its_own_rejected_product() -> None:
    groups = groups_of([good_row(sku=""), good_row(sku="", variant_sku="V9")])
    assert [g.status for g in groups] == ["rejected", "rejected"]
    assert [g.numbers for g in groups] == [[2], [3]]


def test_the_template_columns_are_the_documented_ones() -> None:
    assert COLUMNS[:3] == ("sku", "title", "description")
    assert set(REQUIRED) <= set(COLUMNS)


# --- The template ------------------------------------------------------------------------


@pytest.mark.parametrize("make_template", [csv_template, xlsx_template])
def test_the_template_files_are_a_clean_sheet_the_importer_accepts(
    make_template: Callable[[], bytes],
) -> None:
    settings = Settings(_env_file=None, database_url="postgresql://u:p@h/d", redis_url="redis://h")
    service = ProductImportService(settings, ProductService())
    sheet = read(make_template())
    assert sheet.ignored_columns == []
    groups = service._group(sheet.rows)
    for group in groups:
        service._validate(group)
    service._check_duplicates_in_file(groups)
    assert [g.sku for g in groups] == ["KURTA-001", "SCARF-014"]
    assert [g.status for g in groups] == ["valid", "valid"]
    assert [g.numbers for g in groups] == [[2, 3], [4]]
    assert all(g.errors == [] for g in groups)
    scarf = groups[1].content
    assert scarf is not None and scarf.variants[0].price_paise == 89_950


def test_the_excel_template_has_an_instructions_sheet_the_importer_ignores() -> None:
    book = openpyxl.load_workbook(io.BytesIO(xlsx_template()))
    assert book.sheetnames == ["Products", "Instructions"]
    assert book["Products"]["A1"].value == "sku"
