"""The OpenAPI document of identity-api, generated from the app, so the Shazlo-One shell's typed
client has a stable source. `openapi.json` in the service directory is committed and a test (and
`python -m identity_api.cli export-openapi --check`) fails when it is stale."""

import json
from pathlib import Path

from shazlo_security.keys import generate_private_key, private_key_pem

from identity_api.app import create_app
from identity_api.core.settings import Settings

OPENAPI_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


def build_openapi() -> str:
    """The document as stable text: the same app always gives the same bytes."""
    settings = Settings(
        _env_file=None,
        env="dev",
        database_url="postgresql+asyncpg://user:pw@localhost:5432/identity",
        redis_url="redis://localhost:6379/0",
        # A throwaway key: the app needs one to start, and it is never part of the document.
        jwt_keys=json.dumps({"openapi": private_key_pem(generate_private_key()).decode()}),
        jwt_signing_kid="openapi",
    )
    app = create_app(settings, readiness_checks={})
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
