# shazlo-one

The Shazlo One admin shell (roadmap Phase 6): admin sign-in against identity-api, the module registry, the
iframe host for each service's admin UI, and admin management. Built in the same design language as the
seller portal ([docs/ui-plan](../../docs/ui-plan/README.md)), with Shazlo One's navy chrome.

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

## Run it on the real identity-api

The shell is mocked in the browser unless `VITE_MOCK_API=off`. To use a local identity-api instead:

```bash
# in the repository's .env (docker compose passes it to identity-api as CORS_ALLOWED_ORIGINS):
#   IDENTITY_CORS_ALLOWED_ORIGINS=http://localhost:5192,http://localhost:4192
#   IDENTITY_JWT_KEYS=...                     # see services/identity-api/README.md
docker compose up -d identity-api            # identity-api on :8001
echo "VITE_MOCK_API=off" > apps/shazlo-one/.env.local
npm run dev -w @shazlo/shazlo-one            # the shell on :5192
```

The refresh cookie is `Secure` by default, which Chrome and Firefox accept on `http://localhost`. For Safari, run
identity-api outside compose with `COOKIE_SECURE=false` (local http only; `ENV=prod` refuses it).

**Same origin, not CORS.** With the mock off the shell calls `/v1/...` on its own origin, and Vite (dev on
:5192, preview on :4192) forwards `/v1` to `VITE_IDENTITY_PROXY_TARGET` (default `http://localhost:8001`).
The `identity_refresh` cookie is then first-party, so identity-api's `SameSite=Strict` default works and no
cross-origin cookie setup is needed. identity-api still checks the `Origin` header on the cookie routes
(login, refresh, logout), which is why the two origins above go in `CORS_ALLOWED_ORIGINS`. To call identity-api
cross-origin instead, set `VITE_IDENTITY_API_URL` and add the shell's origin to `CORS_ALLOWED_ORIGINS`; only if
the two are on different sites (ports do not count) does the cookie also need `COOKIE_SAMESITE=none` and HTTPS.

**First admin.** identity-api creates its roles and one `super_admin` with its CLI; that admin must change the
password at the first sign-in:

```bash
docker compose exec -e SEED_ADMIN_EMAIL=admin@example.com -e SEED_ADMIN_PASSWORD='<at least 12 characters>' \
  identity-api python -m identity_api.cli seed
# or, with identity-api running from services/identity-api in its venv:
#   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... python -m identity_api.cli seed
```

Sign in with it, then invite a `vendor_reviewer` from **Admins**. The Vendors module also needs vendor-api
(`VITE_VENDOR_API_URL`), which is the next sub-issue (#293).

## How it works

| Area | Where |
|---|---|
| Session | `src/api/context.tsx`: access token in memory only, restored from the `identity_refresh` cookie, refreshed at 80% of its life (a `409 refresh_conflict` from another tab is retried once; offline, `429` or `5xx` keeps a signed-in session), plus a 5-minute token per module from `POST /v1/auth/token` (ADR 0009) |
| Module registry | `src/app/registry.ts`: exact URL and origin, roles, backend audience and sidebar links |
| Iframe host | `src/shell/ModuleHost.tsx`: ADR 0001 handshake, `auth` refresh, title/URL sync, `navigate`, toasts, logout, token requests (once per 30 s), the 10 s / three-attempt failure panels and version check |
| Protocol | `packages/shell-protocol`: envelope, catalogue validation, exact-origin listeners |
| Screens | A-01 sign in, change password, A-02 home, A-11 admins & roles |
