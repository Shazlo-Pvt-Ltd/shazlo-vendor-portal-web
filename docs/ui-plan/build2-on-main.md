# Build 2 on main: one seller portal on the real vendor-api

Status: decided 21 Nov 2026. Branch `naman/build2-on-main` (from `main`, with `naman/penpot-ui-2` merged in).

## What we are doing

Build 2 is the seller portal's design: every screen, on every screen size, looks and behaves as it does on
`naman/penpot-ui-2` (see `vendor-requirements-and-phone-ux.md`). Main already has a seller portal (PRs
#224–#247) wired to the real `services/vendor-api`. We keep Build 2's screens and replace everything under
them with main's working parts, then rebuild main's extra screens in Build 2's design.

| Keep from Build 2 | Keep from main |
|---|---|
| `src/screens/**`, `src/shell/**`, `src/copy/**`, `src/lib/**` (rules, catalogue, validators), the phone/tablet/desktop layouts, the web-app manifest, the e2e journeys | `src/api/client.ts`, `errors.ts`, `instance.ts`, `session.ts`, `endpoints.ts`; `src/session/**` (in-memory access token, refresh cookie, guards, roles, blocked vendor); `src/security/**` (CSP headers, `SafeImage`, `SafeLink`, `PasswordField`, sensitive state); `src/config/env.ts` and the misconfigured screen; `vercel.json` and `scripts/write-vercel-headers.mjs`; the upload pipeline in `features/uploads/upload.ts` (sign → Cloudinary → register); the lint and source rules |

Main's own screens (`src/features/**`, `src/pages/**`, `src/app/shell/**`, `src/ui/**`, `src/App.tsx`,
`src/app/router.tsx`) are removed once their behaviour lives in a Build 2 screen. Their **rules and tests**
(`features/*/rules.ts`, `money.ts`, `deleteOutcome.ts`, `filters.ts`, `lastVisit.ts` …) move with the
behaviour into Build 2 (`src/lib/` or next to the screen), so nothing main tested is lost.

## The API

- **Real routes** come from `services/vendor-api/openapi.json` (`npm run api:generate -w @shazlo/vendor-portal`
  → `src/api/schema.d.ts`). Never edit that file by hand.
- **Routes Build 2 needs that vendor-api does not have yet** are written in
  `apps/vendor-portal/openapi/proposed.yaml`: OpenAPI 3.1, `/v1/...` paths, the real API's style (snake_case,
  `{error: {code, message, request_id, details}}`, `version` for optimistic concurrency), every operation
  marked `x-proposal: true`. They are generated into `src/api/proposed.d.ts`, and the client is typed with
  both. When vendor-api ships a route, it moves to `openapi.json` and leaves `proposed.yaml`. This file is
  what issue #265 asks the backend to build.
- **Screens never see API shapes.** `src/api/model.ts` holds the view models the Build 2 screens already
  use (product, store details, me, review item …). `src/api/adapters/*.ts` map real/proposed shapes to and
  from them. `src/api/queries.ts` keeps Build 2's hook names and return shapes, implemented with main's
  client. Every adapter has unit tests.
