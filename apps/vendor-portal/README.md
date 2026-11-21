# vendor-portal

The seller portal (roadmap Phase 5): Shazlo sellers sign in, edit their brand page, list products, import a
catalogue and follow review decisions. Design decisions are in [docs/ui-plan](../../docs/ui-plan/README.md).

## Run it

```bash
npm ci
npm run dev -w @shazlo/vendor-portal
```

It talks to vendor-api at `VITE_VENDOR_API_URL` (required). For a demo without vendor-api, start it with
`VITE_MOCK_API=on VITE_VENDOR_API_URL=http://localhost:8002 npm run dev -w @shazlo/vendor-portal`: a Mock
Service Worker answers vendor-api's routes (and the proposed ones) from memory, seeded with the wireframes'
seller, Kalki Studio: 27 products, two sent back, a brand-page draft, store details complete except payouts
(so products cannot be sent for review until a payout is saved), commission agreed at 12%, and a size chart
for dresses and kurtas. The seed is described at the top of `src/mocks/db.ts`. Nothing is stored on the
device: a reload starts the demo again and asks to sign in. Demo sign-in, mock data only:

| Email | Password | |
|---|---|---|
| `kiran@kalkistudio.in` | `ajrakh-indigo-26` | owner |
| `meera@kalkistudio.in` | `block-print-staff-26` | staff |
| `ruchi@ruchiprints.in` | `suspended-shop-26` | a suspended brand (shows the blocked page) |

The invite link `/accept-invite?token=invite-kalki-demo` sets a password for the invited staff member.

## How it is built

| Area | Where |
|---|---|
| API contract | vendor-api's `services/vendor-api/openapi.json`, plus what the portal still needs from it in `openapi/proposed.yaml` (every route and field marked `x-proposal`; issue #265) |
| Generated types | `npm run api:generate -w @shazlo/vendor-portal` → `src/api/schema.d.ts`; `npm run api:proposed` → `src/api/proposed.d.ts` (never edit either by hand) |
| Client | `src/api/client.ts` (openapi-fetch, typed with the real and proposed routes; one shared token refresh; error envelope → `ApiError`) |
| Reads and writes | `src/api/queries.ts` (TanStack Query hooks; every cache key and invalidation). Screens see only the view models in `src/api/model.ts`; `src/api/adapters/*` translate to and from vendor-api |
| Option lists and rules | `src/lib/catalog.ts` (product types, size-chart groups, sizes, colours, photo slots, submit check, import parsing), `src/lib/storeDetails.ts` (store-details checks and completeness), `src/lib/validators.ts` (IFSC, GSTIN, UPI, PIN, phone), `src/lib/commission.ts`; labels and messages in `src/copy/catalog.ts`. Screens and the mock API both use them |
| Mock API | `src/mocks`: vendor-api's real and proposed routes, in memory only (tests, and the demo with `VITE_MOCK_API=on`); `src/mocks/contract.test.ts` checks every answer against the contract |
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
