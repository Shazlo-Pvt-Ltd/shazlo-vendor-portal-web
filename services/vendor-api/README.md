# vendor-api

FastAPI service for vendors, brand profiles, products, assets, reviews and publishing to the central app. See the [roadmap](../../docs/ROADMAP.md) (Phases 2 to 4), [ADR 0009](../../docs/adr/0009-auth-model.md) for the auth model and [ADR 0010](../../docs/adr/0010-shared-security-package.md) for what it shares with identity-api.

Status: scaffold. The app factory, settings, logging, error handling, database layer and health endpoints are in place. The schema, vendor auth and the admin API come in the other Phase 2 issues.

## Run locally

You need Python 3.12+, and Postgres and Redis from the root docker-compose:

```sh
docker compose up -d postgres redis      # from the repository root
cd services/vendor-api
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env                     # put your POSTGRES_PASSWORD into DATABASE_URL
alembic upgrade head
uvicorn vendor_api.main:app --reload --port 8002
```

`curl localhost:8002/health` returns `{"status": "ok"}` and `curl localhost:8002/ready` checks Postgres and Redis. OpenAPI docs are at <http://localhost:8002/docs> unless `ENV=prod`.

The app refuses to start if `DATABASE_URL` or `REDIS_URL` is missing or malformed.

## Layout

```
vendor_api/
  app.py        create_app() factory (settings and readiness checks can be injected in tests)
  main.py       `app = create_app()` for uvicorn
  api/          routers (health now; auth, vendor and admin routers come with their issues)
  core/         settings, JSON logging, request-ID middleware, error handlers
  db/           models, declarative base (constraint naming convention), async engine and sessions
  migrations/   Alembic env and versions (runs on a sync psycopg engine)
  services/     business logic, free of HTTP concerns
```

The logging, request-ID middleware and error handlers are copies of identity-api's (ADR 0010). The security code (sessions, rate limits, passwords, keys) will come from `packages/py-security`, and token verification from `packages/py-auth`; each is added, with a `requirements-shared.txt`, by the first issue that imports it.

## Settings

Read from the environment (and `.env`). Names are the upper-case field names. Full list with comments in [`.env.example`](.env.example).

| Setting | Default | Notes |
|---|---|---|
| `DATABASE_URL` | none (required) | `postgresql://`, `postgresql+asyncpg://` or `postgresql+psycopg://` |
| `REDIS_URL` | none (required) | `redis://` or `rediss://` |
| `ENV` | `dev` | `dev`, `test` or `prod`; `prod` turns off `/docs` |
| `LOG_LEVEL` | `INFO` | |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5174` | comma separated; credentials allowed for these only; no wildcard |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` / `COOKIE_DOMAIN` | `true` / `strict` / unset | refresh-token cookie; `none` requires `COOKIE_SECURE=true` |
| `JWT_ISSUER` | `http://localhost:8002` | `iss` of the tokens vendor-api issues |

identity-api is on port 8001 and vendor-api on 8002, so both can run side by side. Their cookie names and Redis key prefixes differ (ADR 0010).

## Database

Async SQLAlchemy 2 with `asyncpg` for the app; Alembic runs on a sync engine (psycopg 3). Migration `0001` is an empty baseline so CI can run `alembic upgrade head` before any table exists.

```sh
alembic upgrade head
alembic downgrade base
alembic revision --autogenerate -m "<message>"   # then review the generated file
alembic check                                    # fails if models and migrations differ
```

## Behaviour worth knowing

- `GET /health` is liveness only. `GET /ready` checks Postgres and Redis (2 second timeout each) and returns 503 if either fails.
- Every response has an `X-Request-ID` header. A sane incoming value is reused; it is also in every log line.
- Logs are one JSON object per line on stdout.
- Errors always look like `{"error": {"code", "message", "request_id", "details"?}}`. Unhandled errors return a generic message; details go to the log only.

## Checks (run by CI)

```sh
ruff check . && ruff format --check . && mypy && pytest
```

Database tests run against real Postgres from `DATABASE_URL` and are skipped when it is unset (CI sets it). Locally, with the root docker-compose running:

```sh
DATABASE_URL=postgresql://shazlo:<password>@localhost:5432/vendor_test pytest
```

The suite drops and recreates the schema (`alembic downgrade base` then `upgrade head`) and refuses any database whose name is not `test` or `*_test`.

## Docker

```sh
docker build -f services/vendor-api/Dockerfile -t vendor-api .
```

Run it from the repository root (shared packages will be copied from there). The image runs as a non-root user on port 8002 and has a healthcheck on `/health`.
