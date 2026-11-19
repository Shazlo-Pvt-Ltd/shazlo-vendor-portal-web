# vendor-portal

React + TypeScript (Vite) app where vendors sign up, personalise their brand page and list products.
It talks only to [vendor-api](../../services/vendor-api/README.md). Phase 5 of the
[roadmap](../../docs/ROADMAP.md) builds it; this is the scaffold the other screens plug into.

Stack: React 19, TypeScript (strict), Vite, MUI through the shared [`@shazlo/ui`](../../packages/ui)
theme, React Router, TanStack Query.

## Running it

```sh
npm ci                                   # at the repository root
cp apps/vendor-portal/.env.example apps/vendor-portal/.env.local
npm run dev -w @shazlo/vendor-portal     # http://localhost:5174
```

The portal needs a running vendor-api. The simplest way is compose, which also starts Postgres,
Redis and Mailpit (the emails vendor-api sends are readable at <http://localhost:8025>):

```sh
cp .env.example .env                     # set POSTGRES_PASSWORD
docker compose --profile vendor up -d --build
docker compose --profile vendor run --rm vendor-api alembic upgrade head
docker compose --profile vendor run --rm vendor-api python -m vendor_api.cli seed-dev   # a demo vendor
```

vendor-api's `CORS_ALLOWED_ORIGINS` must contain the portal's exact origin; compose already sets
`http://localhost:5174`, which is why the dev server insists on that port (`strictPort`). The refresh
cookie is `SameSite=Strict`, so the portal and the API must be the same site (both on `localhost`).
Safari does not treat `localhost` as secure: set `COOKIE_SECURE=false` for vendor-api there.

## Settings

| Variable | Meaning |
| --- | --- |
| `VITE_VENDOR_API_URL` | Required. The vendor-api origin, for example `http://localhost:8002`: no path, no credentials, `https` outside development. It is compiled into the build, so it is public: never put a secret in it. |

A missing or invalid value shows a "The portal is misconfigured" screen that says what is wrong (and
never prints the value), instead of a blank page. `src/config/env.ts` has the rules.

## Commands (from the repository root)

| Command | What it does |
| --- | --- |
| `npm run dev -w @shazlo/vendor-portal` | Dev server on port 5174 |
| `npm run build -w @shazlo/vendor-portal` | Typecheck, then a production build in `apps/vendor-portal/dist` |
| `npm run typecheck -w @shazlo/vendor-portal` | `tsc` only |
| `npx vitest run --project vendor-portal` | The portal's tests (jsdom, Testing Library) |
| `npm run lint` | ESLint for the whole repository |
| `npm run api:generate -w @shazlo/vendor-portal` | Rewrites `src/api/schema.d.ts` from `services/vendor-api/openapi.json` |
| `npm run api:check -w @shazlo/vendor-portal` | Fails when `schema.d.ts` is stale |

CI runs lint, `api:check`, typecheck, the tests and the build (`apps-ci.yml`).

## Layout and conventions

```
src/
  main.tsx            entry: fonts, then <App />
  App.tsx             checks the environment, then the router
  app/                providers (theme, error boundary, query client), the route table, the router
  app/shell/          the signed-in frame: app bar, navigation, status banner, section boundary
  api/                the typed vendor-api client, its hooks and error model (generated types in schema.d.ts)
  session/            the session store (token in memory), AuthProvider and useSession, the route guards, the blocked page
  config/             the typed environment, the support address and the website links
  features/           one folder per feature (signup and email verification, sign-in and passwords, the image uploader, the brand page editor, the products list and the product form) and the helpers they share
  components/         shared pieces (error boundary and screens, not found, misconfigured)
  ui/                 patterns every screen shares: page header, loading, empty, error, toast, confirm
  pages/              one module per route (Account, Import, Submissions and Team are still the placeholder page until their features arrive)
  security/           the headers (one definition for vercel.json, dev and preview), SafeLink,
                      SafeImage, PasswordField, and the tests of the security rules
  test/               test setup
```

- **Feature folders.** A screen and everything only it uses live together; shared pieces go to
  `components/`. No business rules in components: they live in plain functions that can be tested.
- **The shared theme only.** Colours, spacing and fonts come from `@shazlo/ui` (a test fails on a
  hex colour, an `rgb()` or a font family in `src/`).
- **Routes** are listed once, in `src/app/portalRoutes.ts`, with who may open each (`public`, `open`,
  `authenticated` or `owner`); the guards in `src/session/guards.tsx` enforce it and `src/app/routes.tsx`
  attaches the screens.
- **Queries** do not retry a 4xx answer, retry network errors and 5xx twice, are fresh for 30
  seconds and refetch on window focus (`src/app/queryClient.ts`).
- **Errors** never show a stack trace: a root error boundary and the router's error element render a
  plain message with a way out.
- Every screen sets `document.title` and has exactly one `h1`.

## Deployment

`vercel.json` rewrites every path to `index.html` so deep links work (static files are served first).
`vercel.json` also carries the security headers (see "Security rules" below); the per-environment URLs and domains are Phase 8.

## Calling vendor-api

Every request goes through the typed client in `src/api/`; no screen builds a URL or reads a raw
`Response`. Its types are generated from `services/vendor-api/openapi.json`:

```sh
npm run api:generate -w @shazlo/vendor-portal   # rewrites src/api/schema.d.ts after vendor-api changes
npm run api:check -w @shazlo/vendor-portal      # CI: fails when the committed file is stale
```

Commit the regenerated `schema.d.ts` with the backend change that caused it. CI runs the web checks
whenever `openapi.json` changes, so a backend change that breaks the portal fails the build.
(`.gitattributes` keeps `schema.d.ts` LF on every OS; with CRLF `api:check` would report it stale.)

```ts
import { api, ApiError, NetworkError } from './api'

const me = api.useQuery('get', '/v1/vendor/me')                    // typed result, cached by key
const login = api.useMutation('post', '/v1/auth/login')
login.mutate({ body: { email, password } })
```

| Failure | Thrown as | Use |
| --- | --- | --- |
| Any non-2xx answer | `ApiError` | `status`, `code`, `message`, `requestId` (quote it to support) |
| `422` | `ApiError` | `fieldErrors`: `{ email: 'message', 'variants.0.price': 'message' }`; `_form` for a problem with no field |
| `429` | `ApiError` | `retryAfter`: seconds to wait |
| No answer, or 15 s passed (2 min for the bulk import) | `NetworkError` | `kind` is `network` or `timeout` |
| The caller cancelled (a component unmounted) | the browser's `AbortError` | nothing to show |

The session code supplies the access token with `setAccessTokenProvider(() => token)`; the client
always sends cookies, so the refresh cookie reaches `/v1/auth/*`. The bulk import and the template
download are `importProducts(file)` and `downloadImportTemplate()`. Tests mock the network with MSW.

## The session

`src/session/` keeps the vendor signed in (ADR 0009). The access token (15 minutes) lives **in memory
only**; the refresh cookie is `HttpOnly`, so scripts cannot read it. After a reload the portal
calls `POST /v1/auth/refresh` to restore the session. Nothing is written to web storage.

```tsx
const { status, user, vendor, role, logout } = useSession()
// status: 'loading' | 'signedIn' | 'signedOut' | 'blocked' | 'unavailable'
```

- **Renewal:** the token is renewed at 80% of its life, and once on a `401` from any call (the
  request is then retried once). Concurrent calls share one refresh. A `409 refresh_conflict` (two
  tabs refreshing together) waits a moment and retries once.
- **Ending:** a `401` on refresh signs out and clears the query cache. `unavailable` (the server
  cannot be reached) is not a sign-out; the user can try again.
- **Tabs:** a `BroadcastChannel` carries only the words `login` and `logout`, never a token.
- **Guards:** `RequireAuth` (to `/login?return-to=…`, validated by `safeReturnTo`: only a path to a
  portal screen), `PublicOnly`, and `RequireRole role="owner"`. A route's access is set in
  `src/app/portalRoutes.ts`.
- **Blocked vendors** (`403 vendor_not_allowed`, rejected or suspended) get a page that explains and
  offers support in place, never a redirect to login.
- **Expiry mid-work:** the user is sent to login with `return-to` set to the same screen. A form can
  keep its unsaved input with `saveDraft(key, data)` and restore it with `takeDraft(key)`
  (`session/drafts.ts`); drafts are in memory, survive an expiry, and are dropped on sign-out.
- **The login screen** (`features/auth/LoginPage.tsx`) calls `session.signIn(response)` with the answer of
  `POST /v1/auth/login`, or `session.markBlocked()` on a `403 vendor_not_allowed`.

## Security rules

The portal is open to the internet, holds vendors' business data and shows content vendors typed.
These rules are enforced by lint and by tests in `src/security/`; a change that breaks one fails CI.

**Headers.** `src/security/headers.ts` is the one definition. It produces `vercel.json` (production),
the Vite dev and preview headers, and the tests.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`; scripts from the app only (no inline script, no `eval`); `connect-src` only the API origin and `https://api.cloudinary.com`; `img-src` only the app, `https://res.cloudinary.com` and `blob:` (the preview of a file the vendor just chose); `frame-ancestors 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; `upgrade-insecure-requests` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB and the other listed features switched off |
| `Strict-Transport-Security` | two years, with subdomains (production only; preview and dev run over http) |

`style-src` allows `'unsafe-inline'` because MUI writes `<style>` tags; that cannot run script.
Development also allows inline script (the React refresh preamble) and the hot-reload socket.
`assetsInlineLimit` is 0, so no asset becomes a `data:` URI.

The committed `vercel.json` names a placeholder API origin (`https://api.example.com`), which fails
closed. On Vercel, `npm run build` first runs `scripts/write-vercel-headers.mjs`, which writes the
real `VITE_VENDOR_API_URL` into `connect-src` and fails the build if it is not a plain https origin.
Set `VITE_VENDOR_API_URL` in the Vercel project. If you change the policy, change `headers.ts` and
regenerate `vercel.json` (the test tells you what it should contain).

**Tokens and secrets.**
- The access token lives in memory only; the refresh token is an `HttpOnly` cookie. Source files may
  not use `localStorage`, `sessionStorage` or `indexedDB` (lint, plus a test of the sources).
- No `console.log` (`console.error` only, for the error screens); never put a token, password or
  e-mail in a URL, a log line or an error message.
- Render a password input only with `PasswordField`, which sets `autocomplete` (`current-password`
  or `new-password`) and turns off autocapitalisation and spell-check.
- A form holding something sensitive registers a reset with `registerSensitiveReset`; signing out
  calls `clearSensitiveState()`.

**Rendering what vendors typed.**
- `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` and `insertAdjacentHTML` are forbidden by lint.
  React escapes text; keep it that way.
- A vendor's website or an image address is shown only through `SafeLink` / `SafeImage`: plain
  `https:` addresses only (no `javascript:`, `data:`, `http:` or embedded passwords), `rel="noopener
  noreferrer"`, no referrer sent for images. Anything else is shown as plain text or a fallback.
  Live previews must use them.
- After login the `return-to` address is checked by `safeReturnTo` (the session), which accepts only
  a path to a portal screen.

**Dependencies.** CI runs `npm audit` for any PR that changes a manifest, covering every workspace
through the one lockfile; Dependabot watches the repository root, so it covers the portal.

## Signup and email verification

`src/features/signup/` holds the `/signup` and `/verify-email` screens.

- **Prices** are typed in rupees and sent as whole paise, using integer arithmetic only
  (`rupeesToPaise`: `99.90` becomes `9990`, `1,000` becomes `100000`; floating point gets `1.15 * 100`
  wrong). Never multiply a price by 100 anywhere else.
- **Validation** mirrors vendor-api's `SignupRequest` in `rules.ts`. `rules.test.ts` compares the email
  and phone patterns, the length limits and the price ceiling with `openapi.json`, so a change to the
  API fails the portal's tests. The password length (12) is a server setting that is not in the
  OpenAPI file; the server has the last word, and its answer is shown next to the password field.
- **No hint about existing accounts:** signup always answers `202`, and the confirmation page, the
  resend answer and the expired-link page use the same wording whatever happened.
- **Errors:** `422` field messages appear next to their inputs and focus moves to the first one;
  `429` shows a countdown from `Retry-After` and blocks sending until it ends; network failures say
  so in plain words. `friendlyError` (`features/errors.ts`) is the shared way to word these.
- **The verify link** is the one vendor-api emails: `/verify-email#token=…`. The token is in the URL
  *fragment* (the browser never sends it to a server, so it stays out of access logs and `Referer`
  headers); `linkToken` (`features/linkToken.ts`) reads it, and also a `?token=` query. It is spent
  exactly once (StrictMode runs effects twice) and the token is then removed from the address bar
  and the history. Resending has a 60-second cooldown.
- **A finished call keeps no copy of the password.** Mutations that carry one (`signup` here, and
  `login` and `set-password`) use `gcTime: 0` and `reset()` once the call ends, so the query cache
  does not hold the password in `variables`; a test checks the mutation cache is empty.
- **The terms and privacy links** are in `src/config/links.ts`, opened through `SafeLink`.

## Signing in, signing out and passwords

`src/features/auth/` holds `/login`, `/forgot-password` and the set-password screen; the signed-in frame (app bar
with the account menu and Sign out, section navigation) is `src/app/shell/` (see "The dashboard shell").

- **No screen tells a registered email from an unregistered one.** Every bad login (`401`) shows the
  one message `BAD_LOGIN_MESSAGE`, whatever the server's text; forgot password shows the same
  confirmation for every address and does not echo it.
- **Login** sends the password and drops it from the form at once, success or not. `403
  vendor_not_allowed` marks the session blocked and shows the explanation page (no loop); `429`
  counts down; after login the `PublicOnly` guard sends the user to the checked `return-to`.
- **The emailed links** are the ones vendor-api sends (`services/vendor-api/vendor_api/services/email/templates.py`):
  `/verify-email#token=…`, `/reset-password#token=…` (reset) and `/accept-invite#token=…` (staff invite). The token
  is in the URL *fragment*, which the browser never sends to a server, so it stays out of access logs and
  `Referer` headers; `linkToken` also accepts a `?token=` query. `/reset-password`, `/accept-invite` and
  `/set-password` are one screen: it keeps the token in memory only and removes it from the address bar and
  the history at once (replacing the address with its own path, so the page is not remounted). A bad token
  shows "expired or already used" with a way to request a new link. These routes and `/verify-email`
  have access `open` in `portalRoutes.ts`: an emailed link must work whether or not someone is signed in.
  If vendor-api changes a link, change `portalRoutes.ts` with it.
- **Sign out** (in the account menu) ends the session, clears caches, drafts and sensitive
  form state, and goes to a plain `/login`: after a deliberate sign-out the next login does not
  "return" to the page the user left (`signedOutByUser`). An expired session does return.
- **Password fields** (`PasswordField`) have a show/hide toggle, the right `autocomplete`, and never
  block pasting.

## The dashboard shell

`src/app/shell/` is the frame of every signed-in screen; `src/ui/` holds the patterns every screen
shares. A screen added later should use these and nothing of its own for the same job.

**Frame.** A skip link, an app bar (vendor name, account menu with Sign out), the section navigation
and the page in `<main id="main-content">`. From the `md` breakpoint (900 px) the navigation is always
visible; below it (phones and tablets in portrait) it sits in a drawer behind a menu button, which
closes when a section is chosen or on Escape. Team is shown to owners only (`nav.ts`). A `pending`
vendor sees the review banner (`StatusBanner`). An unknown address shows "Page not found" inside the
frame, and each page is guarded by `SectionBoundary`, so a page that throws leaves the navigation
standing and clears when another section is opened.

**Adding a screen.** Put its path in `portalRoutes.ts` (with who may open it), its page in `src/pages/`
as a default export, and lazy-load it in `routes.tsx` (`screens` must cover every route; a test checks).
The shell shows a page skeleton while its code loads.

**Shared patterns** (`import … from '../ui'`):

| Component | Use |
| --- | --- |
| `PageHeader` | The page's one `h1` (also its title), description and actions. After a navigation it takes focus. |
| `LoadingState`, `PageSkeleton` | Anything loading; announced politely. |
| `EmptyState` | Nothing here yet: say so, and offer the next step. |
| `ErrorState` | A failed call: a plain sentence, "Try again", the request id for support. Pass the error; never print `error.message` raw. |
| `useToast()` | `success`, `error`, `info` messages for something that just happened. |
| `useConfirm()` | `if (await confirm({ title, message, destructive: true })) …` before anything that cannot be undone. |

**Accessibility baseline.** Skip link; one `h1` per page (a test visits every section); focus moves to
the heading on navigation (but not on the first load); the page title is set per screen; every
focusable element has a visible focus ring (`Providers`).

### Manual responsive checklist

Tests cover the navigation behaviour at 320, 768 and 1280 px (`test/viewport.ts` pretends the window
width; jsdom has no layout), so check the look by hand before a release, in a real browser at each width:

- [ ] **320 px:** no horizontal scrolling on any section; the menu button opens the drawer, a link closes it; the app bar shows the vendor name (truncated) and Account; cards are one column; buttons and links are at least 44 px tall.
- [ ] **768 px:** the menu button is still used (the navigation is permanent from 900 px); cards in two columns.
- [ ] **1280 px:** the navigation is always visible; cards in three columns; the page title is not obscured by the sticky app bar when navigating.
- [ ] **Keyboard only** (no mouse), at each width: Tab reaches the skip link first and it works; every control can be reached and used; focus is always visible; after choosing a section focus is on its heading; Escape closes the drawer and the account menu.
- [ ] **Zoom** to 200% and 400%: nothing is cut off or overlaps.
- [ ] **A screen reader** announces the page title, the current section (`aria-current`), the loading states and the toasts.

## The products list

`src/features/products/` is `/products`.

- **Table on a wide screen, cards on a phone** (the same breakpoint as the navigation, 900 px), with title,
  SKU, category, status chip, a "Changes pending" badge for an approved product being edited, and the date.
  Every status is a word, so colour is never the only signal.
- **Filters live in the address** (`?status=approved&category=kurtas&q=silk&page=2`): shareable, they survive a
  reload, and the back button steps through them. Typing in the search boxes is debounced (300 ms) and
  replaces the address entry instead of adding one per pause. Changing a filter goes back to page 1; an
  invalid or hand-edited value is ignored (`filters.ts`). Archived products show only when the status filter asks.
- **Delete says what it will do before it does it.** The server removes a product that was never submitted and
  archives one that was (a live one goes off sale). The list does not say which, so `deleteOutcome` works it out:
  approved or rejected means archived, in review means blocked, and for a draft it looks at the product's detail
  (a later version, a submitted one or a live one means it was submitted). When it cannot tell it explains both.
  A `409 product_in_review` that arrives anyway is explained too.
- **Prefetch:** hovering or focusing a product's title warms its page.

## Uploading images

`src/features/uploads/` is the one way to upload a brand logo, a banner or a product image.

```tsx
<ImageUploader kind="brand_logo" label="Brand logo" currentUrl={draft.logo_url} onUploaded={(asset) => setLogoId(asset.id)} />
<ImageUploader kind="product_image" label="Product images" multiple onUploaded={(asset) => addImage(asset.id)} />
```

`useImageUploads(kind, { concurrency, maxFiles })` is the same thing without the screen, for a custom layout.

**The three steps** (`upload.ts`): sign (`POST /v1/vendor/assets/sign`), send the file straight to the image
host with progress (`XMLHttpRequest`: `fetch` cannot report upload progress), register
(`POST /v1/vendor/assets`). Only a registered asset with status `ready` can be used on a page or product.

- **Refused before any request:** a file of the wrong type (JPG, PNG, WebP) or over 10 MB is refused in the
  browser with "Use a JPG, PNG or WebP under 10 MB". The limits are checked again against the ones the server
  returns with the signature. The 10 MB (`DEFAULT_MAX_BYTES`) is vendor-api's default `upload_max_bytes`; if
  the server is configured with a larger limit, raise it in `rules.ts` to match.
- **Only Cloudinary:** the upload address the server returns must be Cloudinary's `image/upload` endpoint
  (`isTrustedUploadUrl`); the file and the signature are never sent anywhere else.
- **Expired signatures** are replaced once, automatically (before sending if already expired, or after the host
  rejects it). A second rejection is shown as an error, so a bad file cannot loop.
- **Cancel** stops the request in flight and never starts the registration. The signature step leaves a `pending` record on the
  server, which cannot be used anywhere. There is no endpoint to delete it and nothing cleans it up yet (a vendor-api
  follow-up), so it stays. Cancel while the last step ("Saving…") is already running is a request that may have
  reached the server: the image can then end up registered, but it is only attached to a page if the form is saved.
- **Registering** retries a few times on `409 upload_not_found` (the host may take a moment to show the file); a
  `422` shows the server's reason ("The image is larger than 10 MB").
- **Secrets stay out of sight:** an `UploadError` carries only a sentence written for vendors, never the signature,
  the API key, the upload address or the host's reply (a test checks every failure path, and that nothing is logged).
- **Previews:** a `blob:` object URL of the local file while uploading (the CSP allows `blob:` for images only),
  then the CDN address through `SafeImage`.
- **Accessibility:** a real button opens the file chooser (files can also be dropped on the box); progress is a
  named progress bar and is announced by quarter in a live region; errors are `role="alert"` and referenced by the
  button's `aria-describedby`; every Cancel, Retry and Remove button names its file.

## The brand page editor

`src/features/brand/` is `/brand`.

- **Edit, preview, save, submit.** The form sends the whole draft on every save (the API replaces it). Prices are typed in rupees and converted to paise with integer arithmetic (`99.90` is exactly 9990). The Instagram box takes `@name`, a name or a profile address and shows the handle it will save.
- **Live preview** beside the form (below it on a phone): the shopper's brand card and page header at a phone or a desktop width. It only reads the form's values, so it updates as the vendor types. Text is rendered as text, links go through `SafeLink` and pictures through `SafeImage`, and a missing logo falls back to an initial.
- **Unsaved changes** are tracked by comparing what would be saved: leaving the page asks first, and closing the tab warns (`useUnsavedChanges`, shared with the product form).
- **A version in review is locked.** It says since when (from `GET /v1/vendor/submissions`), and editing a new draft is a deliberate button. Submitting is off until the decision, because the API allows one version in review (`409 review_pending` is explained if it happens anyway). A version that was not approved shows the admin's reason.
- **Submitting** needs a category (checked before the call), asks for confirmation that says what happens next, and saves unsaved changes first. The **Published version** tab shows what shoppers see now, or that nothing is published yet.

## The product form

`src/features/products/ProductEditor.tsx` is both `/products/new` and `/products/:id`.

- **The whole revision on every save.** `PUT` replaces it, so the form sends every field, every variant and every image
  (`toBody` in `form.ts`). Creating sends the same body plus the product's SKU, then moves to the product's own page.
  The product SKU cannot change afterwards.
- **Prices** are typed in rupees and sent as whole paise with integer arithmetic (`rupeesToPaise` / `paiseToRupees` in
  `features/signup/money.ts`): `0.10` is exactly 10 paise and `1999.99` is 199999, and both read back the same. An empty
  MRP means the same as the price; the MRP cannot be below it.
- **Variants** mirror the API's rules before sending: SKU format, SKUs unique within the product (letter case ignored),
  no two variants with the same size and colour. A saved variant keeps its SKU, size and colour (they are its identity on
  the server, `422 variant_identity_changed`); to sell another size or colour, add a variant. vendor-api returns variants
  in SKU order, so the form does not offer to reorder them. A SKU used by another product is the server's `409 sku_taken`.
- **Images** come from the shared uploader. The first is the cover. They are ordered by dragging or with the Move up,
  Move down and Make cover buttons; a move is announced and focus stays with the image that moved. Each has its own
  description (alt text). At most 10: files beyond that are not added and the form says so. Only the picture is draggable, so text in the description field stays selectable.
- **Live and working versions.** For an approved product the live version is shown beside the form, with "Editing creates
  a new version. The live product does not change until it is approved." A version in review, and an archived product,
  are read-only; a rejected version shows the admin's reason (as plain text) and the form starts from it.
- **Submit** asks for confirmation and saves unsaved changes first. It needs an active variant and an image, checked
  before the call; `422 product_incomplete`, `409 product_in_review`, `409 product_archived` and `409 nothing_to_submit`
  are explained in words, and `422` field messages go next to their fields (including `variants.N.price_paise`).
- **Unsaved changes** are guarded by `useUnsavedChanges` (`src/hooks/`), shared with the brand page editor.

## Submissions

`src/features/submissions/` is `/submissions`; its card is on the Overview.

- **The list** (`GET /v1/vendor/submissions`): the brand page's and the products' reviews, newest first, with a status chip in words
  (In review, Approved, Not approved, Withdrawn) and the submitted and decided dates, relative with the exact time. Status, type and
  page live in the address (`?status=rejected&subject=product&page=2`).
- **A rejection** shows the admin's reason prominently through `ReviewReason`: as text, so a reason that looks like HTML is shown
  literally, with its line breaks kept. "Fix and resubmit" goes to `/brand` or the product's page; it is replaced by "A newer version
  was submitted" when a later version of the same thing is on the page. For a product that is already live, the row says the live
  version is unchanged (it reads the product's detail, for rejected products only). The brand editor and the product form show the
  same status and reason in a banner, and the brand editor also says when its latest version was approved.
- **Freshness:** the list (and the Overview card) refetch every 60 s (`REFRESH_MS`) and when the window regains focus. A status that
  changes while the page is open is announced in a polite live region.
- **"New since your last visit"** marks decisions made after the vendor last left the page. The time is kept in memory
  (`lastVisit.ts`), like the session: the portal writes nothing to web storage, so the marker starts over after a reload or a
  sign-out.
- **Overview:** how many items (brand page and products together) are in review, and the latest three decisions, a rejected one
  linking to its fix.
- **Empty:** a vendor who has submitted nothing is told what to do first (the brand page, then products).
