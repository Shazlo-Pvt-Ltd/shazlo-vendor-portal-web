"""The downloadable sample files for the bulk product import (CSV and Excel).

The examples are valid, so a vendor can upload the untouched template to see how the report
looks (use `mode=validate`: nothing is written). The Excel file has a second sheet with the
instructions; the importer only reads the first sheet.
"""

import csv
import io

from openpyxl import Workbook
from openpyxl.styles import Font

from vendor_api.services.product_import import COLUMNS

EXAMPLES: list[list[object]] = [
    [
        "KURTA-001",
        "Block-print cotton kurta",
        "Hand block printed on soft cotton.",
        "kurtas",
        "",
        "women",
        "cotton",
        350,
        "yes",
        7,
        "KURTA-001-M",
        "M",
        "Indigo",
        1499,
        1999,
        "yes",
    ],
    [
        "KURTA-001",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "KURTA-001-L",
        "L",
        "Indigo",
        1499,
        1999,
        "yes",
    ],
    [
        "SCARF-014",
        "Silk scarf",
        "",
        "accessories",
        "scarves",
        "unisex",
        "silk",
        "",
        "no",
        "",
        "SCARF-014-OS",
        "",
        "Red",
        899.5,
        1199,
        "yes",
    ],
]

INSTRUCTIONS = [
    "One row is one variant (a size and colour). Rows with the same sku are one product.",
    "Write the product's details (title, category, ...) on its first row. On its other rows, "
    "repeat them or leave them blank.",
    "Required: sku, title, category, gender (women, men or unisex), variant_sku and price.",
    "Prices are in rupees, for example 1499 or 899.50. No currency symbols or commas. "
    "mrp is the printed price; leave it blank to use the price.",
    "returnable and is_active take yes or no. A returnable product needs return_window_days "
    "(0 to 30).",
    "A SKU is unique across your products, ignoring capitals. A variant_sku is unique across "
    "all your variants.",
    "Text may not start with = + - or @ (a spreadsheet would run it as a formula). "
    "Do not use formulas: paste values.",
    "Images cannot be imported. Products are created as drafts: add images in the portal, "
    "then submit them for review.",
    "Uploading the same file again changes nothing: a product that already exists with the same "
    "details is reported as unchanged. An import never changes an existing product.",
    "Columns the importer does not know are ignored.",
]


def csv_template() -> bytes:
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(COLUMNS)
    writer.writerows(EXAMPLES)
    # A byte order mark makes Excel open the file as UTF-8; the importer reads it either way.
    return b"\xef\xbb\xbf" + out.getvalue().encode("utf-8")


def xlsx_template() -> bytes:
    workbook = Workbook()
    products = workbook.active
    if products is None:  # a new workbook always has its first sheet
        products = workbook.create_sheet()
    products.title = "Products"
    products.append(list(COLUMNS))
    for row in EXAMPLES:
        products.append(row)
    for cell in products[1]:
        cell.font = Font(bold=True)
    for cell in products[1]:
        products.column_dimensions[cell.column_letter].width = max(14, len(str(cell.value)) + 4)
    notes = workbook.create_sheet("Instructions")
    notes.column_dimensions["A"].width = 110
    for line in INSTRUCTIONS:
        notes.append([line])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()
