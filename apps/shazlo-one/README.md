# shazlo-one

The Shazlo One admin shell (roadmap Phase 6): admin sign-in against identity-api, the module registry, the
iframe host for each service's admin UI, and admin management. Built in the same design language as the
seller portal ([docs/ui-plan](../../docs/ui-plan/README.md)), with Shazlo One's navy chrome. It is the shell
from Build 2 (#301), which replaced the first Phase 6 shell; that shell's audited hardening was ported into it
([ADR 0001](../../docs/adr/0001-iframe-postmessage-protocol.md), "Which shell implements this").

The shell knows no module's code ([ADR 0011](../../docs/adr/0011-vendor-portal-and-vendors-module-as-microservices.md)).
It learns about each module from the registry it was built with, the module's manifest and the module
backend's summary, so a module (the Vendors module today) ships without a shell release.

## Run it (with the Vendors module)

```bash
npm ci
npm run serve -w @shazlo/mock-vendor-api      # vendor-api admin routes on :5194 (shared by shell and module)
npm run dev -w @shazlo/vendor-admin           # the Vendors module on :5193
npm run dev -w @shazlo/shazlo-one             # the shell on :5192
```

On the dev server identity-api is mocked in the browser (MSW), using the same routes, envelopes and error
codes as `services/identity-api` (`src/mocks/contract.test.ts` checks them against its `openapi.json`).
Demo accounts, mock data only:

| Account | Password | Notes |
|---|---|---|
| `naman@shazlo.store` | `shazlo-one-2026` | super admin |
| `priya@shazlo.store` | `shazlo-one-2026` | vendor reviewer |
| `sneha@shazlo.store` | `welcome-sneha-01` | invited; must choose a password first |

`shazloOneResetDemo()` in the console resets the identity mock; `POST http://localhost:5194/__reset` resets vendor-api.
With the identity mock on, the shell is built with `registry/mock.json`, so Home and the Vendors badge read
the mock vendor-api's summary on :5194. On the dev server the mock keeps its state in `localStorage` so a reload
keeps you signed in; no build does (`src/mocks/browser.ts`).

## Settings (they fail closed)

`src/config/env.ts` checks every setting when the shell is built or served (`vite.config.ts` fails with every
problem listed) and again when the page starts (a bad one shows "Shazlo One is not set up correctly" instead of a
half-working shell). `.env.example` lists them.

| Setting | Development (`npm run dev`) | Production build |
|---|---|---|
| `VITE_MOCK_API` | unset or `on`: the browser mock; `off`: the real identity-api | unset or `off`: no mock. Only `on`, by name, builds a demo with the mock and its demo passwords. Any other value fails |
| `VITE_IDENTITY_API_URL` | optional: without it the shell calls its own origin and Vite forwards `/v1` (below) | required (unless a demo): identity-api's https origin with a plain host (letters, digits, dots, hyphens), no path, query or credentials |
| `VITE_SHELL_REGISTRY` | optional: `registry/mock.json` with the mock, `registry/development.json` without | required: a registry of exact https URLs (`registry/example.production.json` is the one CI builds with) |

The mock sits behind a build-time constant (`__MOCK_API__`), so a production build without it contains none of
its code, its handlers, the demo passwords or `mockServiceWorker.js`. `src/security/build.test.ts` builds the
shell and checks that, and CI greps the build for the demo passwords.

## Run it on the real identity-api

```bash
# in the repository's .env (docker compose passes it to identity-api as CORS_ALLOWED_ORIGINS; it is also the default):
#   IDENTITY_CORS_ALLOWED_ORIGINS=http://localhost:5192,http://localhost:4192
#   IDENTITY_JWT_KEYS=...                     # see services/identity-api/README.md
docker compose up -d identity-api            # identity-api on :8001
echo "VITE_MOCK_API=off" > apps/shazlo-one/.env.local
npm run dev -w @shazlo/shazlo-one            # the shell on :5192
```

The refresh cookie is `Secure` by default, which Chrome and Firefox accept on `http://localhost`. For Safari, run
identity-api outside compose with `COOKIE_SECURE=false` (local http only; `ENV=prod` refuses it).

**Same origin, not CORS.** Without `VITE_IDENTITY_API_URL` the shell calls `/v1/...` on its own origin, and Vite
(dev on :5192, preview on :4192) forwards `/v1` to `VITE_IDENTITY_PROXY_TARGET` (default `http://localhost:8001`).
The `identity_refresh` cookie is then first-party, so identity-api's `SameSite=Strict` default works and no
cross-origin cookie setup is needed. identity-api still checks the `Origin` header on the cookie routes
(login, refresh, logout), which is why the two origins above go in `CORS_ALLOWED_ORIGINS`. To call identity-api
cross-origin instead, set `VITE_IDENTITY_API_URL` and add the shell's origin to `CORS_ALLOWED_ORIGINS`
(identity-api exposes `X-Request-ID` and `Retry-After` to it); only if the two are on different sites (ports do not
count) does the cookie also need `COOKIE_SAMESITE=none` and HTTPS.

**First admin.** identity-api creates its roles and one `super_admin` with its CLI; that admin must change the
password at the first sign-in:

```bash
docker compose exec -e SEED_ADMIN_EMAIL=admin@example.com -e SEED_ADMIN_PASSWORD='<at least 12 characters>' \
  identity-api python -m identity_api.cli seed
# or, with identity-api running from services/identity-api in its venv:
#   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... python -m identity_api.cli seed
```

Sign in with it, then invite a `vendor_reviewer` from **Admins**. With `VITE_MOCK_API=off` the shell is built
with `registry/development.json`, which reads the Vendors summary from vendor-api's **admin app**
(ADR 0011): `docker compose --profile vendor up -d` serves it as `vendor-admin-api` on `http://localhost:8004`
(not 8002, the seller app, which has no `/v1/admin` routes). Its `ADMIN_CORS_ALLOWED_ORIGINS` default already
lists the shell (:5192) and the module (:5193), without credentials.

## The module registry

A module is an entry in a registry file, built into the shell. `VITE_SHELL_REGISTRY` names the file (above).

```json
[{ "id": "vendor-admin", "fallbackTitle": "Vendors", "basePath": "/vendors", "url": "https://vendors.shazlo.store/",
   "roles": ["vendor_reviewer", "super_admin"], "audience": "vendor-api",
   "summaryUrl": "https://vendor-admin-api.shazlo.store/v1/admin/module-summary" }]
```

- The registry holds only what decides trust: the module's origin (its `url`, with no path: the only origin the
  shell frames and talks to for that module), the roles that may open it and the audience of the token it gets.
  The build fails on a wildcard or pattern, http outside development (plain http only for localhost in
  development), a host with anything but letters, digits, dots and hyphens, credentials, a query, a duplicate id,
  origin or base path, a base path the shell uses (`/admins`, `/sign-in`, `/change-password`, `/m`) or the
  `identity-api` audience.
