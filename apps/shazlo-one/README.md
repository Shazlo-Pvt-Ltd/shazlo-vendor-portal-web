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

## How it works

| Area | Where |
|---|---|
| Session | `src/api/context.tsx`: access token in memory only, restored from the `identity_refresh` cookie, refreshed at 80% of its life, plus a 5-minute token per module from `POST /v1/auth/token` (ADR 0009) |
| Module registry | `src/app/registry.ts`: exact URL and origin, roles, backend audience and sidebar links |
| Iframe host | `src/shell/ModuleHost.tsx`: ADR 0001 handshake, `auth` refresh, title/URL sync, `navigate`, toasts, logout, token requests (once per 30 s), the 10 s / three-attempt failure panels and version check |
| Protocol | `packages/shell-protocol`: envelope, catalogue validation, exact-origin listeners |
| Screens | A-01 sign in, change password, A-02 home, A-11 admins & roles |
