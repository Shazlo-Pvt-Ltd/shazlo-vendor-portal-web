"""The bulk product import over HTTP: the template, the report, every mode, and bad files."""

import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
from conftest import Tenant, Tenants
from import_files import csv_bytes, good_row, more_variant, with_parts, xlsx_bytes
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import ApiError
from vendor_api.core.settings import Settings
from vendor_api.db.models import Product, ProductVariant
from vendor_api.services.product_import import COLUMNS, ProductImportService
from vendor_api.services.products import ProductContent, ProductService

URL = "/v1/vendor/products/import"
CSV = "text/csv"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def upload(
    tenants: Tenants,
    tenant: Tenant,
    data: bytes | AsyncIterator[bytes],
    *,
    content_type: str | None = CSV,
    mode: str | None = None,
    token: str | None = None,
) -> httpx.Response:
    headers = bearer(token or tenant.owner_token)
    if content_type is not None:
        headers["Content-Type"] = content_type
    return await tenants.api.http.post(
        URL + (f"?mode={mode}" if mode else ""), content=data, headers=headers
    )


async def products_of(session: AsyncSession, vendor_id: uuid.UUID) -> list[Product]:
    result = await session.scalars(
        select(Product)
        .where(Product.vendor_id == vendor_id)
        .order_by(Product.sku_key)
        .execution_options(populate_existing=True)
    )
    return list(result)


async def count(session: AsyncSession, model: Any, vendor_id: uuid.UUID) -> int:
    return (
        await session.scalar(
            select(func.count()).select_from(model).where(model.vendor_id == vendor_id)
        )
        or 0
    )


def two_products() -> list[dict[str, Any]]:
    return [
        good_row(),
        more_variant(),
        good_row(sku="SCARF-014", title="Silk scarf", variant_sku="SCARF-014-OS", size=""),
    ]


