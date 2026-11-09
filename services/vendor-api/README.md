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

identity-api is on port 8001 and vendor-api on 8002, so both can run side by side. In docker-compose (`--profile vendor`) vendor-api uses Redis database 1; see the root README, Local development. Their cookie names and Redis key prefixes differ (ADR 0010).

## Database

Async SQLAlchemy 2 with `asyncpg` for the app; Alembic runs on a sync engine (psycopg 3). Migration `0001` is an empty baseline; `0002` adds the vendor and vendor-user tables; `0003` adds assets and brand profiles; `0004` adds products.

| Table | Notes |
|---|---|
| `vendors` | A company. UUID `id`; `name`; `slug` (unique, `^[a-z0-9]+(-[a-z0-9]+)*$`); `email` (unique, stored trimmed and lower-cased, enforced by a check constraint); `phone`, `contact_name`, `product_type`, `website_or_instagram`; declared price range in **integer paise** (`price_min_paise` >= 0, `price_max_paise` >= min); `status` (`pending` by default, `approved`, `rejected`, `suspended`) with `status_reason`, `status_changed_at` and `status_changed_by` (an identity-api admin id, no foreign key: another database) |
| `vendor_status_events` | **Append-only** audit of every status change: vendor, `from_status` (NULL when the vendor is created), `to_status`, `actor_type` (`admin`, `system`, `vendor`), `actor_id` (required unless the actor is the system), `reason`. A trigger refuses UPDATE and DELETE, and a vendor with events cannot be deleted |
| `vendor_users` | A person who signs in for a vendor. `email` unique across all vendors (trimmed, lower-cased); `password_hash` is NULL until an invite is accepted (only `invited` or `disabled` users may lack one); `role` (`owner`, `staff`; **at most one owner per vendor**, by a partial unique index); `status` (`invited`, `active`, `disabled`); `email_verified_at`, `terms_accepted_at`, `last_login_at` |
| `auth_tokens` | One-time tokens for email verification, invites and password reset. `purpose` (`verify_email`, `invite`, `reset_password`), `token_hash` (unique, must be a 64-character lower-case hex SHA-256), `expires_at`, `used_at`. **The token itself is never stored.** Deleting the user deletes their tokens |
| `assets` | An uploaded image; the file lives at the provider (Cloudinary), this is its record. `kind` (`brand_logo`, `brand_banner`, `product_image`), `provider` (`cloudinary`), `public_id` (unique), `url` (**https only**), `format`, `bytes`, `width`, `height` (all required once `status` is `ready`), `status` (`pending`, `ready`, `deleted`), `created_by`. `(vendor_id, id)` is unique so other tables can reference an asset together with its vendor |
| `brand_profiles` | **One row per version** of a vendor's brand page (see below). Content with the published contract's limits (ADR 0003): `brand_name` (120), `tagline` (160), `about` (4000), `logo_asset_id`, `banner_asset_id`, `website_url` (https), `instagram_handle` (`^[A-Za-z0-9._]{1,30}$`), `categories`, price range in paise; plus `version`, `state`, `submitted_at`, `published_at`, `updated_by` |
| `products` | A product's identity and where it stands. `sku` (unique per vendor **ignoring letter case**, max 64; two vendors may share one; stays reserved when archived), `status` (`draft`, `pending_review`, `approved`, `rejected`, `archived`), `version` (never goes down), `live_revision_id` and `pending_revision_id` |
| `product_revisions` | One version of the content (see below): `title` (200), `description` (4000), `category`, `subcategory` (100), `gender` (`women`, `men`, `unisex`), `fabric` (80), `weight_grams` (> 0), `returnable`, `return_window_days` (0 to 30, required when returnable), `version` (per product, increasing, immutable), `submitted_at`, `created_by` |
| `product_variants` | A variant's stable identity: `sku` (unique per vendor ignoring case), `size`, `color` (`''` = none; `(product, size, color)` unique). Its `id` is the contract's `variant_id`. No stock: the central app owns it |
| `product_revision_variants` | What a revision says about a variant: `price_paise` (> 0), `mrp_paise` (>= price), `is_active` |
| `product_images` | An ordered image of a revision: `position` 1 to 10 (unique per revision, so at most 10), `alt_text` (200), `asset_id` |

