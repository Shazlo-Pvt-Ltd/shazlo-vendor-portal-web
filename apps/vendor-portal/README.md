# vendor-portal

The seller portal (roadmap Phase 5): Shazlo sellers sign in, edit their brand page, list products, import a
catalogue and follow review decisions. Design decisions are in [docs/ui-plan](../../docs/ui-plan/README.md).

## Run it

```bash
npm ci
npm run dev -w @shazlo/vendor-portal
```

The app starts with a **mock API** in the browser (Mock Service Worker), seeded with the wireframes' seller,
Kalki Studio: 27 products, two sent back, a brand-page draft, store details complete except payouts (so
products cannot be sent for review until a payout is saved), commission agreed at 12%, and a size chart for
dresses and kurtas. The seed is described at the top of `src/mocks/db.ts`. Demo sign-in, mock data only:

| Email | Password |
|---|---|
| `kiran@kalkistudio.in` | `ajrakh-indigo-26` |

The set-password screen works with `/set-password?token=invite-kalki-demo`. Mock data persists in
`localStorage` (with the mock's stand-in for the refresh cookie, so a reload stays signed in); run
`shazloResetDemo()` in the browser console to start over.

To use a real vendor-api instead: `VITE_MOCK_API=off VITE_VENDOR_API_URL=http://localhost:8001 npm run dev -w @shazlo/vendor-portal`.

## How it is built

| Area | Where |
|---|---|
| API contract (portal side, until vendor-api serves its own) | `openapi/vendor-portal.yaml`; routes marked `x-proposal` need agreeing with vendor-api |
| Generated types | `npm run api:types -w @shazlo/vendor-portal` → `src/api/schema.d.ts` |
| Client | `src/api/client.ts` (openapi-fetch with `credentials: 'include'`; one shared cookie refresh, one retry on `409 refresh_conflict`; error envelope → `ApiError`) |
| Reads and writes | `src/api/queries.ts` (TanStack Query hooks; every cache key and invalidation) |
| Option lists and rules | `src/lib/catalog.ts` (product types, size-chart groups, sizes, colours, photo slots, submit check, import parsing), `src/lib/storeDetails.ts` (store-details checks and completeness), `src/lib/validators.ts` (IFSC, GSTIN, UPI, PIN, phone), `src/lib/commission.ts`; labels and messages in `src/copy/catalog.ts`. Screens and the mock API both use them |
| Mock API | `src/mocks` (handlers follow the contract; delete each handler when its endpoint ships) |
| Session | `src/auth`, as vendor-api and ADR 0009: the access token in memory only, the refresh token in the HttpOnly `vendor_refresh` cookie. No token in localStorage or sessionStorage. A page load shows "Checking your session…" while the cookie is swapped for an access token |
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
