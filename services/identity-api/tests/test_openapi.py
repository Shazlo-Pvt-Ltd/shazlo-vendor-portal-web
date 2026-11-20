"""The committed `openapi.json` is what the app produces, and it documents what the shell uses.

The Shazlo-One shell generates its typed client from the file, so a stale file hides a breaking
change from the shell's CI.
"""

import json
from typing import Any

import pytest

from identity_api.cli import main
from identity_api.openapi import OPENAPI_PATH, build_openapi

# The error codes the shell handles (issue #248); each must be described in the document.
SHELL_ERROR_CODES = [
    "invalid_credentials",
    "refresh_conflict",
    "password_change_required",
    "audience_not_allowed",
    "unknown_audience",
    "email_taken",
    "weak_password",
    "unknown_role",
    "cannot_deactivate_self",
    "last_super_admin",
    "admin_not_found",
]
SHELL_OPERATIONS = [
    ("post", "/v1/auth/login"),
    ("post", "/v1/auth/refresh"),
    ("post", "/v1/auth/logout"),
    ("post", "/v1/auth/change-password"),
    ("post", "/v1/auth/token"),
    ("get", "/v1/me"),
    ("get", "/v1/roles"),
    ("get", "/v1/admins"),
    ("post", "/v1/admins"),
    ("get", "/v1/admins/{admin_id}"),
    ("patch", "/v1/admins/{admin_id}"),
    ("post", "/v1/admins/{admin_id}/reset-password"),
]


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    result: dict[str, Any] = json.loads(build_openapi())
    return result


def test_committed_file_is_current() -> None:
    committed = OPENAPI_PATH.read_bytes().decode("utf-8").replace("\r\n", "\n")
    assert committed == build_openapi(), (
        "services/identity-api/openapi.json is stale. Regenerate it with "
        "`python -m identity_api.cli export-openapi` (from services/identity-api) and commit it."
    )


def test_output_is_deterministic() -> None:
    assert build_openapi() == build_openapi()


def test_check_command_fails_on_a_stale_file(
    tmp_path: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    stale = tmp_path / "openapi.json"
    stale.write_text("{}\n", encoding="utf-8")
    assert main(["export-openapi", "--check", "--out", str(stale)]) == 1
    assert "export-openapi" in capsys.readouterr().err
    assert main(["export-openapi", "--out", str(stale)]) == 0
    assert main(["export-openapi", "--check", "--out", str(stale)]) == 0


@pytest.mark.parametrize(("method", "path"), SHELL_OPERATIONS)
def test_every_shell_operation_has_typed_bodies(
    document: dict[str, Any], method: str, path: str
) -> None:
    operation = document["paths"][path][method]
    success = [status for status in operation["responses"] if status.startswith("2")]
    assert success
    for status, response in operation["responses"].items():
        if status == "204":
            continue
        schema = response["content"]["application/json"]["schema"]
        assert schema, f"{method} {path} {status} has no body schema"
        # FastAPI's own validation error shape is not what the API sends.
        assert "HTTPValidationError" not in json.dumps(schema)


def test_error_codes_are_described(document: dict[str, Any]) -> None:
    text = json.dumps(document)
    for code in SHELL_ERROR_CODES:
        assert f"`{code}`" in text, f"{code} is not described in openapi.json"


def test_every_documented_code_is_a_known_code(document: dict[str, Any]) -> None:
    from identity_api.core.errors import ERROR_CODES

    # `error_responses` raises KeyError for a code that is not described; this guards the other
    # direction: a described code no endpoint documents is dead text.
    text = json.dumps(document)
    for code in ERROR_CODES:
        assert f"`{code}`" in text, f"{code} is described but no endpoint lists it"
