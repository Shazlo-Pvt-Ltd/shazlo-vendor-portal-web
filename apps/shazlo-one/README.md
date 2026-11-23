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
| Module registry | `src/app/registry.ts`: exact URL and origin, roles, backend audience, the page a module opens on (`home`: Vendors opens on `/vendors/dashboard`) and its pages (`links`, with `also` prefixes such as `/review` for the queue). `moduleTarget()` turns a shell URL into the module page it shows (the bare `/vendors` is the dashboard), and `currentLink()` / `isModuleHome()` decide which page is current, so the iframe, the sidebar and the top bar always agree |
| Navigation | `src/shell/ShellLayout.tsx`: the navy sidebar (a phone drawer below 900 px) lists each module with its pages nested under it; the module row opens its dashboard and is current there. Inside a module the top bar also lists its pages (`src/shell/ModuleNav.tsx`, "Vendors pages") in a 48 px row under the crumbs, scrolling sideways on phones. `src/shell/metrics.ts` holds the header heights behind `--shell-top`, which sizes the module iframe |
| Iframe host | `src/shell/ModuleHost.tsx`: ADR 0001 handshake, `auth` refresh, title/URL sync, `navigate` (a page picked while the module is still loading is kept: the module is sent there once it names its first page), toasts, logout, token requests (once per 30 s), the 10 s / three-attempt failure panels and version check |
| Protocol | `packages/shell-protocol`: envelope, catalogue validation, exact-origin listeners |
| Screens | A-01 sign in, change password, A-02 home, A-11 admins & roles |
