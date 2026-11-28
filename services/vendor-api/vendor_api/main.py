"""The seller app, for uvicorn: `uvicorn vendor_api.main:app --port 8002` (ADR 0011)."""

from vendor_api.app import create_seller_app

app = create_seller_app()
