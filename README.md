# Shazlo

Shazlo is being split into microservices that feed a central consumer application (separate repo). This repo holds:

- **Vendor Portal**: vendors sign up, personalise their brand page and list products. Submissions stay *pending* until an admin reviews them.
- **Shazlo-One**: one admin shell that hosts every microservice's admin UI in an iframe. Admins approve or reject vendor submissions; only approved content is published to the central app.

Plan, phases and decisions: [docs/ROADMAP.md](docs/ROADMAP.md). Architecture decisions: [docs/adr](docs/adr).

## Architecture

```
 VENDOR PORTAL (sellers)
 Vendor ──► vendor-portal ──► vendor-api seller app (:8002) ────────────────────┐
 SHAZLO ONE (admins)                                                            ├──► vendor Postgres
 Admin ──► shazlo-one ─iframe─► vendor-admin ──► vendor-api admin app (:8004) ──┘
              │       (JWT via postMessage; the admin app checks it against identity-api's JWKS)
              └──► identity-api

         outbox ──► vendor-worker ──► central app (HMAC-signed push)
```

The Vendor Portal and Shazlo One's Vendors module are two microservices over one vendor database: `vendor-api` runs as a seller app and an admin app from one package ([ADR 0011](docs/adr/0011-vendor-portal-and-vendors-module-as-microservices.md)). Either keeps working while the other is down. `vendor-api` writes an event to its outbox in the same transaction as each approval, and `vendor-worker` (the same image, `python -m vendor_api.worker`) sends it to the central app. `central-stub` stands in for the central app locally. The web apps shown here are built phase by phase: see the [roadmap](docs/ROADMAP.md) for what exists.

## Repo layout

| Path | What it is |
|---|---|
| `services/identity-api/` | FastAPI: admin users, roles, JWT (RS256) + JWKS |
| `services/vendor-api/` | FastAPI: vendors, brand profiles, products, assets, reviews, and the outbox and worker that publish approved content to the central app |
| `services/central-stub/` | FastAPI: a stand-in for the central app's ingest API (ADR 0003), for local development and tests. Never deployed |
| `apps/vendor-portal/` | React + TS: vendor-facing app |
| `apps/shazlo-one/` | React + TS: admin shell (login, nav, iframe host) |
| `apps/vendor-admin/` | React + TS: vendor review module, loaded in a Shazlo-One iframe |
| `packages/ui/` | Shared MUI theme and tokens |
| `packages/shell-protocol/` | The postMessage protocol between Shazlo-One and its framed modules: types, validators, both ends of the channel |
| `packages/py-auth/` | Shared Python package: access-token verifier, JWKS client, FastAPI `require_role` |
| `packages/py-security/` | Shared Python package: password hashing, rate limiter, client IP, refresh-token store, signing keys and token issuer, request signing (ADR 0010, ADR 0003) |
| `docs/` | [Roadmap](docs/ROADMAP.md), design documents, [ADRs](docs/adr), [runbooks](docs/runbooks), [test strategy](docs/testing.md) |
| `docker-compose.yml`, `docker/` | Local Postgres, Redis, Mailpit and the services (see below); `docker/postgres/init` creates the databases |
| `test/contracts/` | JavaScript contract tests for the ADR 0003 schemas, the shared-package install files and the secret-file ignore rules |
| `app/`, `backend/` | **Legacy** consumer landing/waitlist, Express + MongoDB. Untouched until Phase 8, apart from security fixes |

The three Python services and the two Python packages are built. Of the web apps, `apps/vendor-admin/` is a placeholder until its phase starts, `apps/shazlo-one/` is scaffolded (Phase 6: it serves an empty shell with its settings check, typed API client and security headers), and `apps/vendor-portal/` is being built (Phase 5: sign-in, the dashboard, the brand page editor, the products list, the product form, the bulk import, the team and account pages and submission status are merged); see the roadmap and the app's README.

## Local development

Postgres 16, Redis 7 and Mailpit (a local email catcher) run in docker-compose:

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD
docker compose up -d
docker compose ps           # postgres, redis and mailpit should report "healthy"
```

| Service | Port | Check |
| --- | --- | --- |
| Postgres | 5432 | `docker compose ps` shows "healthy" |
| Redis | 6379 (127.0.0.1 only) | `docker compose exec redis redis-cli ping` prints `PONG` |
| identity-api (profile `identity`) | 8001 | `curl localhost:8001/ready` |
| vendor-api, the seller app (profile `vendor`) | 8002 | `curl localhost:8002/ready` |
| vendor-admin-api, the admin app (profile `vendor`) | 8004 | `curl localhost:8004/ready` |
| vendor-worker (profile `vendor`) | none | `docker compose --profile vendor logs vendor-worker` |
| central-stub (profile `central`) | 8003 (127.0.0.1 only) | `curl localhost:8003/health`, or open <http://localhost:8003> |
| Mailpit SMTP / web UI | 1025 / 8025 (127.0.0.1 only) | open <http://localhost:8025> |

Mailpit shows every email the services send (signup, invite and reset links) and delivers none of them. vendor-api in compose sends to it; from the host, `python -m vendor_api.cli send-test-email` (in `services/vendor-api`) puts an example there. From another container the SMTP server is `mailpit:1025`; from the host it is `localhost:1025`. Ports are set in `.env`.

On first start it creates one database per service plus a test database for each: `identity`, `identity_test`, `vendor`, `vendor_test`. Connection string pattern: `postgresql://<user>:<password>@localhost:5432/<db>`.

