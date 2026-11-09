# vendor-portal

The seller portal (roadmap Phase 5): Shazlo sellers sign in, edit their brand page, list products, import a
catalogue and follow review decisions. Design decisions are in [docs/ui-plan](../../docs/ui-plan/README.md).

## Run it

```bash
npm ci
npm run dev -w @shazlo/vendor-portal
```

The app starts with a **mock API** in the browser (Mock Service Worker), seeded with the wireframes' seller,
Kalki Studio: 27 products, two sent back, a brand-page draft. Demo sign-in, mock data only:

| Email | Password |
|---|---|
| `kiran@kalkistudio.in` | `ajrakh-indigo-26` |

The set-password screen works with `/set-password?token=invite-kalki-demo`. Mock data persists in
`localStorage`; run `shazloResetDemo()` in the browser console to start over.

To use a real vendor-api instead: `VITE_MOCK_API=off VITE_VENDOR_API_URL=http://localhost:8001 npm run dev -w @shazlo/vendor-portal`.

## How it is built

| Area | Where |
|---|---|
| API contract (portal side, until vendor-api serves its own) | `openapi/vendor-portal.yaml`; routes marked `x-proposal` need agreeing with vendor-api |
| Generated types | `npm run api:types -w @shazlo/vendor-portal` → `src/api/schema.d.ts` |
| Client | `src/api/client.ts` (openapi-fetch; one shared token refresh; error envelope → `ApiError`) |
| Reads and writes | `src/api/queries.ts` (TanStack Query hooks; every cache key and invalidation) |
| Mock API | `src/mocks` (handlers follow the contract; delete each handler when its endpoint ships) |
| Session | `src/auth` ("Keep me signed in" uses localStorage, otherwise the tab's sessionStorage) |
| Shell | `src/shell` (desktop sidebar, phone tab bar, setup banner, notifications) |
| Screens | `src/screens/*` (V-01 to V-09); copy in `src/copy/*` so a translation touches one file per screen |
| Shared components | `packages/ui` (`StatusPill`, `PageHeader`, `StatFigure`, `SectionCard`, `Banner`, `EmptyState`, `Logo`, snackbar) |

## Tests

| Command | What runs |
|---|---|
| `npx vitest run --project vendor-portal` | Unit and integration tests: every screen through the real router, Query client and mock API |
| `npm run e2e -w @shazlo/vendor-portal` | Playwright against the production build: journeys, axe (WCAG 2.1 AA) and screenshots at 1440 px and 390 px |

Screenshot baselines are kept per platform. CI (Linux) writes missing ones and uploads them as an artifact;
commit them under `e2e/__screenshots__/linux/` to turn on comparison.
