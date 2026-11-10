# vendor-api

FastAPI service for vendors, brand profiles, products, assets, reviews and publishing to the central app. See the [roadmap](../../docs/ROADMAP.md) (Phases 2 to 4), [ADR 0009](../../docs/adr/0009-auth-model.md) for the auth model, [ADR 0010](../../docs/adr/0010-shared-security-package.md) for what it shares with identity-api, and the [key-rotation runbook](../../docs/runbooks/jwt-key-rotation.md).

## What it does today (Phase 2)

- **Vendor accounts:** signup with email verification, login, refresh (rotating tokens with reuse detection), logout, change-password, forgot and set password.
- **A team per vendor:** the owner invites staff, lists, disables and enables them; invites and resets go by email.
- **Vendor-scoped data isolation**, with helpers and tests that fail when a route or table skips the rule.
- **Admin API** (`/v1/admin/*`): accepts only identity-api tokens, verified through its JWKS. The review queue is the first part of it.
- **Its own tokens and keys:** vendor-api signs vendor tokens with its own key and serves its own JWKS.
- **The schema** for vendors, users, tokens and (in the open Phase 2 PRs) brand profiles, products and reviews.

Phase 3 adds the vendor brand profile and product catalog.

## Quick start: from nothing to a signed-in vendor

You need Python 3.12+ and Docker. From the repository root:

```sh
cp .env.example .env                       # set POSTGRES_PASSWORD
docker compose up -d                       # Postgres, Redis and Mailpit (the email catcher)
cd services/vendor-api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-shared.txt     # packages/py-auth and py-security, from the repository path
pip install -e '.[dev]'
cp .env.example .env                       # put the same POSTGRES_PASSWORD into DATABASE_URL
python -m vendor_api.cli generate-key      # writes ./.keys/<kid>.pem; JWT_KEYS_DIR in .env points there
alembic upgrade head
python -m vendor_api.cli seed-dev          # a demo vendor with an owner and a staff user
uvicorn vendor_api.main:app --reload --port 8002
```

Then, in another terminal:

```sh
curl localhost:8002/health                 # {"status": "ok"}
curl localhost:8002/ready                  # Postgres and Redis
# Sign in as the seeded owner (local-only password: demo-password-1234):
curl -s localhost:8002/v1/auth/login -H 'content-type: application/json' \
  -d '{"email": "owner@demo-brand.test", "password": "demo-password-1234"}'
```

