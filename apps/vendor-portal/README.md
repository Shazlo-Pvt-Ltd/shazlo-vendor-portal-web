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

CI runs lint, typecheck, the tests and the build (`apps-ci.yml`).

## Layout and conventions

```
src/
  main.tsx            entry: fonts, then <App />
  App.tsx             checks the environment, then the router
  app/                providers (theme, error boundary, query client), the route table, the router
  config/             the typed environment
  components/         shared pieces (error boundary and screens, not found, misconfigured)
  pages/              one folder per screen as they arrive; today a placeholder for each route
  test/               test setup
```

- **Feature folders.** A screen and everything only it uses live together; shared pieces go to
  `components/`. No business rules in components: they live in plain functions that can be tested.
- **The shared theme only.** Colours, spacing and fonts come from `@shazlo/ui` (a test fails on a
  hex colour, an `rgb()` or a font family in `src/`).
- **Routes** are listed once, in `src/app/routes.tsx`, with who may open each (`public` or
  `authenticated`); the session issue adds the guards that enforce it.
- **Queries** do not retry a 4xx answer, retry network errors and 5xx twice, are fresh for 30
  seconds and refetch on window focus (`src/app/queryClient.ts`).
- **Errors** never show a stack trace: a root error boundary and the router's error element render a
  plain message with a way out.
- Every screen sets `document.title` and has exactly one `h1`.

## Deployment

`vercel.json` rewrites every path to `index.html` so deep links work (static files are served first).
Security headers are added by the security issue; the per-environment URLs and domains are Phase 8.

## Calling vendor-api

Every request goes through the typed client in `src/api/`; no screen builds a URL or reads a raw
`Response`. Its types are generated from `services/vendor-api/openapi.json`:

```sh
npm run api:generate -w @shazlo/vendor-portal   # rewrites src/api/schema.d.ts after vendor-api changes
npm run api:check -w @shazlo/vendor-portal      # CI: fails when the committed file is stale
```

Commit the regenerated `schema.d.ts` with the backend change that caused it. CI runs the web checks
whenever `openapi.json` changes, so a backend change that breaks the portal fails the build.

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
- **The login screen** (a later issue) calls `session.signIn(response)` with the answer of
  `POST /v1/auth/login`, or `session.markBlocked()` on a `403 vendor_not_allowed`.