def summary(response: httpx.Response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()["summary"]
    return body


def errors(response: httpx.Response) -> list[tuple[int, str | None, str]]:
    return [(e["row"], e["column"], e["code"]) for e in response.json()["errors"]]


# --- The template ------------------------------------------------------------------------


@pytest.mark.parametrize(("fmt", "media"), [("csv", "text/csv"), ("xlsx", XLSX), (None, XLSX)])
async def test_the_template_downloads_as_a_file(
    tenants: Tenants, fmt: str | None, media: str
) -> None:
    query = f"?format={fmt}" if fmt else ""
    response = await tenants.api.http.get(
        f"{URL}/template{query}", headers=bearer(tenants.a.owner_token)
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(media)
    extension = fmt or "xlsx"
    assert f"shazlo-product-import-template.{extension}" in response.headers["content-disposition"]
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert len(response.content) > 100


async def test_the_template_needs_a_token_and_a_known_format(tenants: Tenants) -> None:
    http = tenants.api.http
    assert (await http.get(f"{URL}/template")).status_code == 401
    bad = await http.get(f"{URL}/template?format=exe", headers=bearer(tenants.a.owner_token))
    assert bad.status_code == 422


@pytest.mark.parametrize("fmt", ["csv", "xlsx"])
async def test_the_untouched_template_is_a_clean_report_and_then_imports(
    tenants: Tenants, session: AsyncSession, fmt: str
) -> None:
    vendor_id = tenants.a.vendor.id
    template = await tenants.api.http.get(
        f"{URL}/template?format={fmt}", headers=bearer(tenants.a.owner_token)
    )
    media = CSV if fmt == "csv" else XLSX

    checked = await upload(
        tenants, tenants.a, template.content, content_type=media, mode="validate"
    )
    assert summary(checked) == {
        "products": 2,
        "created": 0,
        "unchanged": 0,
        "valid": 2,
        "rejected": 0,
        "rows_read": 3,
        "rows_with_errors": 0,
    }
    assert checked.json()["errors"] == [] and checked.json()["committed"] is False
    assert await count(session, Product, vendor_id) == 0

    imported = await upload(tenants, tenants.a, template.content, content_type=media)
    assert summary(imported)["created"] == 2
    assert await count(session, Product, vendor_id) == 2
    assert await count(session, ProductVariant, vendor_id) == 3


# --- Importing ---------------------------------------------------------------------------


async def test_a_csv_import_creates_draft_products_with_their_variants(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    response = await upload(tenants, tenants.a, csv_bytes(two_products()))
    body = response.json()
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert (body["mode"], body["file_format"], body["committed"]) == ("import", "csv", True)
    assert summary(response)["created"] == 2
    by_sku = {p["sku"]: p for p in body["products"]}
    assert by_sku["KURTA-001"]["rows"] == [2, 3]
    assert by_sku["SCARF-014"]["rows"] == [4]
    assert all(p["status"] == "created" and p["product_id"] for p in by_sku.values())

    detail = await tenants.api.http.get(
        f"/v1/vendor/products/{by_sku['KURTA-001']['product_id']}",
        headers=bearer(tenants.a.owner_token),
    )
    product = detail.json()
    assert (product["status"], product["live"]) == ("draft", None)
    working = product["working"]
    assert (working["title"], working["category"], working["gender"]) == (
        "Block-print kurta",
        "kurtas",
        "women",
    )
    assert (working["returnable"], working["return_window_days"], working["weight_grams"]) == (
        True,
        7,
        350,
    )
    assert working["images"] == []  # an import cannot carry images
    assert [
        (v["sku"], v["size"], v["price_paise"], v["mrp_paise"]) for v in working["variants"]
    ] == [
        ("KURTA-001-L", "L", 149_900, 199_900),
        ("KURTA-001-M", "M", 149_900, 199_900),
    ]
    assert [p.status for p in await products_of(session, vendor_id)] == ["draft", "draft"]


async def test_an_xlsx_import_does_the_same(tenants: Tenants, session: AsyncSession) -> None:
    vendor_id = tenants.a.vendor.id
    response = await upload(tenants, tenants.a, xlsx_bytes(two_products()), content_type=XLSX)
    assert response.json()["file_format"] == "xlsx"
    assert summary(response)["created"] == 2
    assert await count(session, ProductVariant, vendor_id) == 3


async def test_the_same_file_again_creates_nothing_new(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    data = csv_bytes(two_products())
    first = await upload(tenants, tenants.a, data)
    ids = {p["sku"]: p["product_id"] for p in first.json()["products"]}
    for _ in range(3):
        again = await upload(tenants, tenants.a, data)
        assert summary(again)["created"] == 0 and summary(again)["unchanged"] == 2
        assert again.json()["committed"] is False
        assert {p["sku"]: p["product_id"] for p in again.json()["products"]} == ids
        assert all(p["status"] == "unchanged" for p in again.json()["products"])
    assert await count(session, Product, vendor_id) == 2
    assert await count(session, ProductVariant, vendor_id) == 3


async def test_the_same_products_in_another_format_or_case_are_not_duplicated(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await upload(tenants, tenants.a, csv_bytes(two_products()))
    lowered = [{**row, "sku": row["sku"].lower()} for row in two_products()]
    again = await upload(tenants, tenants.a, xlsx_bytes(lowered), content_type=XLSX)
    assert summary(again)["unchanged"] == 2 and summary(again)["created"] == 0
    assert await count(session, Product, vendor_id) == 2


async def test_a_file_with_a_bad_product_imports_the_good_ones_and_reports_the_bad(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    rows = [
        good_row(sku="GOOD-1", variant_sku="G1"),
        good_row(sku="BAD", variant_sku="B1", price="abc"),
        more_variant(sku="BAD", variant_sku="B2", size="L"),
        good_row(sku="GOOD-2", variant_sku="G2"),
    ]
    response = await upload(tenants, tenants.a, csv_bytes(rows))
    assert summary(response) == {
        "products": 3,
        "created": 2,
        "unchanged": 0,
        "valid": 0,
        "rejected": 1,
        "rows_read": 4,
        "rows_with_errors": 1,
    }
    assert response.json()["committed"] is True
    assert errors(response) == [(3, "price", "invalid_number")]
    message = response.json()["errors"][0]["message"]
    assert "rupees" in message
    statuses = {p["sku"]: (p["status"], p["rows"]) for p in response.json()["products"]}
    assert statuses == {
        "GOOD-1": ("created", [2]),
        "BAD": ("rejected", [3, 4]),
        "GOOD-2": ("created", [5]),
    }
    assert [p.sku for p in await products_of(session, vendor_id)] == ["GOOD-1", "GOOD-2"]


async def test_every_rejected_row_is_in_the_report_with_a_reason(tenants: Tenants) -> None:
    rows = [
        good_row(sku="A", variant_sku="A1", title=""),
        good_row(sku="B", variant_sku="B1", gender="kids"),
        good_row(sku="C", variant_sku="C1", price="0"),
        good_row(sku="D", variant_sku="D1", returnable="maybe"),
        good_row(sku="E", variant_sku="E1", weight_grams="heavy"),
    ]
    response = await upload(tenants, tenants.a, csv_bytes(rows), mode="validate")
    assert errors(response) == [
        (2, "title", "required"),
        (3, "gender", "invalid_value"),
        (4, "price", "invalid_value"),
        (5, "returnable", "invalid_choice"),
        (6, "weight_grams", "invalid_number"),
    ]
    assert summary(response)["rows_with_errors"] == 5
    assert all(e["message"] for e in response.json()["errors"])


async def test_validate_writes_nothing(tenants: Tenants, session: AsyncSession) -> None:
    vendor_id = tenants.a.vendor.id
    response = await upload(tenants, tenants.a, csv_bytes(two_products()), mode="validate")
    assert summary(response)["valid"] == 2 and response.json()["committed"] is False
    assert await count(session, Product, vendor_id) == 0
    # ...and a real import afterwards still creates them (nothing was left half-done).
    assert summary(await upload(tenants, tenants.a, csv_bytes(two_products())))["created"] == 2


async def test_all_or_nothing_imports_nothing_when_any_row_is_bad(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    rows = [
        good_row(sku="GOOD", variant_sku="G1"),
        good_row(sku="BAD", variant_sku="B1", price="x"),
    ]
    response = await upload(tenants, tenants.a, csv_bytes(rows), mode="all_or_nothing")
    assert response.json()["committed"] is False
    assert summary(response)["created"] == 0 and summary(response)["rejected"] == 1
    assert summary(response)["valid"] == 1  # checked, but not written
    assert errors(response) == [(3, "price", "invalid_number")]
    assert await count(session, Product, vendor_id) == 0


async def test_all_or_nothing_imports_everything_when_the_file_is_clean(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    response = await upload(tenants, tenants.a, csv_bytes(two_products()), mode="all_or_nothing")
    assert response.json()["committed"] is True and summary(response)["created"] == 2
    assert await count(session, Product, vendor_id) == 2


async def test_an_unknown_mode_is_a_422(tenants: Tenants) -> None:
    response = await upload(tenants, tenants.a, csv_bytes([good_row()]), mode="overwrite")
    assert response.status_code == 422


# --- Products that already exist ---------------------------------------------------------


async def test_a_product_that_exists_with_different_details_is_never_overwritten(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await upload(tenants, tenants.a, csv_bytes([good_row()]))
    changed = await upload(tenants, tenants.a, csv_bytes([good_row(title="A different title")]))
    assert summary(changed)["rejected"] == 1 and summary(changed)["created"] == 0
    assert errors(changed) == [(2, "sku", "sku_exists")]
    (product,) = await products_of(session, vendor_id)
    detail = await tenants.api.http.get(
        f"/v1/vendor/products/{product.id}", headers=bearer(tenants.a.owner_token)
    )
    assert detail.json()["working"]["title"] == "Block-print kurta"


async def test_a_product_edited_after_the_import_is_not_reset_by_importing_again(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    first = await upload(tenants, tenants.a, csv_bytes([good_row()]))
    product_id = first.json()["products"][0]["product_id"]
    body = {
        "title": "Edited by the vendor",
        "category": "kurtas",
        "gender": "women",
        "variants": [
            {"sku": "KURTA-001-M", "size": "M", "color": "Indigo", "price_paise": 1, "mrp_paise": 2}
        ],
    }
    edit = await tenants.api.http.put(
        f"/v1/vendor/products/{product_id}", json=body, headers=bearer(tenants.a.owner_token)
    )
    assert edit.status_code == 200
    again = await upload(tenants, tenants.a, csv_bytes([good_row()]))
    assert errors(again) == [(2, "sku", "sku_exists")]
    assert await count(session, Product, vendor_id) == 1
    detail = await tenants.api.http.get(
        f"/v1/vendor/products/{product_id}", headers=bearer(tenants.a.owner_token)
    )
    assert detail.json()["working"]["title"] == "Edited by the vendor"


async def test_a_variant_sku_used_by_another_product_is_reported_on_its_row(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    await upload(tenants, tenants.a, csv_bytes([good_row()]))
    other = good_row(sku="SCARF-014", variant_sku="kurta-001-m")  # taken by KURTA-001
    response = await upload(tenants, tenants.a, csv_bytes([other]))
    assert errors(response) == [(2, "variant_sku", "variant_sku_taken")]
    assert await count(session, Product, vendor_id) == 1


async def test_two_vendors_can_import_the_same_skus(
    tenants: Tenants, session: AsyncSession
) -> None:
    a_id, b_id = tenants.a.vendor.id, tenants.b.vendor.id
    data = csv_bytes(two_products())
    assert summary(await upload(tenants, tenants.a, data))["created"] == 2
    assert summary(await upload(tenants, tenants.b, data))["created"] == 2
    assert await count(session, Product, a_id) == await count(session, Product, b_id) == 2
    mine = {p.id for p in await products_of(session, a_id)}
    theirs = {p.id for p in await products_of(session, b_id)}
    assert not mine & theirs


async def test_a_vendors_report_never_shows_another_vendors_products(
    tenants: Tenants,
) -> None:
    await upload(tenants, tenants.b, csv_bytes([good_row(sku="ONLY-B", variant_sku="B1")]))
    response = await upload(
        tenants, tenants.a, csv_bytes([good_row(sku="ONLY-A")]), mode="validate"
    )
    assert "ONLY-B" not in response.text


# --- Failures while writing --------------------------------------------------------------


class FlakyProducts(ProductService):
    """A products service that fails for one SKU, as if another request had just taken it."""

    def __init__(self, failure: Callable[[], Exception]) -> None:
        super().__init__()
        self._failure = failure

    async def stage_create(
        self, db: Any, vendor: Any, user_id: Any, sku: str, content: ProductContent
    ) -> Any:
        if sku == "FLAKY":
            raise self._failure()
        return await super().stage_create(db, vendor, user_id, sku, content)


def flaky_import(tenants: Tenants, failure: Callable[[], Exception]) -> None:
    settings: Settings = tenants.api.app.state.settings
    tenants.api.app.state.product_import = ProductImportService(settings, FlakyProducts(failure))


def clash() -> Exception:
    return IntegrityError(
        "INSERT", {}, Exception('violates unique constraint "uq_products_vendor_id_sku_key"')
    )


def taken() -> Exception:
    return ApiError(409, "sku_taken", "You already use this SKU")


@pytest.mark.parametrize("failure", [clash, taken])
async def test_a_product_that_fails_to_save_is_reported_and_the_others_still_import(
    tenants: Tenants, session: AsyncSession, failure: Callable[[], Exception]
) -> None:
    vendor_id = tenants.a.vendor.id
    flaky_import(tenants, failure)
    rows = [
        good_row(sku="FIRST", variant_sku="F1"),
        good_row(sku="FLAKY", variant_sku="X1"),
        good_row(sku="LAST", variant_sku="L1"),
    ]
    response = await upload(tenants, tenants.a, csv_bytes(rows))
    assert summary(response)["created"] == 2 and summary(response)["rejected"] == 1
    assert errors(response) == [(3, "sku", "sku_taken")]
    assert response.json()["committed"] is True
    assert [p.sku for p in await products_of(session, vendor_id)] == ["FIRST", "LAST"]


async def test_all_or_nothing_undoes_everything_if_a_product_fails_to_save(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    flaky_import(tenants, clash)
    rows = [
        good_row(sku="FIRST", variant_sku="F1"),
        good_row(sku="FLAKY", variant_sku="X1"),
        good_row(sku="LAST", variant_sku="L1"),
    ]
    response = await upload(tenants, tenants.a, csv_bytes(rows), mode="all_or_nothing")
    assert response.json()["committed"] is False
    assert summary(response)["created"] == 0
    assert errors(response) == [(3, "sku", "sku_taken")]
    assert all(p["product_id"] is None for p in response.json()["products"])
    assert await count(session, Product, vendor_id) == 0


# --- Files that must not be imported -----------------------------------------------------


@pytest.mark.parametrize("content_type", [None, "application/json", "image/png", "text/html"])
async def test_something_that_is_not_a_spreadsheet_is_a_415(
    tenants: Tenants, content_type: str | None
) -> None:
    response = await upload(tenants, tenants.a, csv_bytes([good_row()]), content_type=content_type)
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_file_type"


async def test_an_empty_body_is_a_422(tenants: Tenants) -> None:
    response = await upload(tenants, tenants.a, b"")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_file"


@pytest.mark.parametrize(
    "data",
    [bytes(range(256)) * 20, b"PK\x03\x04 not really", b"\x00" * 100, b'a,b\n"unterminated\n'],
)
async def test_junk_is_a_422_that_says_nothing_about_the_server(
    tenants: Tenants, data: bytes
) -> None:
    for content_type in (CSV, XLSX, "application/octet-stream"):
        response = await upload(tenants, tenants.a, data, content_type=content_type)
        assert response.status_code == 422
        text = response.text
        assert "Traceback" not in text and "openpyxl" not in text and "site-packages" not in text


async def test_a_file_without_the_required_columns_is_a_422_that_names_them(
    tenants: Tenants,
) -> None:
    columns = [c for c in COLUMNS if c not in {"sku", "price"}]
    response = await upload(tenants, tenants.a, csv_bytes([good_row()], columns=columns))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "missing_columns"
    assert "price" in response.json()["error"]["message"]


async def test_a_file_over_the_size_limit_is_a_413_by_its_declared_length(
    tenants: Tenants, override: Callable[..., Settings]
) -> None:
    tenants.api.app.state.settings = override(
        tenants.api.app.state.settings, import_max_bytes=2_000
    )
    response = await upload(tenants, tenants.a, b"x" * 2_001)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


async def test_a_body_that_does_not_declare_its_length_is_cut_off_while_it_streams(
    tenants: Tenants, override: Callable[..., Settings]
) -> None:
    tenants.api.app.state.settings = override(
        tenants.api.app.state.settings, import_max_bytes=2_000
    )
    sent = 0

    async def chunks() -> AsyncIterator[bytes]:
        nonlocal sent
        for _ in range(200):
            sent += 100
            yield b"x" * 100

    response = await upload(tenants, tenants.a, chunks())
    assert response.status_code == 413
    assert sent < 20_000  # it stopped reading long before the end


async def test_a_file_with_too_many_rows_is_a_422(
    tenants: Tenants, override: Callable[..., Settings]
) -> None:
    small = override(tenants.api.app.state.settings, import_max_rows=3)
    tenants.api.app.state.product_import = ProductImportService(
        small, tenants.api.app.state.products
    )
    rows = [good_row(sku=f"S{i}", variant_sku=f"V{i}") for i in range(4)]
    response = await upload(tenants, tenants.a, csv_bytes(rows))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "too_many_rows"
    assert (
        await upload(tenants, tenants.a, csv_bytes(rows[:3]), mode="validate")
    ).status_code == 200


async def test_a_workbook_with_macros_is_a_422(tenants: Tenants) -> None:
    book = with_parts(xlsx_bytes([good_row()]), {"xl/vbaProject.bin": b"MZ"})
    response = await upload(tenants, tenants.a, book, content_type=XLSX)
    assert response.status_code == 422
    assert "macros" in response.json()["error"]["message"]


async def test_a_zip_bomb_is_a_422(tenants: Tenants) -> None:
    book = with_parts(xlsx_bytes([good_row()]), {"xl/media/bomb.bin": bytes(3 * 1024 * 1024)})
    assert len(book) < 100_000  # small on the wire, huge unpacked
    response = await upload(tenants, tenants.a, book, content_type=XLSX)
    assert response.status_code == 422


async def test_a_formula_cell_rejects_its_product_and_runs_nothing(
    tenants: Tenants, session: AsyncSession
) -> None:
    vendor_id = tenants.a.vendor.id
    rows = [good_row(sku="FORMULA", variant_sku="F1"), good_row(sku="PLAIN", variant_sku="P1")]
    book = xlsx_bytes(rows, formulas={(2, "title"): '=HYPERLINK("http://evil.example","x")'})
    response = await upload(tenants, tenants.a, book, content_type=XLSX)
    assert errors(response) == [(2, "title", "formula")]
    assert "evil.example" not in response.text  # the cell's content is not echoed
    assert [p.sku for p in await products_of(session, vendor_id)] == ["PLAIN"]


@pytest.mark.parametrize(
    "attack", ["=cmd|' /C calc'!A0", "+1+1", "-2+3", "@SUM(1+1)", "\t=1+1", "\r=1+1"]
)
async def test_text_a_spreadsheet_would_run_is_rejected_in_every_text_column(
    tenants: Tenants, session: AsyncSession, attack: str
) -> None:
    vendor_id = tenants.a.vendor.id
    for column in ("title", "description", "category", "fabric", "size", "color"):
        response = await upload(
            tenants, tenants.a, csv_bytes([good_row(**{column: attack})]), mode="validate"
        )
        assert summary(response)["rejected"] == 1, column
        assert errors(response)[0][:2] == (2, column)
        assert errors(response)[0][2] in {"formula_like", "formula"}
    assert await count(session, Product, vendor_id) == 0


async def test_numbers_with_odd_formats_cannot_smuggle_text_into_a_price(
    tenants: Tenants,
) -> None:
    for value in ["=1+1", "@A1", "1e3", "NaN", "0x10", "₹1,499"]:
        response = await upload(
            tenants, tenants.a, csv_bytes([good_row(price=value)]), mode="validate"
        )
        assert summary(response)["rejected"] == 1, value


async def test_unknown_columns_are_ignored_and_listed(tenants: Tenants) -> None:
    data = csv_bytes(
        [{**good_row(), "notes": "=HYPERLINK(1)", "supplier": "x"}],
        columns=[*COLUMNS, "notes", "supplier"],
    )
    response = await upload(tenants, tenants.a, data, mode="validate")
    assert summary(response)["valid"] == 1
    assert response.json()["ignored_columns"] == ["notes", "supplier"]


async def test_a_long_error_list_is_cut_and_says_so(tenants: Tenants) -> None:
    rows = [good_row(sku=f"S{i}", variant_sku=f"V{i}", price="x", title="") for i in range(300)]
    response = await upload(tenants, tenants.a, csv_bytes(rows), mode="validate")
    body = response.json()
    assert len(body["errors"]) == 500 and body["errors_truncated"] is True
    assert body["summary"]["rows_with_errors"] == 300  # counted over all errors, not the 500 shown
    assert body["summary"]["rejected"] == 300


# --- Access and limits -------------------------------------------------------------------


async def test_the_import_needs_a_vendor_token(tenants: Tenants) -> None:
    data = csv_bytes([good_row()])
    anonymous = await tenants.api.http.post(URL, content=data, headers={"Content-Type": CSV})
    assert anonymous.status_code == 401
    admin = await upload(tenants, tenants.a, data, token=tenants.admin_token)
    assert admin.status_code == 401


async def test_a_staff_member_can_import_too(tenants: Tenants) -> None:
    response = await upload(
        tenants, tenants.a, csv_bytes([good_row()]), token=tenants.a.staff_token
    )
    assert summary(response)["created"] == 1


async def test_imports_are_limited_per_vendor(
    tenants: Tenants, override: Callable[..., Settings]
) -> None:
    tenants.api.app.state.settings = override(
        tenants.api.app.state.settings, rate_limit_bulk_import_vendor="2/60"
    )
    data = csv_bytes([good_row()])
    assert (await upload(tenants, tenants.a, data, mode="validate")).status_code == 200
    assert (await upload(tenants, tenants.a, data, mode="validate")).status_code == 200
    limited = await upload(tenants, tenants.a, data, mode="validate")
    assert limited.status_code == 429
    assert "retry-after" in limited.headers
    assert (await upload(tenants, tenants.b, data, mode="validate")).status_code == 200