**Or sign up as a new vendor:** `POST /v1/auth/signup` (try it at <http://localhost:8002/docs>), then open Mailpit at <http://localhost:8025>, copy the token from the link (`...#token=<token>`) and `POST /v1/auth/verify-email` with `{"token": "<token>"}`; now you can log in.

- **`seed-dev`** creates one approved vendor `demo-brand` with a verified owner (`owner@demo-brand.test`) and a staff user (`staff@demo-brand.test`), both with one password: `demo-password-1234`, a **local-only** default (set your own with `--password` or `SEED_VENDOR_PASSWORD`). The command never prints a password, runs only with `ENV=dev`, and is safe to run twice: it never changes anything that exists.
- If `generate-key` printed a `JWT_SIGNING_KID`, put it in `.env` (it is only needed with more than one key). The app refuses to start without a signing key.
- To also run identity-api (admin tokens for `/v1/admin/*`) see the [root README](../../README.md), Local development. vendor-api starts without it.

## Endpoints

The live reference is the OpenAPI document at <http://localhost:8002/docs> (dev; off when `ENV=prod`). **`openapi.json` in this directory is the committed copy** the Phase 5 typed client is generated from. A test fails when it is stale: regenerate it with `python -m vendor_api.cli export-openapi` and commit it (`--check` only verifies).

| Group | Endpoints | Accepts |
|---|---|---|
| Health | `GET /health`, `GET /ready` | anyone |
| Keys | `GET /.well-known/jwks.json` | anyone |
| Vendor auth | `POST /v1/auth/signup`, `verify-email`, `resend-verification`, `login`, `refresh`, `logout`, `change-password`, `forgot-password`, `set-password` | anyone, or a vendor token for `change-password` |
| Vendor | `GET /v1/vendor/me`; `GET`/`PUT /v1/vendor/brand-profile`, `POST /v1/vendor/brand-profile/submit`, `GET /v1/vendor/brand-profile/published`; `POST`/`GET /v1/vendor/users`, `PATCH /v1/vendor/users/{id}`, `POST /v1/vendor/users/{id}/resend-invite` (owner only); `GET`/`POST /v1/vendor/products`, `GET`/`PUT`/`DELETE /v1/vendor/products/{id}`, `POST /v1/vendor/products/{id}/submit` | vendor-api tokens only |
| Admin | `GET /v1/admin/me`, `GET /v1/admin/reviews`, `GET /v1/admin/reviews/{id}` | identity-api tokens only (`vendor_reviewer` or `super_admin`) |

The sections below describe each group.

## Cookies and CORS (local development)

- The **refresh token** is an `HttpOnly` cookie named **`vendor_refresh`**, path `/v1/auth`, never in a response body. identity-api uses `identity_refresh`. **The names differ on purpose:** both services run under one parent domain in production and share a Redis, so equal names would overwrite each other's cookie (and equal Redis prefixes would mix their sessions: vendor-api's are `vendor:`, identity-api's `identity:`).
- `COOKIE_SECURE=true` (the default) works on `http://localhost` in Chrome and Firefox. Safari and curl do not treat localhost as secure: set `COOKIE_SECURE=false` locally for them. Never in production. `SameSite=Strict` works because the portal (`http://localhost:5174`) and this API (`http://localhost:8002`) are the same site. The cookie is **host-only** (no `Domain` attribute, and no setting for one): the browser sends it back only to this service, never to identity-api or another `*.shazlo.store` host. `ENV=prod` refuses `COOKIE_SECURE=false`.
- **CORS:** the portal's exact origin must be in `CORS_ALLOWED_ORIGINS` (comma separated, no wildcard: credentials are allowed), and its requests need `credentials: "include"` so the cookie reaches `/v1/auth/refresh` and `/v1/auth/logout`. Those two endpoints also check `Origin` (or `Referer`) against the same list, as a CSRF guard.

## Layout

```
vendor_api/
  app.py        create_app() factory (settings and readiness checks can be injected in tests)
  main.py       `app = create_app()` for uvicorn
  api/          routers: health, jwks, auth, vendor (me), team (users), admin; dependencies in deps.py
  core/         settings, JSON logging, request-ID middleware, error handlers
  db/           models, declarative base (constraint naming convention), async engine and sessions
  migrations/   Alembic env and versions (runs on a sync psycopg engine)
  services/     business logic, free of HTTP concerns (signup, auth, credentials, team, email, seed)
```

The logging, request-ID middleware and error handlers are copies of identity-api's (ADR 0010). The security code (keys, tokens and later sessions, rate limits, passwords) comes from `packages/py-security`, and token verification from `packages/py-auth`; both are installed from the repository path through `requirements-shared.txt`.

## Settings

Read from the environment (and `.env`). Names are the upper-case field names. Full list with comments in [`.env.example`](.env.example).

| Setting | Default | Notes |
|---|---|---|
| `DATABASE_URL` | none (required) | `postgresql://`, `postgresql+asyncpg://` or `postgresql+psycopg://` |
| `REDIS_URL` | none (required) | `redis://` or `rediss://` |
| `ENV` | `dev` | `dev`, `test` or `prod`; `prod` turns off `/docs` |
| `LOG_LEVEL` | `INFO` | |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5174` | comma separated; credentials allowed for these only; no wildcard |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | `true` / `strict` | refresh-token cookie (host-only); `none` requires `COOKIE_SECURE=true`; prod requires `COOKIE_SECURE=true` |
| `JWT_ISSUER` | `http://localhost:8002` | `iss` of the tokens vendor-api issues; prod requires this service's public `https://` URL (not localhost), and it must always differ from `IDENTITY_ISSUER` |
| `JWT_KEYS_DIR` / `JWT_KEYS` | none (one is required) | RS256 keys: a directory of `<kid>.pem` files and/or JSON `{"<kid>": "<PEM>"}` |
| `JWT_SIGNING_KID` | unset | the key that signs; needed with several keys, the others are only published |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | 1 to 3600 |
| `ARGON2_MEMORY_COST_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` | `19456` / `2` / `1` | password hashing cost (OWASP baseline); raising it rehashes on the next login |
| `PASSWORD_MIN_LENGTH` | `12` | the longest accepted is 128 |
| `IDENTITY_JWKS_URL` / `IDENTITY_ISSUER` | unset | where admin tokens come from (identity-api). Both or neither; **required in prod**; https outside dev. Without them there is no `/v1/admin` group |
| `RATE_LIMIT_*` | see Rate limits | `"<limit>/<window seconds>"` per endpoint, e.g. `RATE_LIMIT_SIGNUP_IP=10/3600` |
| `RATE_LIMIT_FAIL_CLOSED` | see Rate limits | endpoints that answer `503` when Redis is down |
| `RATE_LIMIT_HMAC_KEY` | random per process | **required in prod**, at least 32 characters, shared by every instance, and not identity-api's |
| `RATE_LIMIT_IPV6_PREFIX` | `64` | IPv6 clients are counted per network of this length |
| `TRUSTED_PROXIES` | empty | CIDRs of the reverse proxies whose `X-Forwarded-For` is believed (comma separated); empty means the TCP peer is the client |
| `REFRESH_TOKEN_TTL_DAYS` / `REFRESH_FAMILY_MAX_DAYS` | `7` / `30` | a refresh token lives 7 days and never outlives its family |
| `REFRESH_REUSE_GRACE_SECONDS` | `10` | a refresh token reused within this many seconds is a concurrent request (`409`), not theft; `0` revokes on any reuse |
| `INVITE_TOKEN_TTL_MINUTES` / `RESET_TOKEN_TTL_MINUTES` | `1440` / `60` | how long an invite link and a password-reset link work (5 minutes to 14 days / 1 day) |
| `EMAIL_VERIFICATION_TTL_MINUTES` | `1440` | how long a verification link works (5 minutes to 7 days) |
| `EMAIL_BACKEND` | `console` | `console` (sends nothing, logs the link in dev only) or `smtp` |
| `EMAIL_FROM` | `Shazlo <no-reply@shazlo.store>` | the sender of every email |
| `SMTP_HOST` / `SMTP_PORT` | unset / `587` | required with `smtp` |
| `SMTP_USER` / `SMTP_PASSWORD` | unset | set both or neither; the password is a secret with no default; refused with `SMTP_SECURITY=none` (they would travel in clear text) |
| `SMTP_SECURITY` | `starttls` | `none` (local Mailpit only), `starttls` or `ssl` |
| `EMAIL_SEND_ATTEMPTS` | `3` | tries before an email is given up |
| `PORTAL_BASE_URL` | `http://localhost:5174` | the vendor portal: links in emails point here |

`ENV=prod` refuses the `console` backend (it sends nothing), `SMTP_SECURITY=none` and an `http://` portal address.

identity-api is on port 8001 and vendor-api on 8002, so both can run side by side. In docker-compose (`--profile vendor`) vendor-api uses Redis database 1; see the root README, Local development. Their cookie names and Redis key prefixes differ (ADR 0010).

## Tokens and keys

vendor-api signs **its own** tokens with **its own** RS256 key, never identity-api's, so a vendor token can never pass as an admin token and the reverse (ADR 0009). The key ring, issuer and JWKS come from [`packages/py-security`](../../packages/py-security/README.md); the verifier from [`packages/py-auth`](../../packages/py-auth/README.md). vendor-api only configures them (`core/security.py`, `services/tokens.py`).

- A token has `iss` (this service's `JWT_ISSUER`), `sub` (the vendor user), `aud` `vendor-api`, `vendor_id`, `roles` (exactly one of `owner` or `staff`), `iat`, `exp` (15 minutes), `jti`, and the `kid` in the header. No email or name goes into it.
- `VendorTokens.verify` accepts only RS256, checks `iss`, `aud` and `exp` (30 seconds of leeway) and requires `sub`, `vendor_id` (a UUID), `roles`, `jti` and `kid`. It returns `VendorClaims(user_id, vendor_id, role, jti, expires_at)`.
- `GET /.well-known/jwks.json` serves the public keys with `Cache-Control: max-age=600`, built from public keys only.
- `python -m vendor_api.cli generate-key [--dir DIR] [--kid KID]` writes a new private key (mode `0600`, never overwriting) and prints the settings to use it.
- Keys are RSA 2048-bit or larger. A key that is only published may be configured as a public PEM. Rotation follows [the runbook](../../docs/runbooks/jwt-key-rotation.md), which covers both services.

## Signup and email verification

| Endpoint | Notes |
|---|---|
| `POST /v1/auth/signup` | `{brand_name, contact_name, email, phone, product_type, website_or_instagram?, price_min_paise, price_max_paise, password, terms_accepted}`. Creates the vendor (`pending`), a status event and the owner (`active`, email not verified) in **one transaction**, and emails a verification link. Always `202` with the same body. `422` for a weak password (`weak_password`, same policy as identity-api), terms not accepted (`terms_not_accepted`) or invalid fields. |
| `POST /v1/auth/verify-email` | `{token}`. Sets `email_verified_at`; `204`. An unknown, used or expired token is one generic `400 invalid_token`. |
| `POST /v1/auth/resend-verification` | `{email}`. Always `202` with one body. Sends a new link only for an existing, active, unverified user; the new token ends the older ones. |

- **No account enumeration.** An email that is already registered (in any letter case, vendor or staff) gets exactly the same `202` and body as a new one, but receives an "you already have an account" email instead of a verification email, and nothing is created. The password is hashed before the lookup in both cases, so the two take about the same time; two signups racing for one email are caught by the unique constraint and answered the same way.
- **Tokens:** 256-bit random, sent only in the email (in the link fragment, see Email). Only the SHA-256 is stored in `auth_tokens`. A token works once within 24 hours: the `UPDATE ... RETURNING` that spends it is what stops two requests from both using it. Money is integer paise.
- **The owner cannot sign in until the email is verified.** Login answers `401 invalid_credentials` until then, exactly as for a wrong password; signup alone grants nothing. Verifying does not approve the vendor: an admin does that (Phase 3), and the vendor stays `pending` until then.
- **Slugs** come from the brand name (accents folded, ASCII letters and digits, hyphens), with `-2`, `-3`, ... on collision. A name with no Latin letters becomes `vendor`, `vendor-2`, ...
- **Input the database would refuse is refused first.** Emails must be a plain address (no display name, quotes, commas or spaces), the phone fits the 32-character column, and free-text fields refuse control characters (NUL included) and lone surrogates. Otherwise such input would reach the INSERT only for unregistered emails and fail there with a `500`, telling them apart from registered ones. As a backstop, a database error during signup still answers `202` and sends nothing.
- **Rate limits:** see [Rate limits](#rate-limits).
- Validation errors name the field and the rule, never the value that was sent.

## Sessions

Vendor sessions work like admin sessions (ADR 0009): a 15-minute access token (the vendor token from "Tokens and keys") and an opaque refresh token in an `HttpOnly` cookie, rotated on every use, with a token family in Redis that ends on reuse.

| Endpoint | Notes |
|---|---|
| `POST /v1/auth/login` | `{email, password}` returns `{access_token, token_type, expires_in, user, vendor}` and sets the refresh cookie. `401 invalid_credentials` for an unknown email, a wrong password, a user who has no password yet, a disabled user and an unverified email alike (each costs one password verification). Unverified is not a separate answer: anyone can sign up with another person's address and a password they chose, and a `403` (signup created the account) against a `401` (the address was already registered, so signup created nothing) would reveal which addresses have accounts. A `rejected` or `suspended` vendor is `403 vendor_not_allowed`. A `pending` vendor can sign in: it must be able to edit and submit. Rehashes when the Argon2 cost changed; sets `last_login_at` |
| `POST /v1/auth/refresh` | Reads the cookie, rotates it, returns the same body as login. A token that was already used ends its whole family (`401`, cookie cleared); one used within the grace window is `409 refresh_conflict` and revokes nothing. A suspended or rejected vendor, a disabled user or an unverified email cannot refresh: the family ends. Needs an allowed `Origin` (or `Referer`), like logout |
| `POST /v1/auth/logout` | Ends the cookie's family and clears the cookie. Always `204` |
| `POST /v1/auth/change-password` | Bearer token plus `{current_password, new_password}`. Same policy as signup. Ends **every** session of the user and starts a new one |
| `GET /v1/vendor/me` | The user, their role and a vendor summary (id, name, slug, status). No hashes or tokens |

- **Cookie and Redis keys do not overlap with identity-api's**, because both services run on one parent domain and share a Redis: the cookie is `vendor_refresh` (identity-api: `identity_refresh`), path `/v1/auth`, `HttpOnly`, `Secure` and `SameSite` from settings; the Redis keys start with `vendor:` (identity-api: `identity:`); only SHA-256 hashes are stored. A test puts both stores on one Redis and checks neither touches the other's sessions.
- **Dependencies** (`api/deps.py`): `current_vendor_user` verifies the token, then reads the user and the vendor **from the database on every request**: the user must be active with a verified email, the token's `vendor_id` must be the user's vendor, and the vendor must be `pending` or `approved`. So disabling a user or suspending a vendor takes effect at once, not when the 15-minute token expires, and a role change applies immediately. `require_vendor_role(VendorUserRole.OWNER)` lets only the listed roles through (`403 forbidden`).
- **Ending sessions when a vendor's status changes**: `AuthService.end_sessions_of_vendor(db, vendor_id)` ends every session of every user of that vendor. Phase 3 calls it when an admin suspends or rejects a vendor. Refreshing is refused for those statuses anyway; the hook also stops a vendor that is approved again from getting its old sessions back. `end_sessions_of_user` does the same for one user (call it when a user is disabled).

## Admin API (identity-api tokens)

vendor-api keeps two route groups (ADR 0009) and they never accept each other's tokens:

| Group | Accepts | How |
|---|---|---|
| `/v1/vendor/*`, `/v1/auth/*` | **only** vendor-api's own tokens | its own key ring (see Tokens and keys) |
| `/v1/admin/*` | **only** identity-api tokens | `packages/py-auth`: `TokenVerifier(issuer=IDENTITY_ISSUER, audience="vendor-api")` fed by identity-api's JWKS |

- **`GET /v1/admin/me`** returns the admin's id and roles **from the token**. It is the first admin endpoint and a check for Phase 3. The group requires the `vendor_reviewer` role (`super_admin` always passes); anything else is `403`, no token or a bad one `401`.
- **The reviewer is the token's, never the client's.** A handler takes `admin: Reviewer` (`api/admin.py`) and uses `admin.id`, the token's `sub`. Admin request bodies derive from `AdminRequest`, which forbids unknown fields, so a `reviewer_id` in a body is a `422`; one in the query or a header is never read. A test proves it.
- **identity-api being down does not stop vendor-api.** The `JwksClient` is created once at startup and fetches nothing until the first admin token. Keys are cached for 10 minutes, refetched at most once a minute, and the last good keys stay in use during an outage; an unknown `kid` cannot turn an outage into a request per token. Before the first successful fetch an admin request is `401`, not `500`.
- **`/ready` does not report identity-api.** Readiness means "this service can do its own work": Postgres and Redis. Vendors keep signing in while identity-api is down, and only the admin group degrades (stale keys keep working for a while). Reporting it would take vendor-api out of rotation for a dependency most of its traffic does not use.
- A vendor token on `/v1/admin/*` is `401` (its key is not in identity-api's JWKS), and an identity-api token on `/v1/vendor/*` is `401`; tests cover both, including a token signed with vendor-api's key that claims `super_admin`.

## Vendor data isolation

A vendor cannot read, change or learn about another vendor's data, and another vendor's object looks like it does not exist: **404, never 403**. The rule is easy to forget on one endpoint, so it is built into helpers and enforced by tests.

**Adding a vendor-scoped endpoint**
1. Put the route under `/v1/vendor` (an `APIRouter` in `vendor_api/api/`, prefix `/vendor/...`) and depend on the caller: `scope: Scope` (`api/deps.py`) gives `scope.vendor_id`, `scope.user_id` and `scope.role` from the verified token **and the database**; or `owner: Owner`/`require_vendor_role(...)` when only some roles may call it. Never read a vendor id from the path, query or body. Request bodies forbid unknown fields, so a `vendor_id` sent by the client is a 422.
2. Query through `db/scoped.py`: `scoped_select(Model, scope.vendor_id)` for lists and `get_owned_or_404(db, Model, object_id, scope.vendor_id, NOT_FOUND)` for one object. The id and the vendor are one condition, so another vendor's id is the same 404 as an id that does not exist. `scoped_select` raises `TypeError` for a model without `vendor_id`.
3. A new table of vendor data needs a `vendor_id` with a foreign key leading to `vendors` and an index starting with it. A table only ever reached through a parent that has one goes in `SCOPED_THROUGH_PARENT` in `tests/test_isolation_structure.py`, with the parent.
4. Test it with the `tenants` fixture (`tests/conftest.py`): vendors A and B, each with an owner, a staff member and an invited user, their tokens and an admin token. Add the endpoint to `ACTIONS` in `tests/test_isolation.py`, or write a test beside it: act as A on B's ids and expect the same 404 as for an unknown id, with B's data unchanged.

**What fails CI if it is forgotten**: `tests/test_isolation_structure.py` fails when a table of vendor data has no `vendor_id`, no foreign key to `vendors`, or no index on it, and when a route under `/v1/vendor` does not depend on `current_vendor_user`. It finds routers by walking `vendor_api/api`, so a new module is checked without anyone adding it to a list, and its last tests feed it bad samples to show it does fail.

**What is covered today**: `/v1/vendor/me`, the staff list, disable and enable, and resend-invite: each vendor's lists hold only its own rows; B's user ids (the owner, a staff member, an invited user) and random ids are the same 404 (identical bodies), in both directions, with B's rows unchanged afterwards; a staff member gets the same 403 for their own, another vendor's and unknown ids; an invite always lands in the caller's vendor; a token whose vendor is not the user's vendor is refused; admin and vendor tokens are not interchangeable.

## Brand profile (vendor side)

A vendor edits a draft, submits it, and reads what was approved. Any active user of the vendor (owner or staff) can do all four; a `pending` vendor can too (it must be able to submit), a `rejected` or `suspended` one gets `403 vendor_not_allowed`. The vendor always comes from the token, never from the request.

| Endpoint | What it does |
| --- | --- |
| `GET /v1/vendor/brand-profile` | The draft to edit, with `in_review_version` (the version now in review, if any). If there is no draft (never started, or the last one was submitted) one is **created from the latest version**, or from the signup details (name, price range) for a new vendor. Repeated reads return the same draft |
| `PUT /v1/vendor/brand-profile` | **Replaces** the draft's content, so a field left out is cleared. Same limits as the published contract (ADR 0003): name 1 to 120, tagline 160, about 4000, `https` website, Instagram handle (a leading `@` is dropped), up to 20 unique categories of 1 to 80 characters, price range in paise. `logo_asset_id` / `banner_asset_id` must be the vendor's own **ready** `brand_logo` / `brand_banner` assets; another vendor's id and a missing id give the same `422 invalid_asset`. Never touches the published version |
| `POST /v1/vendor/brand-profile/submit` | Sends the draft for review: it becomes `pending_review` (frozen from then on) and a pending `review` plus its `submitted` audit event (actor: the vendor user) are written in one transaction. `409 nothing_to_submit` without a draft, `422 profile_incomplete` without a category, `422 invalid_asset` if an image was deleted since saving, `409 review_pending` if a version is already in review |
| `GET /v1/vendor/brand-profile/published` | The version shoppers see: the last one an admin approved. `404 no_published_profile` until there is one |

**Editing while a version is in review** (decided here): the submitted version is frozen, so editing never changes it. The next `PUT` (or `GET`) opens a **new draft** (next version number, copied from the version in review) and the vendor can keep working; submitting it waits for the first review to be decided (`409 review_pending`). There is no withdraw: the database does not allow a submitted version to go back to `draft`, and a reviewer decides soon enough. Phase 3's review endpoints will make the decision and, on approval, publish the version.

Every write first locks the vendor's row, so two tabs saving, or a save racing a submit, are handled one after the other for that vendor only.

## Products (vendor side)

A vendor's catalog. Any active user of the vendor (owner or staff) can do everything here; another vendor's product is `404 product_not_found`, the same as an id that does not exist. The vendor comes from the token, never the request.

| Endpoint | What it does |
| --- | --- |
| `POST /v1/vendor/products` | Creates a `draft` product with revision 1 as its editable (`working`) revision. Body: `sku` (identity, cannot change later) plus the content below. `409 sku_taken` if the vendor already uses the SKU (case ignored; archived products keep theirs) or a variant SKU is used by another product of the vendor |
| `GET /v1/vendor/products` | Paged list, most recently changed first: `limit` (1 to 100, default 25), `offset`, `status`, `category` (case ignored), `q` (part of the SKU or title). Returns `{items, total, limit, offset}`. Archived products show only with `status=archived`. Each item has the title of the latest revision and `has_pending_changes` |
| `GET /v1/vendor/products/{id}` | `live` (the approved revision, what shoppers see; null until approved) and `working` (the revision being edited, in review, or the last rejected one, with its review and the admin's reason) |
| `PUT /v1/vendor/products/{id}` | **Replaces** the content of the editable revision (a field or list left out is cleared). **Never changes `live`**: editing an approved product creates a new pending revision (next version number) and the status stays `approved`; further edits change that same revision. A rejected product gets a new revision and goes back to `draft`. `409 product_in_review` while a version is in review, `409 product_archived` |
| `POST /v1/vendor/products/{id}/submit` | Sends the editable revision for review (it is frozen from then on) and writes a pending review plus its `submitted` audit event in one transaction; a never-approved product becomes `pending_review`. `422 product_incomplete` without an active variant or an image, `409 nothing_to_submit` when nothing is being edited |
| `DELETE /v1/vendor/products/{id}` | A product that was **never submitted** is deleted for good (SKU free again). One that was ever submitted is **archived**: history and SKU kept, an approved one goes off sale and its `version` is raised (the Phase 4 `product.unpublished` hook). `409 product_in_review` while in review; deleting an archived product again is a no-op |

**Content** (limits from the published contract, ADR 0003): `title` (200), `description` (4000), `category` (100), `subcategory`, `gender` (`women`, `men`, `unisex`), `fabric` (80), `weight_grams` (> 0), `returnable` and `return_window_days` (0 to 30, required when returnable; ignored otherwise), up to 100 `variants` and 10 `images`.
- **Variants** are `{sku, size, color, price_paise, mrp_paise, is_active}`. The **SKU is the variant's identity**: listing the same SKU (any letter case) in a later edit is the same variant, so the central app keeps updating one `variant_id`. Its size and colour cannot change (`422 variant_identity_changed`; use a new SKU). SKUs are unique per vendor across all products; two variants of one product cannot share size and colour.
- **Images** are `{asset_id, alt_text}` in display order. Each must be the vendor's own **ready `product_image`** asset; another vendor's id and a missing id give the same `422 invalid_asset`. An image can be used once per product.

**Editing while a version is in review** (decided here): the submitted revision is frozen by the database and a product has room for one pending revision, so the product cannot be edited until the review is decided (`409 product_in_review`). There is no withdraw.

Every write first locks the product row, so two requests on one product run one after the other.

## Review queue (reviewers)

What vendors have submitted, and exactly what changed. Part of the admin group: identity-api tokens only, role `vendor_reviewer` (or `super_admin`), enforced once for the whole `/v1/admin` router. A vendor token, no token and a token for another audience are `401`; an admin without the role is `403 forbidden`. Reviewers see **every vendor's** submissions (nothing is scoped to a vendor). These two endpoints only read: approving and rejecting are separate.

| Endpoint | What it does |
| --- | --- |
| `GET /v1/admin/reviews` | The queue, paged (`limit` 1 to 100, default 25, `offset`) with a `total`. Filters: `status` (`pending` by default, `approved`, `rejected`, `withdrawn` or `all`), `subject` (`brand_profile` or `product`), `vendor_id`. **Pending reviews come oldest first** (the one that has waited longest is on top); the others newest first. Each item: the review, the vendor (id, name, slug, status), who submitted it (id and email) and when, the version under review with its title (the brand name, or the product's title with its SKU and `product_id`), and, once decided, the reviewer, the time and the reason |
| `GET /v1/admin/reviews/{id}` | The same summary plus `content` (the version under review, in full), `base` (the version it is compared with), **`changes`** and `events` (the audit trail, oldest first). `404 review_not_found` for an unknown id |

**What the diff compares.** A review points at the exact version row a vendor submitted, and `base` is **the last version that went live before it**:
- a brand profile: the newest version with a `published_at` and a lower version number. A pending version 3 is compared with the published 2; if version 2 was rejected it is skipped (it never went live), so version 3 is compared with 1; an approved version is still shown against what it replaced;
- a product revision: the product's live revision if it is older, otherwise the newest older revision that was ever approved.

With no `base` (a first submission) every field that has a value is listed as added (`before` is `null`).

**`changes` lists exactly the fields that differ**, never one that is the same, in a stable order. Each entry is `{field, before, after}`:
- brand profile fields: `brand_name`, `tagline`, `about`, `logo`, `banner` (the asset id and its URL), `website_url`, `instagram_handle`, `categories` (a list that differs in content or order), `price_min_paise`, `price_max_paise`;
- product fields: `title`, `description`, `category`, `subcategory`, `gender`, `fabric`, `weight_grams`, `returnable`, `return_window_days`; then **variants** by SKU (a whole variant added or removed is `variants[<sku>]` with `null` on one side; a variant that changed is one entry per changed field, `variants[<sku>].price_paise`), then **images** by position (`images[<position>]`, the asset and caption on each side; the same picture with the same caption is not a change, and a changed URL for the same asset is not either).
- `null` and an empty list count as the same "nothing"; empty text is not nothing; `false` and `0` are values.

## Team, invites and password reset

Three cases end with "someone gets an email and sets a password": an owner inviting a staff member, a user who forgot their password, and (Phase 8) the owner of a vendor migrated from MongoDB. All use the same one-time token: 256-bit, only its SHA-256 stored, single use, and a newer token for the same purpose ends the older ones.

| Endpoint | Notes |
|---|---|
| `POST /v1/vendor/users` | **Owner only.** `{email}` invites a staff member: an `invited` user with no password and an emailed link (24 hours). An address already used **anywhere** (any vendor, any role, a vendor's own address) gets the same `202` and body and no email, so the endpoint cannot be used to find out who is registered. Limited per vendor |
| `GET /v1/vendor/users` | **Owner only.** The vendor's users (id, email, role, status, last login, created). No hashes |
| `PATCH /v1/vendor/users/{id}` | **Owner only.** `{"disabled": true}` disables a staff user and **ends their sessions at once** (and their unused links); `false` enables: back to `active`, or to `invited` for a user who never set a password. An owner cannot disable themselves (`409 cannot_disable_self`) and a vendor always keeps its owner (`409 owner_cannot_be_disabled`) |
| `POST /v1/vendor/users/{id}/resend-invite` | **Owner only.** A new invite for a user who has not set a password yet (`409 not_invited` otherwise); the older link stops working |
| `POST /v1/auth/forgot-password` | `{email}`. Always `202` with one body. Sends a reset link (1 hour) only to an existing **active** user; an invited user uses their invite, a disabled one cannot sign in. Limited per IP and per address as typed |
| `POST /v1/auth/set-password` | `{token, password}`. Accepts an invite or a reset token. Same password policy as signup, used exactly as typed. It activates an invited user, **marks the email verified** (the link proved it), spends the token (and every other unused link of the user) and **ends all of the user's sessions**. It does not sign anyone in. A token that is unknown, used or expired, or that belongs to a user who may not use it, is one generic `400 invalid_token`. A weak password is `422` and the link stays usable |

- **Another vendor's user is a `404`**, never a `403`: the owner's vendor id is part of every lookup, so the response does not reveal that the id exists (see the isolation issue, #86).
- **Reset ends sessions** after the password is committed, as identity-api's change-password does. If Redis is down at that moment the request fails after the password changed; the sessions can be ended again with `AuthService.end_sessions_of_user`.
- **`python -m vendor_api.cli invite-owner --vendor <slug or id> [--email ADDRESS] [--status STATUS]`** creates or re-invites a vendor's owner and sends the invite (used by the Phase 8 migration). The email defaults to the vendor's. A vendor with no owner gets an `invited` one; one whose owner is still `invited` gets a new link (and the address may be corrected); an owner who already set a password is left alone. `--status` sets the vendor's status too, with an audit event by the system. If sending fails the invite is saved: run it again to send a new one.

## Rate limits

Vendor auth is open to the internet, so every auth endpoint is limited, with the shared limiter from `packages/py-security` (ADR 0010): Redis fixed-window counters whose subjects (emails, IPs, families) are **HMAC-hashed**, so a Redis dump reveals no email or IP. Over a limit the answer is `429 rate_limited` with `Retry-After` (the seconds until the window resets, from the key's TTL) and `Cache-Control: no-store`; a rate-limited refresh keeps its cookie and its token.

Keys are `vendor:rl:<endpoint>:<scope>:<hash>`: the prefix and the `RATE_LIMIT_HMAC_KEY` are vendor-api's own, so counters never mix with identity-api's. The client IP is the TCP peer, or, when the peer is in `TRUSTED_PROXIES`, the first address from the right of `X-Forwarded-For` that is not a trusted proxy (so a client cannot choose its own IP by sending the header).

| Endpoint | Counted per | Default |
|---|---|---|
| `login` | IP; email + IP (failures: cleared by a success); email from any IP (skipped for an email + IP pair that logged in within 30 days) | 20 per minute; 5 per 15 minutes; 50 per hour |
| `signup` | IP; email | 10 per hour; 3 per hour |
| `resend_verification` | IP; email | 10 per hour; 3 per hour |
| `verify_email` | IP | 20 per minute |
| `refresh` | IP; session (refresh family) | 60 per minute; 20 per minute |
| `change_password` | user (wrong current passwords; cleared once it verifies) | 5 per 15 minutes |
| `forgot_password` | IP; email | 10 per hour; 3 per hour |
| `set_password` | IP | 20 per 15 minutes |
| `staff_invite` (invite and resend-invite) | vendor | 20 per hour |

- **Nobody can lock a vendor out.** The checks run in order and stop at the first one that refuses, so a request the per-IP or per-pair counter already refuses never reaches the per-email counter: one attacking IP adds at most 5 per 15 minutes to it. And an email + IP pair that logged in successfully in the last 30 days skips the per-email counter, so a vendor on their usual network gets in even while someone guesses from elsewhere.
- **Signup and resend are limited on the address as typed**, whether or not it is registered, so the limit looks the same either way and reveals nothing. Per address matters because those endpoints send email (verification, or "you already have an account"): without it they would mail-bomb an inbox.
- **When Redis is down** the endpoints in `RATE_LIMIT_FAIL_CLOSED` answer `503 rate_limiter_unavailable`: the ones that check a password (`login`, `change_password`) so guessing stays limited, and the ones that send email (`signup`, `resend_verification`, `forgot_password`, `staff_invite`) so an outage cannot be used to flood an inbox. The others skip the limit and log a warning (fail open): `refresh` (signed-in vendors keep working; refreshing needs Redis anyway), `verify_email` and `set_password` (they need a 256-bit token, which cannot be guessed at any rate).
- **Behind a proxy**, set `TRUSTED_PROXIES`. Without it every client looks like the proxy and shares one set of per-IP counters.

## Email

Signup verification, staff invites and password reset send email (issue #80). The code depends on a small interface (`EmailSender.send(to, template, context)`) and the provider is a setting: switching from Mailpit to a real provider changes `EMAIL_BACKEND` and `SMTP_*`, not code. Plain SMTP works with SES, Postmark, Resend and most others.

- **Templates** (`services/email/templates.py`, plain text and HTML): `verify_email`, `staff_invite`, `password_reset` and `account_exists`. Each states how long the link lasts. The one-time token goes in the link's **fragment** (`https://<portal>/verify-email#token=...`), which browsers never send to a server, so it stays out of access logs and `Referer` headers. The portal reads it from `location.hash`. Paths: `/verify-email`, `/accept-invite`, `/reset-password`, `/login`.
- **Sending** is `EmailService.send_in_background(background_tasks, to, template, context)`, used through the `Emails` dependency (`api/deps.py`). It runs after the response, tries `EMAIL_SEND_ATTEMPTS` times with a doubling pause, then logs and drops the email. A broken mail server never fails or slows a request.
- **Logs** carry the template name and the kind of error, never the token, the recipient or the provider's reply. Only `ENV=dev` with the console backend prints a link (and the recipient), so a developer can click it.
- **Locally**, `docker compose up -d` runs Mailpit. See every email at <http://localhost:8025>. To see one: `python -m vendor_api.cli send-test-email [--to ADDRESS] [--template verify_email|staff_invite|password_reset|account_exists]` (`ENV=dev` only; the token is made up).

## Database

Async SQLAlchemy 2 with `asyncpg` for the app; Alembic runs on a sync engine (psycopg 3). Migration `0001` is an empty baseline; `0002` adds the vendor and vendor-user tables; `0003` adds assets and brand profiles; `0004` adds products; `0005` adds reviews; `0006` freezes submitted content and decided reviews (triggers), requires a pending revision for a product in review, and indexes the review foreign keys.

| Table | Notes |
|---|---|
| `vendors` | A company. UUID `id`; `name`; `slug` (unique, `^[a-z0-9]+(-[a-z0-9]+)*$`); `email` (unique, stored trimmed and lower-cased, enforced by a check constraint); `phone`, `contact_name`, `product_type`, `website_or_instagram`; declared price range in **integer paise** (`price_min_paise` >= 0, `price_max_paise` >= min); `status` (`pending` by default, `approved`, `rejected`, `suspended`) with `status_reason`, `status_changed_at` and `status_changed_by` (an identity-api admin id, no foreign key: another database) |
| `vendor_status_events` | **Append-only** audit of every status change: vendor, `from_status` (NULL when the vendor is created), `to_status`, `actor_type` (`admin`, `system`, `vendor`), `actor_id` (required unless the actor is the system), `reason`. Triggers refuse UPDATE, DELETE and TRUNCATE, and a vendor with events cannot be deleted |
| `vendor_users` | A person who signs in for a vendor. `email` unique across all vendors (trimmed, lower-cased); `password_hash` is NULL until an invite is accepted (only `invited` or `disabled` users may lack one); `role` (`owner`, `staff`; **at most one owner per vendor**, by a partial unique index); `status` (`invited`, `active`, `disabled`); `email_verified_at`, `terms_accepted_at`, `last_login_at` |
| `auth_tokens` | One-time tokens for email verification, invites and password reset. `purpose` (`verify_email`, `invite`, `reset_password`), `token_hash` (unique, must be a 64-character lower-case hex SHA-256), `expires_at`, `used_at`. **The token itself is never stored.** Deleting the user deletes their tokens |
| `assets` | An uploaded image; the file lives at the provider (Cloudinary), this is its record. `kind` (`brand_logo`, `brand_banner`, `product_image`), `provider` (`cloudinary`), `public_id` (unique), `url` (**https only**), `format`, `bytes`, `width`, `height` (all required once `status` is `ready`), `status` (`pending`, `ready`, `deleted`), `created_by`. `(vendor_id, id)` is unique so other tables can reference an asset together with its vendor |
| `brand_profiles` | **One row per version** of a vendor's brand page (see below). Content with the published contract's limits (ADR 0003): `brand_name` (120), `tagline` (160), `about` (4000), `logo_asset_id`, `banner_asset_id`, `website_url` (https), `instagram_handle` (`^[A-Za-z0-9._]{1,30}$`), `categories`, price range in paise; plus `version`, `state`, `submitted_at`, `published_at`, `updated_by` |
| `products` | A product's identity and where it stands. `sku` (unique per vendor **ignoring letter case**, max 64; two vendors may share one; stays reserved when archived), `status` (`draft`, `pending_review`, `approved`, `rejected`, `archived`), `version` (never goes down), `live_revision_id` and `pending_revision_id` |
| `product_revisions` | One version of the content (see below): `title` (200), `description` (4000), `category`, `subcategory` (100), `gender` (`women`, `men`, `unisex`), `fabric` (80), `weight_grams` (> 0), `returnable`, `return_window_days` (0 to 30, required when returnable), `version` (per product, increasing, immutable), `submitted_at`, `created_by` |
| `product_variants` | A variant's stable identity: `sku` (unique per vendor ignoring case), `size`, `color` (`''` = none; `(product, size, color)` unique). Its `id` is the contract's `variant_id`. No stock: the central app owns it |
| `product_revision_variants` | What a revision says about a variant: `price_paise` (> 0), `mrp_paise` (>= price), `is_active` |
| `product_images` | An ordered image of a revision: `position` 1 to 10 (unique per revision, so at most 10), `alt_text` (200), `asset_id` |
| `reviews` | An admin's review of one version of something a vendor submitted. `subject` (`brand_profile` or `product`) with exactly one of `brand_profile_id` / `product_revision_id`; `status` (`pending`, `approved`, `rejected`, `withdrawn`); `submitted_by`, `submitted_at`; `reviewer_id` (an identity-api admin id, no foreign key: another database), `decided_at`, `reason` |
| `review_events` | **Append-only** audit trail of a review: `action` (`submitted`, `approved`, `rejected`, `withdrawn`, `reopened`), `actor_type` (`admin`, `system`, `vendor`), `actor_id` (required unless the actor is the system), `reason`. A trigger refuses UPDATE, DELETE and TRUNCATE, and a review with events cannot be deleted |

Role, status and purpose values are plain text columns with check constraints, so adding a value is a migration of that constraint. Vendors and users are never deleted (foreign keys are `RESTRICT`): suspend or disable them instead.

### Brand profiles: draft and published versions

A vendor edits a brand page freely, but shoppers only ever see the version an admin approved. Each version is its own row with a `state`: a vendor edits the `draft`; submitting makes it `pending_review`; approving makes it the `published` one and the previous `published` row `superseded`; rejecting makes it `rejected`. Editing never touches what is live, and old versions stay as history.

Why rows, and not two columns or a JSON blob: the database enforces **at most one draft and one published profile per vendor** with partial unique indexes; every version has its own `version` number, which the central app uses to ignore stale events; and a profile points at its assets with real foreign keys.

- **`version` only increases per vendor and never changes**: a trigger refuses an insert that is not higher than every earlier version of that vendor, and any update of `version`. It takes a per-vendor advisory lock, so two concurrent inserts cannot both pass the check.
- **A profile can only use its own vendor's assets**: `logo_asset_id` and `banner_asset_id` are composite foreign keys `(vendor_id, asset_id)` to `assets (vendor_id, id)`, so the database refuses another vendor's file. An asset in use cannot be deleted; mark it `deleted` instead.
- **Approval is one transaction of two UPDATEs, in this order**: the old `published` row to `superseded`, then the approved row to `published` (the unique index is checked per statement, so publishing first fails).
- **Submitted means complete enough**: a draft may be empty, but anything `pending_review`, `published`, `superseded` or `rejected` needs at least one category and a `submitted_at`; `published_at` is set exactly for `published` and `superseded`. `categories` are trimmed, non-empty, at most 80 characters and unique (case-sensitive, like the contract).
- **A submitted version is history** (migration 0006): once a row leaves `draft`, a trigger refuses any change to its content (every column except `state`, `published_at` and `updated_at`, so a column added later is frozen too). `state` may only move `pending_review` to `published` or `rejected`, and `published` to `superseded`; nothing goes back to `draft`, so a withdrawn or rejected version stays as it was and the vendor edits a new draft row. `published_at` is set once. `vendor_id` never changes, not even on a draft.
- **Not constrained here**: how many versions may be `pending_review` at once, that a logo asset has kind `brand_logo`, and what state a withdrawn version is left in (it cannot be edited or go back to `draft`). These are Phase 3 rules for the service.

### Products: identity here, content in revisions

An approved product keeps its live content while a new revision is edited and reviewed ("editing an approved product creates a pending revision instead of changing the live one"). So the content is in `product_revisions`, and `products` points at two of them: `live_revision_id` (what shoppers see) and `pending_revision_id` (being edited or in review). Both are composite foreign keys that include the product id, so a product cannot point at another product's revision.

- **Lifecycle**: a new product is `draft` with revision 1 as pending; submitting makes it `pending_review`; approving makes it `approved` with that revision live and nothing pending. Editing an approved product adds a revision as pending while the status stays `approved`; `submitted_at` NULL means "being edited", set means "in review". `approved` needs a live revision, and a product that was never approved (`draft`, `pending_review`, `rejected`) has none.
- **Variants are split in two**: `product_variants` is the identity (SKU, size, colour), stable across revisions so the central app can update the same `variant_id`, and `product_revision_variants` holds what may differ per revision (price, MRP, offered or not). The alternative, copying variants into every revision, would make "SKU unique per vendor" impossible: the live and the pending revision both contain the SKU.
- **Images belong to a revision** and may reuse an asset across revisions. The asset must be the revision's vendor's: `(vendor_id, asset_id)` is a composite foreign key to `assets (vendor_id, id)`, and `(revision_id, vendor_id)` ties the image's vendor to its revision.
- **Submitting needs something to review**: a trigger refuses a `submitted_at` on a revision without at least one active variant and one image. Insert a revision as a draft, add those, then submit.
- **Two version rules**: a revision's `version` increases per product and never changes (the trigger from brand profiles); `products.version` is the aggregate version the central app uses to drop stale events: the service raises it whenever the live product changes, and the database never lets it go down.
- **A submitted revision is frozen** (migration 0006): once `submitted_at` is set, triggers refuse any UPDATE or DELETE of the revision (clearing `submitted_at` too) and any INSERT, UPDATE or DELETE of its `product_revision_variants` and `product_images`; the review and the live product point at it. The submitting UPDATE itself is allowed. Editing again means a new revision. A never-submitted draft revision can still be edited or deleted (its variants and images cascade). A revision's `product_id` and `vendor_id` never change. The child triggers lock the revision row (`FOR SHARE`), so a change racing a submit is either seen by the submit check or refused.
- **A product in review has a revision in review**: `status = 'pending_review'` needs `pending_revision_id` (`ck_products_pending_review_has_pending`).
- **Not constrained here**: that an image asset has kind `product_image`, and the other status transitions. Those are Phase 3 rules for the service.

### Reviews

Everything a vendor submits (a brand profile version, a product revision) stays pending until an admin reviews it.

- **A review points at the exact version row**, not at "the profile" or "the product": a real foreign key to a `brand_profiles` row (one row per version) or a `product_revisions` row. So "the version reviewed" is that row's `version`, a later edit cannot change what was reviewed, and the reference is checked by the database. (A polymorphic `subject_id` plus a version number could not be a foreign key.) Each reference is composite with `vendor_id`, so a review and its subject always belong to the same vendor, and a version that has been reviewed cannot be deleted.
- **At most one pending review per version**, by two partial unique indexes. A decided version can be reviewed again, with a new review row.
- **Rules in the database**: a `rejected` review needs a non-empty `reason`; an `approved` or `rejected` one needs `reviewer_id` and `decided_at`; a `withdrawn` one has a time but no reviewer (it is the vendor's); a `pending` one has neither; `decided_at` is not before `submitted_at`.
- **The reviewer** is an identity-api admin: only the UUID is stored, and it always comes from the verified token, never from the request body.
- **A decided review is a record** (migration 0006): a trigger lets a `pending` review change only its decision columns (to `approved`, `rejected` or `withdrawn`); once decided, nothing changes, so a review is never reopened in place. What it reviews (`vendor_id`, `subject`, `brand_profile_id`, `product_revision_id`) and `submitted_by`/`submitted_at` never change, even while pending. Reviews are never deleted: DELETE and TRUNCATE raise.
- **Queue indexes** for Phase 3: pending reviews by `submitted_at` (a partial index), reviews by vendor and status, and by status and `submitted_at`. Plus full indexes on `brand_profile_id` and `product_revision_id` (0006), for the foreign-key checks and "every review of this version".
- **`review_events` cannot be changed**, even by a bug in the application: a trigger raises for every UPDATE and DELETE, and another for TRUNCATE. The application should only ever INSERT; the trigger is the backstop. `vendor_status_events` has the same guards (its TRUNCATE trigger came in 0006).

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
