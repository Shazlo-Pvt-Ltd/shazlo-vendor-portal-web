"""`uvicorn central_stub.main:app`: the stub with its settings from the environment."""

from central_stub.app import create_app

app = create_app()
