import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from shazlo_security.rate_limit import RateLimited, RateLimiterUnavailable
from starlette.exceptions import HTTPException as StarletteHTTPException

from identity_api.core.middleware import REQUEST_ID_HEADER

logger = logging.getLogger("identity_api.errors")


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: Any = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Every error leaves the API as {"error": {code, message, request_id, details?}}."""
    request_id = getattr(request.state, "request_id", None)
    body: dict[str, Any] = {"code": code, "message": message, "request_id": request_id}
    if details is not None:
        body["details"] = jsonable_encoder(details)
    response = JSONResponse({"error": body}, status_code=status_code, headers=headers)
    if request_id:
        # Unhandled errors are answered outside the request-ID middleware, so set the header here.
        response.headers[REQUEST_ID_HEADER] = request_id
    return response


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str | None = None
    details: Any = None


class ErrorResponse(BaseModel):
    """The body of every error response."""

    error: ErrorBody


# What each error code means to a client, for the OpenAPI document. A code is described once, so
# two endpoints that can answer it never describe it differently.
ERROR_CODES: dict[str, str] = {
    "invalid_credentials": "The email or the password is wrong, or the admin is deactivated.",
    "invalid_refresh_token": "The refresh cookie is missing, expired or already revoked.",
    "refresh_conflict": (
        "Another request (usually another tab) used the same refresh cookie a moment ago. "
        "Nothing is revoked: retry, and the browser sends the cookie that request set."
    ),
    "origin_not_allowed": "The Origin of the request is not one of CORS_ALLOWED_ORIGINS.",
    "invalid_current_password": "The current password is wrong.",
    "weak_password": "The password breaks the password policy.",
    "unauthorized": "The access token is missing, invalid, expired, or its admin is deactivated.",
    "password_change_required": "The admin must change the initial password first.",
    "forbidden": "The admin's roles do not allow this.",
    "unknown_audience": "No module backend is registered under this audience.",
    "audience_not_allowed": "None of the admin's roles allows a token for this audience.",
    "audience_not_exchangeable": "identity-api tokens come from login and refresh only.",
    "email_taken": "An admin with this email already exists.",
    "unknown_role": "A role in the request does not exist.",
    "admin_not_found": "No admin has this id.",
    "cannot_deactivate_self": "An admin cannot deactivate their own account.",
    "last_super_admin": "This would leave no active super_admin.",
    "validation_error": "The request does not match the schema; `details` lists the problems.",
    "rate_limited": "Too many requests; wait `Retry-After` seconds.",
    "rate_limiter_unavailable": "The rate limiter (Redis) is down and this endpoint fails closed.",
}


def error_responses(*codes_by_status: tuple[int, tuple[str, ...]]) -> dict[int | str, Any]:
    """The `responses=` of a route: one entry per status, naming the error codes it can carry.

    `error_responses((401, ("invalid_credentials",)), (422, ("validation_error",)))`
    """
    documented: dict[int | str, Any] = {}
    for status, codes in codes_by_status:
        lines = [f"`{code}`: {ERROR_CODES[code]}" for code in codes]
        documented[status] = {"model": ErrorResponse, "description": "\n\n".join(lines)}
    return documented


class ApiError(Exception):
    """An expected failure with its own error code, e.g. `invalid_credentials`."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(request, exc.status_code, exc.code, exc.message, headers=exc.headers)

    @app.exception_handler(RateLimited)
    async def rate_limited(request: Request, exc: RateLimited) -> JSONResponse:
        return error_response(
            request,
            429,
            "rate_limited",
            "Too many requests. Try again later.",
            headers={"Retry-After": str(exc.retry_after), "Cache-Control": "no-store"},
        )

    @app.exception_handler(RateLimiterUnavailable)
    async def rate_limiter_unavailable(
        request: Request, exc: RateLimiterUnavailable
    ) -> JSONResponse:
        return error_response(
            request, 503, "rate_limiter_unavailable", "Service temporarily unavailable"
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        phrase = HTTPStatus(exc.status_code).phrase
        code = phrase.lower().replace(" ", "_")
        message = exc.detail if isinstance(exc.detail, str) else phrase
        return error_response(
            request,
            exc.status_code,
            code,
            message,
            headers=dict(exc.headers) if exc.headers else None,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            request, 422, "validation_error", "Request validation failed", details=exc.errors()
        )

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled exception", exc_info=exc)
        return error_response(request, 500, "internal_error", "Internal server error")