- The **manifest** (`<module url>/shazlo-module.json`, no token) gives the module's title, icon and pages. The
  module serves it with CORS for the shell. Without it the module shows under `fallbackTitle` with no pages.
- The **summary** (`summaryUrl`, with a token of its own) gives the sidebar badge and the module's Home cards.
  One that fails or takes over 5 seconds shows an error on that module's card and no badge, never a 0.

## Security headers

`src/security/headers.ts` is the one policy, used by the dev server, `vite preview` and production:
`frame-ancestors 'none'` (and `X-Frame-Options: DENY`), scripts, images and fonts only from the shell (inline
script only on the dev server, for React's refresh), `connect-src` only identity-api and the modules' manifest and
summary origins (`'self'` only when identity-api is reached through the shell's own origin), `frame-src` only the
registry's origins (`'none'` without any), no workers except the demo's mock, and HSTS with
`upgrade-insecure-requests` in production. `npm run build` first runs `scripts/write-vercel-headers.mjs`: on
Vercel it writes `vercel.json`'s headers for that build's identity-api origin and registry (and fails on a bad
one); elsewhere it leaves the committed file, which holds the policy for the placeholder origin and no modules
(`npm run headers:placeholder` rewrites it, and a test keeps it in step).

## Security rules

The same lint rules as the vendor portal and the Vendors module (`eslint.config.js`): no web storage, no HTML
built from a string, no `eval`, and no console call but `console.error`. `src/security/rules.test.ts` checks that
the rules reach the shell, and checks the sources directly (the one storage exception is the dev-server mock).
What a module sends (a title, a toast, a fatal error's message) is shown as plain text, cut to a few lines.

## How it works

| Area | Where |
|---|---|
| Session | `src/session/store.ts` (from the first Phase 6 shell): the identity-api access token in memory only, restored from the `identity_refresh` cookie and renewed at 80% of its life by one shared refresh (a `409 refresh_conflict` from another tab is retried once; offline, `408`, `429` or `5xx` keeps a signed-in session, and on load shows "cannot reach its sign-in service" with Try again). Sign-out in one tab ends every tab (`BroadcastChannel`, only the words `login` and `logout`); a refresh that answers after a sign-out is thrown away; another admin or new roles clear the caches and module tokens; session and token answers are checked (a token, a lifetime above 0 and at most a day). Module tokens (`POST /v1/auth/token`, ADR 0009) are kept per module and dropped with its page. `src/api/context.tsx` wires it to the identity-api client and reads the session again on any `403` (at most every 10 s) |
| Sign-in links | `src/session/returnTo.ts`: `?next=` must be Home, Admins & roles or a registered module's page; anything else (another site, `//host`, `/\host`, a control character) goes to Home |
| Module registry | `registry/*.json`, checked by `vite.config.ts` and again in `src/app/registry.ts`, which merges each entry with its manifest: the page a module opens on (`home`; Vendors opens on its dashboard) and its pages (`links`, with `also` prefixes such as `/review` for a queue). `moduleTarget()` turns a shell URL into the module page it shows (the bare base path is the home page), and `currentLink()` / `isModuleHome()` decide which page is current, so the iframe, the sidebar and the top bar always agree |
| Manifests and summaries | `src/api/modules.ts` (5 s limit, one new token on a 401), drawn by `src/shell/ShellLayout.tsx` (sidebar), `src/shell/ModuleNav.tsx` (top bar) and `src/screens/home/ModuleCards.tsx` (Home) |
| Navigation | `src/shell/ShellLayout.tsx`: the navy sidebar (a phone drawer below 900 px) lists each module with its pages nested under it; the module row opens its home page and is current there. Inside a module the top bar also lists its pages (`src/shell/ModuleNav.tsx`, "<title> pages") in a 48 px row under the crumbs, scrolling sideways on phones, once the manifest has named them. `src/shell/metrics.ts` holds the header heights behind `--shell-top`, which sizes the module iframe. Focus moves to the page heading when the admin goes to another page or module, never while a module moves between its own pages |
| Iframe host | `src/shell/ModuleHost.tsx`, one `HostedFrame` per load: the channel listens before the frame has an address; the frame loads the module path of the URL, kept on the module's origin (`frameSrc`); `auth` after `ready`, refreshed at 80% of the token's life or 30 s before its end with backoff (5, 15, 30 s) when that fails; title/URL sync and `navigate` (a page picked while the module is still loading is kept); toasts; one sign-out however often a module sends `logout`; `token:request` answered once per 30 s and only once it holds a token; a replayed `ready` gets the held token; the 10 s / three-attempt failure panels, the version check, the 403 page for `audience_not_allowed`, and no frame for a module on the shell's own origin (`src/shell/refreshSchedule.ts`, `src/shell/moduleText.ts`) |
| Admin management | `src/screens/Admins.tsx` and `src/screens/admins/*`: paged (50 a page, the page in the address; one past the end moves to the last), refusals in words next to their control (`refusals.ts`: `cannot_deactivate_self`, `last_super_admin`, `admin_not_found`), unbiased temporary passwords that leave the mutation cache as soon as the request ends |
| Protocol | `packages/shell-protocol`: `createShellChannel` (exact origin and frame window, 64 KB, strict envelope, hand-written validators) and the registry, manifest and summary schemas |
| Tests | Against two stand-in modules (`src/test/registry.json`, `src/test/modules.ts`), never a real one; module messages are delivered with the module's origin and window (`src/test/frames.ts`). `src/shell/host.test.tsx` holds the host's hostile cases, `src/session/store.test.ts` the session's, `src/security/*.test.ts` the headers, lint rules and real builds; `src/app/noVendorCode.test.ts` fails if vendor code comes back. The browser tests (`e2e/`, below) frame the real Vendors module against the real APIs |
| Screens | A-01 sign in, change password, A-02 home, A-11 admins & roles |

## End-to-end tests

`e2e/` holds Playwright tests (Chromium, with axe) of the shell against the real stack: identity-api,
vendor-api's admin app (`vendor-admin-api`), Postgres, Redis and Mailpit from the repository's
`docker-compose.yml`. Playwright starts the shell (5192, `VITE_MOCK_API=off`, so it uses
`registry/development.json` and reaches identity-api through its own origin) and the Vendors module
(`apps/vendor-admin` on 5193, calling vendor-admin-api on 8004) as Vite dev servers. Each test makes its
own admin through identity-api with a temporary password, using the seeded super admin only for that.

| File | What it checks |
|---|---|
| `journey.spec.ts` | Sign-in, the forced first-login password change (every page holds a new admin there), Home with the module's summary, opening the module (its frame address and sandbox, a vendor-admin-api `200` with the token the shell sent), the title, address and crumbs following the module, a deep link after a reload, a refused password |
| `session.spec.ts` | With the browser clock moved 4 min 30 s, a fresh module token is exchanged and the module's next call uses it; sign-out in one tab ends the other tab's session and removes its frame; Back after sign-out brings nothing back |
| `security.spec.ts` | Forged `title`, `toast` and `logout` from the shell's own window and from another origin's window are ignored (checked after a real toast from the module, with a watcher for a forged toast the real one replaced); the shell refuses to be framed (`frame-ancestors 'none'`, `X-Frame-Options`, and a real frame checked after its `load`); the module refuses any framer but the shell; no token in an address, a `Referer`, web storage or a readable cookie |
| `roles.spec.ts` | A vendor reviewer gets the 403 page for Admins & roles (and no admin route is called), opens the Vendors module, and loses the session when deactivated; a super admin sees the list |
| `accessibility.spec.ts` | axe, WCAG 2.1 A and AA (serious and critical fail): sign-in, the password change, Home, a module page (the shell around the frame), Admins & roles, the invite dialog, the 403 page |

CI runs them in `.github/workflows/e2e-shazlo-one.yml` on changes to the shell, the module, the protocol,
the APIs or the compose files. On a laptop with Docker, from the repository root (bash):

```bash
cp .env.example .env                       # then set POSTGRES_PASSWORD in it
docker compose --profile identity --profile vendor build
# Both signing keys into .env, each from its own image (the root README, "Local development", explains them):
gen='import json; from shazlo_security.keys import generate_private_key, new_kid, private_key_pem; print(json.dumps({new_kid(): private_key_pem(generate_private_key()).decode()}, separators=(",", ":")))'
identity=$(docker compose --profile identity run --rm --no-deps -T identity-api python -c "$gen")
vendor=$(docker compose --profile vendor run --rm --no-deps -T vendor-api python -c "$gen")
grep -v -e '^IDENTITY_JWT_KEYS=' -e '^VENDOR_JWT_KEYS=' .env > .env.new
printf 'IDENTITY_JWT_KEYS=%s\nVENDOR_JWT_KEYS=%s\n' "$identity" "$vendor" >> .env.new && mv .env.new .env
docker compose up -d --wait postgres redis mailpit
docker compose --profile identity run --rm identity-api alembic upgrade head
docker compose run --rm vendor-cli alembic upgrade head
docker compose run --rm vendor-cli python -m vendor_api.cli db-logins
# The admin the tests create their admins with, and the demo vendor whose waiting products fill the review queue:
docker compose --profile identity run --rm -e SEED_ADMIN_EMAIL=admin@shazlo.test \
  -e SEED_ADMIN_PASSWORD=e2e-admin-password-1 identity-api python -m identity_api.cli seed
docker compose run --rm -e SEED_VENDOR_PASSWORD=e2e-vendor-password-1 vendor-cli python -m vendor_api.cli seed-dev
docker compose --profile identity --profile vendor up -d --wait

cd apps/shazlo-one
npm run e2e:install                        # Chromium, once
npm run e2e                                # or: npx playwright test journey.spec.ts --headed
```

The first run changes the seeded admin's password from `E2E_ADMIN_SEED_PASSWORD` to
`E2E_ADMIN_PASSWORD` (defaults in `e2e/support/env.ts`, with the other `E2E_*` settings). Stop the dev
servers on 5192 and 5193 first, or Playwright reuses them as they are (their settings must match the
above). `docker compose --profile identity --profile vendor down -v` removes the stack and its data.

The attacker's pages in `security.spec.ts` are served for real on 127.0.0.1 (`e2e/support/evil.ts`), not
faked with `page.route`: Chromium treats a routed page on a made-up host as a public site, and its local
network access rules then block it from framing localhost at all, which would hide whether the shell
refused. A control frame from a second attacker origin shows that framing works there.

Two limits. The clock test moves the browser's clock only, so it proves the shell's refresh schedule and
the module's use of the new token, not server-side expiry. Most Vendors module screens still call the
mock-only `/api/v1/admin/*` routes (until #294 to #298), so the tests use its review queue and
dashboard, which read vendor-admin-api's real `/v1/admin/queue`.