- **Mocks** (`src/mocks/**`) answer the real `/v1` routes and the proposed ones, with Build 2's seed data
  (Kalki Studio and friends) reshaped. They serve the tests and the demo mode (`VITE_MOCK_API=on`, off by
  default; main's `VITE_VENDOR_API_URL` check still applies when it is off). The mock database lives in
  memory only.

### Proposed additions (`proposed.yaml`)

1. **Sign-up.** `SignupRequest` gains `sells` (women|men|both), `city`, and an optional `store_details`
   object (the same sections as below). `product_type`, `price_min_paise` and `price_max_paise` become
   optional: the requirements PDF does not ask for them.
2. **Store details.** `GET /v1/vendor/store-details` → sections `brand`, `contact`, `delivery`, `returns`,
   `payment`, `payout` (always masked), `business`, plus `missing` and `complete`. One
   `PUT /v1/vendor/store-details/{brand|contact|delivery|returns|payment|payout|business}` per section
   (literal paths). `GET /v1/public/ifsc/{code}`.
3. **Commission.** `VendorSummary` (in `Me` and the session) gains `commission`
   `{state: not_set|proposed|sent_back|agreed, agreed_bps, proposed_bps, note}`.
   `POST /v1/vendor/commission/proposal {rate_bps}`. No default rate anywhere.
4. **Products.** `ProductContentBody`/`RevisionOut` gain `main_colour`, `other_colours` (≤ 2). Material is
   the existing `fabric`; product type is the existing `category`. `VariantBody`/`VariantOut` gain `stock`
   (≥ 0). `ImageBody`/`ImageOut` gain `angle` (front|back|detail|worn|extra|tryon) and images go from 10 to
   13 (4 named + 4 extra + 5 try-on). `sku` becomes optional on products and variants (the server makes
   codes; until then the portal makes them, and never shows the word "SKU"). Submitting a product that is
   not ready answers 422 with every missing requirement in `details`.
5. **Size charts.** `GET`/`PUT /v1/vendor/size-charts/{group}` (tops, bottoms, dresses, jackets).
6. **Bulk import.** The import accepts the PDF columns (`product_name, gender, product_type, main_colour,
   other_colours, selling_price, sizes_stock, description, material, mrp`).
7. **Brand profile.** `price_min_paise`/`price_max_paise` become optional on `BrandProfileBody`.

Anything a screen can do with real routes it does with real routes: product counts come from
`GET /v1/vendor/products?status=…&limit=1` totals; review decisions come from `/v1/vendor/submissions`;
bulk actions on products call the single-product routes in turn.

## Session, sign-in and sign-up

- Main's session: access token in memory, refresh token in an HttpOnly cookie, guards
  `PublicOnly`/`RequireAuth`/`RequireRole`, the blocked-vendor page, sign-out clears sensitive state and
  drafts. Build 2's "Keep me signed in" checkbox goes: the refresh cookie already keeps sellers signed in.
- Paths follow main, because vendor-api's emails link to them: `/login`, `/signup`, `/verify-email`,
  `/forgot-password`, `/set-password`, `/reset-password`, `/accept-invite`, `/team`, `/account`. Build 2's
  old paths redirect (`/sign-in` → `/login`, `/apply` → `/signup`, `/review` stays Build 2's Review status
  page and `/submissions` redirects to it).
- Sign-up keeps Build 2's 7 steps and Check your answers. The Contact step adds the password (main's
  `PasswordField` and rules). Sending creates the account (`POST /v1/auth/signup` with the store details),
  then shows main's "Verify your email" flow in Build 2's design. Answers are kept in memory
  (`session/drafts.ts`), not on the device; the copy says so.

## Screens main has that Build 2 did not

Rebuilt in Build 2's design (calm rules, one yellow button, plain words, phone layouts):

- **Verify your email** and **resend verification** (signed-out pages).
- **Blocked vendor** page.
- **Account**: profile and change password (Account hub).
- **Team** (owners only): invite staff, resend an invite, turn a user off/on (Account hub → Team).
- **Review status** uses `/v1/vendor/submissions`, with the reviewer's reasons and main's "new since your
  last visit" marker.
- **Bulk import** keeps Build 2's wizard and gains main's validate-first run and the error CSV download.
- **Product editor** keeps Build 2's steps and gains main's revision panel (what is live vs. your changes)
  and delete rules.

## Rules from main that now cover Build 2's code

- No web storage in app code (lint). The sign-up draft, the sign-in choice and the mock database move to
  memory.
- No hex, `rgb()`/`hsl()` colour or font family in app code (`noHardcodedStyle.test.ts`). Colour swatches
  for the catalogue move into `packages/ui`.
- Vendor-typed URLs and images go through `SafeLink`/`SafeImage`; no HTML from strings.
- CSP: images only from `'self'`, `blob:` and Cloudinary; no `data:` URIs, including in demo mode.

## Not in this branch

- The admin (`apps/vendor-admin`) and Shazlo One keep Build 2's mock-backed screens. Wiring them to
  vendor-api's admin routes is its own task.
