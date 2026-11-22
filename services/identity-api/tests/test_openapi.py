"""The committed `openapi.json` is what the app produces, and it documents what the shell uses.

The Shazlo-One shell generates its typed client from the file, so a stale file hides a breaking
change from the shell's CI.
"""

import json
import re
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

# The error codes each shell operation can answer, by status. The shell branches on them, so a
# code that disappears from an endpoint or moves to another one must fail here, not in the shell.
SIGNED_IN = {"401": {"unauthorized"}, "403": {"password_change_required"}}
ADMIN_ONLY = {"401": {"unauthorized"}, "403": {"password_change_required", "forbidden"}}
DOCUMENTED_ERRORS: dict[tuple[str, str], dict[str, set[str]]] = {
    ("post", "/v1/auth/login"): {
        "401": {"invalid_credentials"},
        "422": {"validation_error"},
        "429": {"rate_limited"},
        "503": {"rate_limiter_unavailable"},
    },
    ("post", "/v1/auth/refresh"): {
        "401": {"invalid_refresh_token"},
        "403": {"origin_not_allowed"},
        "409": {"refresh_conflict"},
        "422": {"validation_error"},
        "429": {"rate_limited"},
    },
    ("post", "/v1/auth/logout"): {"403": {"origin_not_allowed"}, "422": {"validation_error"}},
    ("post", "/v1/auth/change-password"): {
        "400": {"invalid_current_password"},
        # invalid_credentials: a concurrent password change or deactivation won the race.
        "401": {"unauthorized", "invalid_credentials"},
        "422": {"weak_password", "validation_error"},
        "429": {"rate_limited"},
        "503": {"rate_limiter_unavailable"},
    },
    ("post", "/v1/auth/token"): {
        "400": {"unknown_audience", "audience_not_exchangeable"},
        "401": {"unauthorized"},
        "403": {"password_change_required", "audience_not_allowed"},
        "422": {"validation_error"},
        "429": {"rate_limited"},
    },
    ("get", "/v1/me"): SIGNED_IN,
    ("get", "/v1/roles"): ADMIN_ONLY,
    ("get", "/v1/admins"): {**ADMIN_ONLY, "422": {"validation_error"}},
    ("post", "/v1/admins"): {
        **ADMIN_ONLY,
        "409": {"email_taken"},
        "422": {"weak_password", "unknown_role", "validation_error"},
    },
    ("get", "/v1/admins/{admin_id}"): {
        **ADMIN_ONLY,
        "404": {"admin_not_found"},
        "422": {"validation_error"},
    },
    ("patch", "/v1/admins/{admin_id}"): {
        **ADMIN_ONLY,
        "404": {"admin_not_found"},
        "409": {"cannot_deactivate_self", "last_super_admin"},
        "422": {"unknown_role", "validation_error"},
    },
    ("post", "/v1/admins/{admin_id}/reset-password"): {
        **ADMIN_ONLY,
        "404": {"admin_not_found"},
        "422": {"weak_password", "validation_error"},
    },
}


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


def test_the_table_covers_every_shell_operation() -> None:
    assert set(DOCUMENTED_ERRORS) == set(SHELL_OPERATIONS)


@pytest.mark.parametrize(("method", "path"), SHELL_OPERATIONS)
def test_each_operation_documents_exactly_its_error_codes(
    document: dict[str, Any], method: str, path: str
) -> None:
    responses = document["paths"][path][method]["responses"]
    documented = {
        status: set(re.findall(r"^`([a-z_]+)`:", response["description"], re.MULTILINE))
        for status, response in responses.items()
        if status[0] in "45"
    }
    assert documented == DOCUMENTED_ERRORS[(method, path)]


def test_error_codes_are_described(document: dict[str, Any]) -> None:
    text = json.dumps(document)
    for code in SHELL_ERROR_CODES:
        assert f"`{code}`" in text, f"{code} is not described in openapi.json"


def test_every_known_code_is_documented(document: dict[str, Any]) -> None:
    from identity_api.core.errors import ERROR_CODES

    # `error_responses` raises KeyError for a code that is not described; this guards the other
    # direction: a described code no endpoint documents is dead text.
    text = json.dumps(document)
    for code in ERROR_CODES:
        assert f"`{code}`" in text, f"{code} is described but no endpoint lists it"
