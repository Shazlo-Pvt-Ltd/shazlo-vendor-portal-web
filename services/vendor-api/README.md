# vendor-api

FastAPI service for vendors, brand profiles, products, assets, reviews and publishing to the central app. See the [roadmap](../../docs/ROADMAP.md) (Phases 2 to 4), [ADR 0009](../../docs/adr/0009-auth-model.md) for the auth model and [ADR 0010](../../docs/adr/0010-shared-security-package.md) for what it shares with identity-api.

Status: early. The app factory, settings, logging, error handling, database layer, health endpoints, the vendors schema and vendor-api's own signing keys, token issuer, token verifier and JWKS are in place. The login flows and the admin API come in the other Phase 2 issues.

## Run locally

You need Python 3.12+, and Postgres and Redis from the root docker-compose:

```sh
docker compose up -d postgres redis      # from the repository root
cd services/vendor-api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-shared.txt    # packages/py-auth and py-security, from the repository path
pip install -e '.[dev]'
cp .env.example .env                     # put your POSTGRES_PASSWORD into DATABASE_URL
python -m vendor_api.cli generate-key    # writes ./.keys/<kid>.pem; JWT_KEYS_DIR in .env points there
alembic upgrade head
uvicorn vendor_api.main:app --reload --port 8002
```

`curl localhost:8002/health` returns `{"status": "ok"}` and `curl localhost:8002/ready` checks Postgres and Redis. OpenAPI docs are at <http://localhost:8002/docs> unless `ENV=prod`.

The app refuses to start if `DATABASE_URL` or `REDIS_URL` is missing or malformed, or if there is no signing key (see Tokens and keys). If `generate-key` printed a `JWT_SIGNING_KID`, put it in `.env` (it is only needed with more than one key).

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
| `COOKIE_SECURE` / `COOKIE_SAMESITE` / `COOKIE_DOMAIN` | `true` / `strict` / unset | refresh-token cookie; `none` requires `COOKIE_SECURE=true` |
| `JWT_ISSUER` | `http://localhost:8002` | `iss` of the tokens vendor-api issues |
| `JWT_KEYS_DIR` / `JWT_KEYS` | none (one is required) | RS256 keys: a directory of `<kid>.pem` files and/or JSON `{"<kid>": "<PEM>"}` |
| `JWT_SIGNING_KID` | unset | the key that signs; needed with several keys, the others are only published |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | 1 to 3600 |
| `ARGON2_MEMORY_COST_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM` | `19456` / `2` / `1` | password hashing cost (OWASP baseline); raising it rehashes on the next login |
| `PASSWORD_MIN_LENGTH` | `12` | the longest accepted is 128 |
| `EMAIL_VERIFICATION_TTL_MINUTES` | `1440` | how long a verification link works (5 minutes to 7 days) |
| `EMAIL_BACKEND` | `console` | `console` (sends nothing, logs the link in dev only) or `smtp` |
| `EMAIL_FROM` | `Shazlo <no-reply@shazlo.store>` | the sender of every email |
| `SMTP_HOST` / `SMTP_PORT` | unset / `587` | required with `smtp` |
| `SMTP_USER` / `SMTP_PASSWORD` | unset | set both or neither; the password is a secret with no default |
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
- **The owner cannot sign in until the email is verified.** Login (a later issue) must check `email_verified_at`; signup alone grants nothing. Verifying does not approve the vendor: an admin does that (Phase 3), and the vendor stays `pending` until then.
- **Slugs** come from the brand name (accents folded, ASCII letters and digits, hyphens), with `-2`, `-3`, ... on collision. A name with no Latin letters becomes `vendor`, `vendor-2`, ...
- **Not yet limited:** these endpoints have no rate limit until the rate-limiting issue (#84). Until then repeated signups for one address can send that address repeated emails.
- Validation errors name the field and the rule, never the value that was sent.

## Email

Signup verification, staff invites and password reset send email (issue #80). The code depends on a small interface (`EmailSender.send(to, template, context)`) and the provider is a setting: switching from Mailpit to a real provider changes `EMAIL_BACKEND` and `SMTP_*`, not code. Plain SMTP works with SES, Postmark, Resend and most others.

- **Templates** (`services/email/templates.py`, plain text and HTML): `verify_email`, `staff_invite`, `password_reset` and `account_exists`. Each states how long the link lasts. The one-time token goes in the link's **fragment** (`https://<portal>/verify-email#token=...`), which browsers never send to a server, so it stays out of access logs and `Referer` headers. The portal reads it from `location.hash`. Paths: `/verify-email`, `/accept-invite`, `/reset-password`, `/login`.
- **Sending** is `EmailService.send_in_background(background_tasks, to, template, context)`, used through the `Emails` dependency (`api/deps.py`). It runs after the response, tries `EMAIL_SEND_ATTEMPTS` times with a doubling pause, then logs and drops the email. A broken mail server never fails or slows a request.
- **Logs** carry the template name and the kind of error, never the token, the recipient or the provider's reply. Only `ENV=dev` with the console backend prints a link (and the recipient), so a developer can click it.
- **Locally**, `docker compose up -d` runs Mailpit. See every email at <http://localhost:8025>. To see one: `python -m vendor_api.cli send-test-email [--to ADDRESS] [--template verify_email|staff_invite|password_reset|account_exists]` (`ENV=dev` only; the token is made up).

## Database

Async SQLAlchemy 2 with `asyncpg` for the app; Alembic runs on a sync engine (psycopg 3). Migration `0001` is an empty baseline; `0002` adds the vendor and vendor-user tables.

| Table | Notes |
|---|---|
| `vendors` | A company. UUID `id`; `name`; `slug` (unique, `^[a-z0-9]+(-[a-z0-9]+)*$`); `email` (unique, stored trimmed and lower-cased, enforced by a check constraint); `phone`, `contact_name`, `product_type`, `website_or_instagram`; declared price range in **integer paise** (`price_min_paise` >= 0, `price_max_paise` >= min); `status` (`pending` by default, `approved`, `rejected`, `suspended`) with `status_reason`, `status_changed_at` and `status_changed_by` (an identity-api admin id, no foreign key: another database) |
| `vendor_status_events` | **Append-only** audit of every status change: vendor, `from_status` (NULL when the vendor is created), `to_status`, `actor_type` (`admin`, `system`, `vendor`), `actor_id` (required unless the actor is the system), `reason`. A trigger refuses UPDATE and DELETE, and a vendor with events cannot be deleted |
| `vendor_users` | A person who signs in for a vendor. `email` unique across all vendors (trimmed, lower-cased); `password_hash` is NULL until an invite is accepted (only `invited` or `disabled` users may lack one); `role` (`owner`, `staff`; **at most one owner per vendor**, by a partial unique index); `status` (`invited`, `active`, `disabled`); `email_verified_at`, `terms_accepted_at`, `last_login_at` |
| `auth_tokens` | One-time tokens for email verification, invites and password reset. `purpose` (`verify_email`, `invite`, `reset_password`), `token_hash` (unique, must be a 64-character lower-case hex SHA-256), `expires_at`, `used_at`. **The token itself is never stored.** Deleting the user deletes their tokens |

Role, status and purpose values are plain text columns with check constraints, so adding a value is a migration of that constraint. Vendors and users are never deleted (foreign keys are `RESTRICT`): suspend or disable them instead.

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
