# 0011. The Vendor Portal and Shazlo One's Vendors module as two microservices over one vendor database

- Status: proposed
- Date: 2026-11-27
- Related: [0001-iframe-postmessage-protocol.md](0001-iframe-postmessage-protocol.md) (how modules are hosted); [0003-central-app-publishing-contract.md](0003-central-app-publishing-contract.md) (the outbox written with each approval); [0009-auth-model.md](0009-auth-model.md) (audiences and roles); [ROADMAP](../ROADMAP.md) Phases 6 and 7; open PRs #318–#320 and issues #293–#298 (the module on vendor-api's real admin routes)

## Context

Two products work on the same vendor data:

- **The Vendor Portal** (`apps/vendor-portal`): sellers sign up, edit their brand page and send products for review.
- **Shazlo One** (`apps/shazlo-one`): the admin shell. Its **Vendors module** (`apps/vendor-admin`, in an iframe) reviews submissions, accepts, rejects and suspends vendors, agrees commission and watches publishing.

The goal is that the Vendor Portal is its own microservice, never a part of Shazlo One, and that review and vendor management are a microservice *inside* Shazlo One, linked to the portal only through data: a seller submits, the Vendors module decides, the seller sees the decision. More Shazlo One modules will follow, so a failing module must not take the shell down with it.

Before this decision the split existed only in the front ends:

- vendor-api was **one process** serving both `/v1/vendor/*` and `/v1/admin/*`, with **one CORS list** (the portal, the module and the shell together, all with credentials) and **one OpenAPI document**, so the portal's generated types carried every admin route.
- **Admin routers imported seller routers** (`admin_vendors.py` imported `api.commission` and `api.store_details`), and every process in prod had to hold every key: the seller's signing key, the payout key and the rate-limit key in the process that only reviews, and identity-api's settings in the process that only serves sellers.
- **The shell knew about vendors**: a hardcoded Vendors entry and its pages, a vendor API client, vendor cards on Home, and the vendor queue count as the badge of every module.

## Decision

### 1. vendor-api runs as two apps from one package, over one database

| | Seller app | Admin app |
|---|---|---|
| Serves | the Vendor Portal | Shazlo One's Vendors module |
| Entry point | `vendor_api.main:app` (`create_seller_app`) | `vendor_api.admin_main:app` (`create_admin_app`) |
| Port (local) | 8002 | 8004 (compose service `vendor-admin-api`) |
| Routes | `/v1/auth`, `/v1/vendor/*`, `/v1/public/*`, the vendor JWKS, `/health`, `/ready` | `/v1/admin/*`, `/health`, `/ready` |
| Accepts | vendor-api tokens only; it holds no identity-api verifier | identity-api tokens only; it refuses to start without `IDENTITY_*` |
| Holds | the vendor signing key, the payout key, the rate-limit key | none of those: it issues no token, reads payout details masked, and ends vendor sessions through the refresh store alone |
| CORS | `CORS_ALLOWED_ORIGINS`: the portal, with credentials (the refresh cookie) | `ADMIN_CORS_ALLOWED_ORIGINS`: the module and the shell, no credentials, `GET`/`POST` only, https in prod |
| Contract | `services/vendor-api/openapi.json` → `apps/vendor-portal` | `services/vendor-api/openapi.admin.json` → `apps/vendor-admin` and the shell |

Both apps share **one Postgres database, one migration chain and one outbox worker**. An approval still writes its central-app event in the same transaction as the decision (ADR 0003, section 5), and a review still points at the exact frozen revision it approved. Neither group of routers imports the other; what both need lives in `api/common.py` and `api/views.py`, and `tests/test_surface_boundaries.py` enforces it.

Each app checks at startup only the settings it needs: settings no longer require the payout, rate-limit or identity settings in prod for every process; `create_seller_app` and `create_admin_app` refuse to start without their own. The worker needs none of them.