Redis holds the refresh tokens (sessions) and rate-limit counters of both APIs. In compose, identity-api uses database 0 and vendor-api database 1, and their keys start with different prefixes (`identity:`, `vendor:`). It runs with AOF persistence (`appendfsync everysec`) and a named volume, so a restart or redeploy does not sign admins or vendors out. Locally it is published on `127.0.0.1` only and has no password. In production use a managed Redis, or one with persistence enabled, with a password and no public port.

The init script runs only when the data volume is created. To recreate the databases: `docker compose down -v && docker compose up -d` (this deletes all local data).

identity-api can also run in a container, behind the `identity` profile. To work on its code, run it on the host instead ([its README](services/identity-api/README.md)). The container needs a signing key in `.env`; make one with the image itself and copy the printed `IDENTITY_JWT_KEYS=...` line over the empty one in `.env`:

```bash
docker compose --profile identity build identity-api
docker compose --profile identity run --rm --no-deps -T identity-api python -c "import json; from shazlo_security.keys import generate_private_key, new_kid, private_key_pem; print('IDENTITY_JWT_KEYS=' + json.dumps({new_kid(): private_key_pem(generate_private_key()).decode()}, separators=(',', ':')))"
```

Then create the schema, seed the first admin and start it:

```bash
docker compose --profile identity run --rm identity-api alembic upgrade head
docker compose --profile identity run --rm -e SEED_ADMIN_EMAIL=admin@shazlo.test -e SEED_ADMIN_PASSWORD='<at least 12 characters>' identity-api python -m identity_api.cli seed
docker compose --profile identity up -d --wait
curl localhost:8001/ready   # {"status":"ok", ...}
```

The key is a local development key: keep it out of git (`.env` is ignored) and never reuse it elsewhere.

vendor-api runs the same way behind the `vendor` profile. It signs its own tokens, so it needs its **own** signing key (never identity-api's) in `.env`. Make it with the image, and copy the printed `VENDOR_JWT_KEYS=...` line over the empty one:

```bash
docker compose --profile vendor build vendor-api
docker compose --profile vendor run --rm --no-deps -T vendor-api python -c "import json; from shazlo_security.keys import generate_private_key, new_kid, private_key_pem; print('VENDOR_JWT_KEYS=' + json.dumps({new_kid(): private_key_pem(generate_private_key()).decode()}, separators=(',', ':')))"
```

It uses the `vendor` database and Redis database 1 (identity-api uses 0):

```bash
docker compose run --rm vendor-cli                                         # alembic upgrade head, as the owner
docker compose run --rm vendor-cli python -m vendor_api.cli db-logins     # each app's own database login
docker compose --profile vendor up -d --wait
curl localhost:8002/ready   # {"status":"ok", ...}  the seller app
curl localhost:8004/ready   # the admin app (vendor-admin-api): /v1/admin/* for Shazlo One
curl localhost:8002/.well-known/jwks.json   # the public key
```

The `vendor` profile also starts `vendor-worker`, which sends vendor-api's outbox events to the central app. It stays idle (and says so in its log) until `CENTRAL_PUBLISHING_ENABLED=true` is set in `.env`. To see events arrive, uncomment that line and also start `central-stub` (profile `central`, a stand-in for the central app on port 8003, localhost only): `docker compose --profile vendor --profile central up -d`. The steps, and what to do when publishing goes wrong, are in [the publishing runbook](docs/runbooks/central-publishing.md).

To run everything, add both keys as above and use `--profile full` (it includes the `identity`, `vendor` and `central` profiles): `docker compose --profile full up -d --build --wait`. Run each service's `alembic upgrade head` first, with `run --rm` as above (`vendor-cli` for vendor-api, then its `db-logins`).

For the legacy apps, see `app/README.md` and `backend/README.md` and copy each `.env.example` to `.env`.

## Tests

Install all three lockfiles with `npm ci`, `npm ci --prefix app`, and
`npm ci --prefix backend`, then run `npm test` from the root. `npm run test:coverage`
includes runtime files that have no tests; `npm run lint`, `npm run typecheck`, and
`npm run build --prefix app` provide the other JavaScript checks.

The integration suite owns a disposable local MongoDB process and downloads its
binary on the first run. It never connects to the configured application database.
Python checks (ruff, mypy, pytest) run inside each service and package, with Postgres and Redis from
the compose file for the database tests; see the service READMEs and
[the test strategy](docs/testing.md) for the repository map, assertions, commands, limitations and CI
evidence.

The `apps-ci`, `services-ci` and CodeQL workflows run on every pull request and push to `main`.
`apps-ci` skips its web jobs for a pull request that only touches the Python services and packages,
`docker/`, `docs/` (except `docs/adr/0003-contract/`), the compose file, `.env.example` or the
workflow files of the other workflows; it also runs weekly. `services-ci` tests `identity-api`,
`vendor-api`, `central-stub`, `py-auth` and `py-security`, and its `compose` job follows the
local-development steps above against the real compose file. Test results and coverage are kept as
GitHub Actions artifacts for 14 days.

## Workflow

Each roadmap phase is a GitHub milestone. Each issue gets a branch named `phase-N/<issue#>-<slug>` and a PR with `Closes #N`.