Role, status and purpose values are plain text columns with check constraints, so adding a value is a migration of that constraint. Vendors and users are never deleted (foreign keys are `RESTRICT`): suspend or disable them instead.

### Brand profiles: draft and published versions

A vendor edits a brand page freely, but shoppers only ever see the version an admin approved. Each version is its own row with a `state`: a vendor edits the `draft`; submitting makes it `pending_review`; approving makes it the `published` one and the previous `published` row `superseded`; rejecting makes it `rejected`. Editing never touches what is live, and old versions stay as history.

Why rows, and not two columns or a JSON blob: the database enforces **at most one draft and one published profile per vendor** with partial unique indexes; every version has its own `version` number, which the central app uses to ignore stale events; and a profile points at its assets with real foreign keys.

- **`version` only increases per vendor and never changes**: a trigger refuses an insert that is not higher than every earlier version of that vendor, and any update of `version`. It takes a per-vendor advisory lock, so two concurrent inserts cannot both pass the check.
- **A profile can only use its own vendor's assets**: `logo_asset_id` and `banner_asset_id` are composite foreign keys `(vendor_id, asset_id)` to `assets (vendor_id, id)`, so the database refuses another vendor's file. An asset in use cannot be deleted; mark it `deleted` instead.
- **Approval is one transaction of two UPDATEs, in this order**: the old `published` row to `superseded`, then the approved row to `published` (the unique index is checked per statement, so publishing first fails).
- **Submitted means complete enough**: a draft may be empty, but anything `pending_review`, `published`, `superseded` or `rejected` needs at least one category and a `submitted_at`; `published_at` is set exactly for `published` and `superseded`. `categories` are trimmed, non-empty, at most 80 characters and unique (case-sensitive, like the contract).
- **Not constrained here**: how many versions may be `pending_review` at once, and that a logo asset has kind `brand_logo`. Both are Phase 3 rules for the service.

### Products: identity here, content in revisions

An approved product keeps its live content while a new revision is edited and reviewed ("editing an approved product creates a pending revision instead of changing the live one"). So the content is in `product_revisions`, and `products` points at two of them: `live_revision_id` (what shoppers see) and `pending_revision_id` (being edited or in review). Both are composite foreign keys that include the product id, so a product cannot point at another product's revision.

- **Lifecycle**: a new product is `draft` with revision 1 as pending; submitting makes it `pending_review`; approving makes it `approved` with that revision live and nothing pending. Editing an approved product adds a revision as pending while the status stays `approved`; `submitted_at` NULL means "being edited", set means "in review". `approved` needs a live revision, and a product that was never approved (`draft`, `pending_review`, `rejected`) has none.
- **Variants are split in two**: `product_variants` is the identity (SKU, size, colour), stable across revisions so the central app can update the same `variant_id`, and `product_revision_variants` holds what may differ per revision (price, MRP, offered or not). The alternative, copying variants into every revision, would make "SKU unique per vendor" impossible: the live and the pending revision both contain the SKU.
- **Images belong to a revision** and may reuse an asset across revisions. The asset must be the revision's vendor's: `(vendor_id, asset_id)` is a composite foreign key to `assets (vendor_id, id)`, and `(revision_id, vendor_id)` ties the image's vendor to its revision.
- **Submitting needs something to review**: a trigger refuses a `submitted_at` on a revision without at least one active variant and one image. Insert a revision as a draft, add those, then submit.
- **Two version rules**: a revision's `version` increases per product and never changes (the trigger from brand profiles); `products.version` is the aggregate version the central app uses to drop stale events: the service raises it whenever the live product changes, and the database never lets it go down.
- **Not constrained here**: that an image asset has kind `product_image`, that a product's revisions are only edited while unsubmitted, and the status transitions. Those are Phase 3 rules for the service.

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
