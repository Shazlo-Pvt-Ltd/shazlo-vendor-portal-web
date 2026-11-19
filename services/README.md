# services

FastAPI services. Each has its own `pyproject.toml`, package and `tests/`.

| Service | Port | What it is |
|---|---|---|
| [`identity-api/`](identity-api/README.md) | 8001 | Shazlo-One admin users, roles, RS256 tokens and JWKS |
| [`vendor-api/`](vendor-api/README.md) | 8002 | Vendors, catalog, review and publishing to the central app; also the `vendor_api.worker` process (compose: `vendor-worker`) |
| [`central-stub/`](central-stub/README.md) | 8003 | A stand-in for the central app's ingest API, for local development and tests. Never deployed |

## Tooling (enforced by CI)

| Tool | Config | Command (run inside a service dir) |
|---|---|---|
| ruff lint | `services/ruff.toml` (shared, extended by each service) | `ruff check .` |
| ruff format | same | `ruff format --check .` |
| mypy (strict) | `[tool.mypy]` in the service's `pyproject.toml` | `mypy` |
| pytest | `[tool.pytest.ini_options]` in the service's `pyproject.toml` | `pytest` |

Setup: `python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'`. A service that uses `packages/py-auth` or `packages/py-security` lists it in `requirements-shared.txt` (never in its pyproject dependencies, so it is never looked up on PyPI) and installs that first: `pip install -r requirements-shared.txt`.

Tests that need Postgres use the `*_test` databases created by the root `docker-compose.yml` and read the URL from `DATABASE_URL` (CI sets it to a Postgres service container). The end-to-end tests also need Redis, on a database other than 0 (`REDIS_URL=redis://localhost:6379/1`), because they empty it. `central-stub` needs neither.
