"""The OpenAPI documents of vendor-api's two apps (ADR 0011), generated from the apps, so each
front end has a stable source for its typed client:

- `openapi.json`: the seller app, read by the Vendor Portal (`apps/vendor-portal`);
- `openapi.admin.json`: the admin app, read by Shazlo One's Vendors module (`apps/vendor-admin`).

Both are committed, and a test (and `python -m vendor_api.cli export-openapi --check`) fails when
either is stale.
"""

import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from shazlo_security.keys import generate_private_key, private_key_pem

from vendor_api.admin_app import create_admin_app
from vendor_api.app import create_seller_app
from vendor_api.core.settings import Settings

Surface = Literal["seller", "admin"]
SURFACES: tuple[Surface, ...] = ("seller", "admin")

SERVICE_DIR = Path(__file__).resolve().parents[1]
OPENAPI_PATHS: dict[Surface, Path] = {
    "seller": SERVICE_DIR / "openapi.json",
    "admin": SERVICE_DIR / "openapi.admin.json",
}
OPENAPI_PATH = OPENAPI_PATHS["seller"]


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        env="dev",
        database_url="postgresql+asyncpg://user:pw@localhost:5432/vendor",
        redis_url="redis://localhost:6379/0",
        # A throwaway key: the seller app needs one to start, and it is never in the document.
        jwt_keys=json.dumps({"openapi": private_key_pem(generate_private_key()).decode()}),
        # The admin app refuses to start without identity settings.
        identity_jwks_url="https://identity.example/.well-known/jwks.json",
        identity_issuer="https://identity.example",
    )


def _app(surface: Surface) -> FastAPI:
    if surface == "admin":
        return create_admin_app(_settings(), readiness_checks={})
    return create_seller_app(_settings(), readiness_checks={})


def build_openapi(surface: Surface = "seller") -> str:
    """The document as stable text: the same app always gives the same bytes."""
    document = _app(surface).openapi()
    return json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
