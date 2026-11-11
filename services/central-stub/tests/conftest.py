import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from support import EXAMPLES, NOW, OTHER_SECRET, SECRET, Sender

from central_stub.app import create_app
from central_stub.settings import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        stub_signing_keys=f"k1:{SECRET.decode()},k2:{OTHER_SECRET.decode()}",
        stub_timeout_seconds=0.05,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings, lambda: NOW))


@pytest.fixture
def sender(client: TestClient) -> Sender:
    return Sender(client)


@pytest.fixture
def example() -> Callable[[str], dict[str, Any]]:
    def load(name: str) -> dict[str, Any]:
        text = Path(EXAMPLES / f"{name}.json").read_text(encoding="utf-8")
        event: dict[str, Any] = json.loads(text)
        return event

    return load
