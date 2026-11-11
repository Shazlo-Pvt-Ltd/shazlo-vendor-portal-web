import json
from typing import Any

from fastapi.testclient import TestClient
from shazlo_security.signing import RequestSigner, SigningKey

from central_stub.settings import DEFAULT_CONTRACT_DIR

NOW = 1792750800
SECRET = b"shazlo-contract-test-secret-not-for-production"
OTHER_SECRET = b"a-second-secret-for-a-rotation-0123456789"
EXAMPLES = DEFAULT_CONTRACT_DIR / "examples"


class Sender:
    """Signs and sends like vendor-api will. `now` moves the signer's clock, not the stub's."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.now = NOW
        self.key = SigningKey("k1", SECRET)

    def headers(self, body: bytes, key: SigningKey | None = None) -> dict[str, str]:
        return RequestSigner(key or self.key, lambda: self.now).headers(body)

    def post(
        self,
        event: dict[str, Any] | bytes,
        *,
        key: SigningKey | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        if isinstance(event, bytes):
            body = event
        else:
            body = json.dumps(event, separators=(",", ":")).encode()
        event_id = event.get("event_id", "") if isinstance(event, dict) else ""
        headers = {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key or str(event_id),
            **self.headers(body, key),
        }
        return self.client.post("/internal/v1/events", content=body, headers=headers)

    def versions(self, **params: str) -> Any:
        return self.client.get("/internal/v1/versions", params=params, headers=self.headers(b""))