**One database, a login per app.** The seller app, the admin app and the worker log in as three users (`vendor_seller_app`, `vendor_admin_app`, `vendor_worker_app`), each a member of one group role (`vendor_seller`, `vendor_admin`, `vendor_worker`) that holds only that app's table rights; the owner of the tables runs migrations and the CLI and is none of them (migration `0012_app_roles`, `python -m vendor_api.cli db-logins`). The admin app cannot read or change a seller's password or sign-in tokens; the seller app cannot mark an outbox event sent or write the delivery log; the worker reads the catalog and writes only the outbox (and a product's `version`, one column, for reconciliation); no app can truncate a table, disable a trigger or change the schema. Every test runs each app's requests as its role, so a missing right fails in CI. With `ENV=prod`, `/ready` fails and the worker refuses to start if its login is a superuser, owns the tables or may create tables or roles.

This narrows what a bug or a break-in in one app can do, but it does not make the database a boundary between equals: the seller app still writes the rows it submits for review and the admin app the rows it decides, and a down database still stops both apps.

**Settings both apps must share:** the database (each with its own login); `REDIS_URL` (the admin app ends a suspended vendor's sessions in the seller app's refresh store; a different Redis ends nothing, and nothing reports it); `OUTBOX_EVENTS_ENABLED`; `JWT_ISSUER` (the seller app's, so the check that it differs from `IDENTITY_ISSUER` runs in both); SMTP and `PORTAL_BASE_URL` (the admin app emails vendors).

### 2. The audience stays `vendor-api`

ADR 0009 gives each service one audience. The audience names the **logical** service, the vendor domain, which now runs as two deployables. Only the admin app verifies identity-api tokens, and the issuer and the keys still keep vendor and admin tokens apart, so identity-api's `AUDIENCE_ROLES` does not change.

### 3. Shazlo One knows no vendor code

The shell hosts modules through ADR 0001's iframe protocol and learns about each from three sources, which settles ADR 0001's open question of where the registry lives:

- **A trusted registry per environment**, in the shell's build (`apps/shazlo-one/registry/*.json`, chosen with `VITE_SHELL_REGISTRY`): each module's id, URL, exact origin, the audience its token is for, the roles that may open it, and optionally the URL of its summary. These fields decide what the shell trusts, so they never come from the module. The build refuses a registry with a wildcard, a non-https URL outside development, a duplicate, or a base path the shell uses, and builds the shell's `frame-src` and `connect-src` from it.
- **A manifest the module owns**, served at a fixed path of its origin (`/shazlo-module.json`): its title, icon (from an allowlist), home page and navigation links. A module can add a page without a shell release. If the manifest cannot be read, the shell shows the module under its registry title with no sub-links.
- **A summary the module's backend may serve** in one shared shape (`ModuleSummary` in `packages/shell-protocol`): a badge, up to three sections of labelled figures with links into the module, and optionally a list of recent activity naming the identity-api admins who acted (the shell asks identity-api for their names). The shell draws every module's summary the same way on Home and in the sidebar, without knowing what a vendor is. For the Vendors module it is `GET /v1/admin/module-summary` on the admin app, which is why the admin app's CORS list includes the shell's origin (the shell already holds the token it would send).

The shell no longer has a vendor client, vendor types, vendor Home cards or the vendor mock; a test fails if any comes back. The Vendors module's words and links moved into its summary route, which uses the same counts as `GET /v1/admin/summary` from #320. That route stays, for the module's own dashboard. The shared shape still has to be agreed with #320's author.

### 4. Failures stay inside the failing module

- If the Vendors module (its web app or the admin app) is down, Shazlo One keeps working: sign-in, Home, admins and the other modules. The module's route shows "unavailable" after ADR 0001's three attempts, and only its card on Home shows an error.
- The shell gives a manifest or summary request about 5 seconds; a module that hangs counts as failed and never holds up the sidebar or Home.
- A failed or slow summary shows **no badge, never 0**: a 0 would tell an admin there is nothing to review.
- Stopping the admin app leaves the Vendor Portal working; stopping the seller app leaves the Vendors module working.
- **The shared vendor Postgres is the one common failure point.** If it goes down, both vendor apps go down, but Shazlo One stays up: identity-api has its own database.

## Consequences

- Each deployable carries only its own secrets, routes and CORS origins, and a front end's generated types cover only the routes it may call.
- A deployment runs one more process (`vendor-admin-api`) from the same image, and must route `/v1/admin` only to it, never through the seller app's hostname.
- Tests build both apps over one session and one Redis (`tests/support.py`), so a whole flow (a vendor submits, an admin approves) still runs in one test.
- Two committed OpenAPI documents instead of one; `python -m vendor_api.cli export-openapi` writes both and `--check` checks both.
- Two settings must match across the apps (`REDIS_URL`, `OUTBOX_EVENTS_ENABLED`) with nothing to detect a mismatch; the README and this ADR say so.

**Follow-ups:**

- The registry, manifest and summary schemas in `packages/shell-protocol`.
- The shell reading them instead of vendor code, with the failure tests in section 4.
- Hostnames for each deployable (hosting is still open in the ROADMAP).
- A runbook for the local end-to-end check and the failure drill.

## Alternatives considered

- **One vendor-api process, split only in the front ends.** This was the state before. Every process held every key and allowed every origin, and nothing kept the admin routers from depending on the seller routers.
- **A separate review service with its own database.** Review and vendor management would get their own database and sync with vendor-api through events. Rejected:
  - it loses the same-transaction outbox write and the foreign key from a review to the frozen revision it approved;
  - it needs a sync protocol with its own failure modes;
  - it is a large change for a team of three.
- **One login for both apps.** Simpler to run, but either app could then do everything the other can, down to dropping a table. The per-app logins cost a migration, a CLI command and three passwords.
- **A new `vendor-admin-api` audience.** It needs a coordinated change to identity-api's `AUDIENCE_ROLES`, the shell's registry and vendor-api, and buys nothing while only the admin app verifies identity-api tokens.
- **Navigation in the shell's registry instead of a module manifest.** Renaming a module page would then need a shell release, and the shell's config would hold the module's routes.
