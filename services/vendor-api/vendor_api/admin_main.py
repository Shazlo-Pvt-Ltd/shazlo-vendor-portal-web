"""The admin app, for uvicorn: `uvicorn vendor_api.admin_main:app --port 8004` (ADR 0011)."""

from vendor_api.admin_app import create_admin_app

app = create_admin_app()
