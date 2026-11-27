# shazlo-one

The Shazlo One admin shell (roadmap Phase 6): admin sign-in against identity-api, the module registry, the
iframe host for each service's admin UI, and admin management. Built in the same design language as the
seller portal ([docs/ui-plan](../../docs/ui-plan/README.md)), with Shazlo One's navy chrome.

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

identity-api is mocked in the browser (MSW), using the same routes and envelopes as `services/identity-api`.
Demo accounts, mock data only:

| Account | Password | Notes |
|---|---|---|
| `naman@shazlo.store` | `shazlo-one-2026` | super admin |
| `priya@shazlo.store` | `shazlo-one-2026` | vendor reviewer |
| `sneha@shazlo.store` | `welcome-sneha-01` | invited; must choose a password first |

`shazloOneResetDemo()` in the console resets the identity mock; `POST http://localhost:5194/__reset` resets vendor-api.
With the identity mock on, the shell is built with `registry/mock.json`, so Home and the Vendors badge read
the mock vendor-api's summary on :5194.

## Run it on the real identity-api

The shell is mocked in the browser unless `VITE_MOCK_API=off`. To use a local identity-api instead:

```bash
docker compose up -d identity-api            # identity-api on :8001 (see services/identity-api/README.md)
# the shell and the refresh cookie need these two settings on identity-api:
#   CORS_ALLOWED_ORIGINS=http://localhost:5192,http://localhost:4192
#   COOKIE_SECURE=false                       # local http only; never in production
echo "VITE_MOCK_API=off" > apps/shazlo-one/.env.local
npm run dev -w @shazlo/shazlo-one            # the shell on :5192
```

**Same origin, not CORS.** With the mock off the shell calls `/v1/...` on its own origin, and Vite (dev on
:5192, preview on :4192) forwards `/v1` to `VITE_IDENTITY_PROXY_TARGET` (default `http://localhost:8001`).
The `identity_refresh` cookie is then first-party, so identity-api's `SameSite=Strict` default works and no
cross-origin cookie setup is needed. identity-api still checks the `Origin` header on the cookie routes
(login, refresh, logout), which is why the two origins above go in `CORS_ALLOWED_ORIGINS`. To call identity-api
cross-origin instead, set `VITE_IDENTITY_API_URL`, add the shell's origin to `CORS_ALLOWED_ORIGINS` and use
`COOKIE_SAMESITE=none` with HTTPS.

**First admin.** identity-api creates its roles and one `super_admin` with its CLI; that admin must change the
password at the first sign-in:

```bash
cd services/identity-api
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='<at least 12 characters>' python -m identity_api.cli seed
```

Sign in with it, then invite a `vendor_reviewer` from **Admins**. With `VITE_MOCK_API=off` the shell is built
with `registry/development.json`, which reads the Vendors summary from vendor-api's **admin app**
(ADR 0011): `docker compose --profile vendor up -d` serves it as `vendor-admin-api` on `http://localhost:8004`
(not 8002, the seller app, which has no `/v1/admin` routes). Its `ADMIN_CORS_ALLOWED_ORIGINS` default already
lists the shell (:5192) and the module (:5193).

## The module registry

A module is an entry in a registry file, built into the shell. `VITE_SHELL_REGISTRY` names the file; without
it, `npm run dev` uses `registry/mock.json` (identity mocked) or `registry/development.json` (`VITE_MOCK_API=off`).
A production build needs `VITE_SHELL_REGISTRY` and fails without it.

```json
[{ "id": "vendor-admin", "fallbackTitle": "Vendors", "basePath": "/vendors", "url": "https://vendors.shazlo.store/",
   "roles": ["vendor_reviewer", "super_admin"], "audience": "vendor-api",
   "summaryUrl": "https://vendor-admin-api.shazlo.store/v1/admin/module-summary" }]
```

- The registry holds only what decides trust: the exact URL (its origin is the only one the shell talks to
  for that module), the roles that may open it and the audience of the token it gets. The build fails on a
  wildcard, http outside development, credentials, a query, a duplicate id, origin or base path, a base path
  the shell uses (`/admins`, `/sign-in`, `/change-password`, `/m`) or the `identity-api` audience.
- The dev and preview servers send a CSP built from it: `frame-src` the module origins, `connect-src` those,
  the summary origins and identity-api, and `frame-ancestors 'none'`. Production hosting must send the same.
- The **manifest** (`<module url>/shazlo-module.json`, no token) gives the module's title, icon and pages. The
  module serves it with CORS for the shell. Without it the module shows under `fallbackTitle` with no pages.
- The **summary** (`summaryUrl`, with the module's token) gives the sidebar badge and the module's Home cards.
  One that fails or takes over 5 seconds shows an error on that module's card and no badge, never a 0.

## How it works

| Area | Where |
|---|---|
| Session | `src/api/context.tsx`: access token in memory only, restored from the `identity_refresh` cookie, refreshed at 80% of its life, plus a 5-minute token per module from `POST /v1/auth/token` (ADR 0009) |
| Module registry | `registry/*.json`, checked by `vite.config.ts` and again in `src/app/registry.ts`, which merges each entry with its manifest |
| Manifests and summaries | `src/api/modules.ts` (5 s limit, one new token on a 401), drawn by `src/shell/ShellLayout.tsx` (sidebar) and `src/screens/home/ModuleCards.tsx` (Home) |
| Iframe host | `src/shell/ModuleHost.tsx`: ADR 0001 handshake, `auth` refresh, title/URL sync, `navigate`, toasts, logout, token requests (once per 30 s), the 10 s / three-attempt failure panels and version check |
| Protocol | `packages/shell-protocol`: envelope, catalogue validation, exact-origin listeners, and the registry, manifest and summary schemas |
| Tests | Against two stand-in modules (`src/test/registry.json`, `src/test/modules.ts`), never a real one; `src/app/noVendorCode.test.ts` fails if vendor code comes back |
| Screens | A-01 sign in, change password, A-02 home, A-11 admins & roles |
