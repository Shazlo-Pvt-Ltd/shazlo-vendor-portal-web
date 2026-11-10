"""The stub central app: the receiver side of ADR 0003, for local development and tests.

It implements `POST /internal/v1/events` and `GET /internal/v1/versions` from the contract's
OpenAPI file, in memory. It is not a model of the real central app (no database, no auth beyond
the HMAC), and its `/_stub/*` endpoints have no authentication: bind it to localhost only.
"""

import asyncio
import html
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from shazlo_security.signing import RequestVerifier, SignatureError

from central_stub.contract import Contract
from central_stub.settings import MAX_BODY_BYTES, MODES, Settings
from central_stub.store import Store

PREFIX = "/internal/v1"
MAX_PAGE = 500


def error(status: int, message: str, code: str, **extra: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"message": message, "extra": {"code": code, **extra}}
    )


def create_app(settings: Settings | None = None, clock: Callable[[], float] = time.time) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="Shazlo central-app stub", docs_url="/docs", redoc_url=None)
    store = Store()
    contract = Contract(settings.contract_dir)
    verifier = RequestVerifier(settings.keys(), clock)
    # The misbehaviour switch: `remaining` answers are bad, then it goes back to `ok` (None: stays).
    behaviour: dict[str, Any] = {"mode": settings.stub_mode, "remaining": None}
    app.state.store = store
    app.state.behaviour = behaviour

    def misbehave() -> Response | None:
        mode = behaviour["mode"]
        if mode == "ok":
            return None
        remaining = behaviour["remaining"]
        if remaining is not None:
            behaviour["remaining"] = remaining - 1
            if behaviour["remaining"] <= 0:
                behaviour["mode"], behaviour["remaining"] = "ok", None
        if mode == "error_500":
            return error(500, "The stub was asked to fail", "stub_error")
        if mode == "unauthorized":
            return error(401, "The stub was asked to refuse the signature", "bad_signature")
        if mode == "rate_limited":
            response = error(429, "The stub was asked to rate limit", "rate_limited")
            response.headers["Retry-After"] = str(settings.stub_retry_after_seconds)
            return response
        return None  # `timeout` is handled by the caller (it has to await)

    async def guard(request: Request) -> tuple[Response | None, bytes]:
        """Misbehaviour, the size limit and the signature: everything before the body is parsed."""
        if behaviour["mode"] == "timeout":
            await asyncio.sleep(settings.stub_timeout_seconds)
        bad = misbehave()
        if bad is not None:
            return bad, b""
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            return error(413, "The body is larger than 256 KB", "payload_too_large"), b""
        raw = await request.body()
        if len(raw) > MAX_BODY_BYTES:
            return error(413, "The body is larger than 256 KB", "payload_too_large"), b""
        try:
            verifier.verify(request.headers, raw)
        except SignatureError as exc:
            return error(401, str(exc), exc.code), b""
        return None, raw

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(f"{PREFIX}/events")
    async def ingest(request: Request) -> Response:
        bad, raw = await guard(request)
        if bad is not None:
            return bad
        try:
            event = json.loads(raw)
        except ValueError:
            return error(422, "The body is not valid JSON", "schema_invalid")
        problems = contract.errors(event)
        if problems:
            return error(
                422, "The event does not match its schema", "schema_invalid", fields=problems
            )
        event_id: str = event["event_id"]
        if request.headers.get("idempotency-key") != event_id:
            return error(422, "Idempotency-Key must equal the event_id", "idempotency_key_mismatch")
        if store.conflicts(event_id, raw):
            return error(
                409, "This event_id arrived before with a different body", "event_id_conflict"
            )
        if store.is_duplicate(event_id):
            return JSONResponse({"event_id": event_id, "status": "duplicate"})
        received_at = datetime.fromtimestamp(clock(), UTC).isoformat(timespec="seconds")
        return JSONResponse({"event_id": event_id, "status": store.apply(event, raw, received_at)})

    @app.get(f"{PREFIX}/versions")
    async def versions(request: Request) -> Response:
        bad, _ = await guard(request)
        if bad is not None:
            return bad
        aggregate_type = request.query_params.get("aggregate_type")
        if aggregate_type not in {"brand_profile", "product", "vendor"}:
            return error(
                422, "aggregate_type is brand_profile, product or vendor", "schema_invalid"
            )
        limit_text = request.query_params.get("limit", "200")
        if not limit_text.isdigit() or not 1 <= int(limit_text) <= MAX_PAGE:
            return error(422, f"limit is 1 to {MAX_PAGE}", "schema_invalid")
        page, next_cursor = store.versions(
            aggregate_type, request.query_params.get("cursor"), int(limit_text)
        )
        items = [
            {"aggregate_id": h.aggregate_id, "version": h.version, "state": h.state} for h in page
        ]
        return JSONResponse({"items": items, "next_cursor": next_cursor})

    # --- helpers for a developer; no authentication, localhost only -----------------------

    @app.get("/_stub/state")
    async def state() -> dict[str, Any]:
        return {
            "behaviour": behaviour,
            "events_received": store.received,
            "held": [vars(h) for h in store.held.values()],
        }

    @app.put("/_stub/mode")
    async def set_mode(request: Request) -> Response:
        """`{"mode": "error_500", "remaining": 3}`: the next 3 answers fail, then back to ok."""
        try:
            body = await request.json()
            mode, remaining = body["mode"], body.get("remaining")
        except (ValueError, KeyError, TypeError):
            return error(422, "Send {mode, remaining?}", "schema_invalid")
        valid_remaining = remaining is None or (
            isinstance(remaining, int) and not isinstance(remaining, bool) and remaining >= 1
        )
        if mode not in MODES or not valid_remaining:
            return error(422, f"mode is one of {', '.join(sorted(MODES))}", "schema_invalid")
        behaviour["mode"], behaviour["remaining"] = mode, remaining
        return JSONResponse(behaviour)

    @app.post("/_stub/reset")
    async def reset() -> dict[str, str]:
        store.reset()
        behaviour["mode"], behaviour["remaining"] = settings.stub_mode, None
        return {"status": "reset"}

    @app.get("/", response_class=HTMLResponse)
    async def page() -> str:
        sections = []
        for kind, title in (
            ("brand_profile", "Brand pages"),
            ("product", "Products"),
            ("vendor", "Vendors"),
        ):
            rows = sorted(
                (h for h in store.held.values() if h.aggregate_type == kind),
                key=lambda h: h.received_at,
                reverse=True,
            )
            body = (
                "".join(
                    f"<tr><td>{html.escape(h.aggregate_id)}</td><td>v{h.version}</td>"
                    f"<td>{html.escape(h.state)}</td><td>{html.escape(h.received_at)}</td>"
                    f"<td><code>{html.escape(json.dumps(h.data))}</code></td></tr>"
                    for h in rows
                )
                or '<tr><td colspan="5">Nothing yet</td></tr>'
            )
            sections.append(
                f"<h2>{title} ({len(rows)})</h2><table><tr><th>id</th><th>version</th>"
                f"<th>state</th><th>received</th><th>latest payload</th></tr>{body}</table>"
            )
        return (
            "<!doctype html><meta charset=utf-8><title>Central stub</title>"
            "<style>body{font:14px system-ui;margin:2rem}td,th{padding:.25rem .75rem;"
            "border-bottom:1px solid #ccc;text-align:left;vertical-align:top}"
            "code{font-size:12px;word-break:break-all}</style>"
            f"<h1>Central app stub</h1><p>Mode: <b>{html.escape(str(behaviour['mode']))}</b>. "
            f"{store.received} events received. <a href='/_stub/state'>JSON</a></p>"
            + "".join(sections)
        )

    return app
