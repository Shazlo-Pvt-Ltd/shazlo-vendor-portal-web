# shazlo-one

React + TypeScript (Vite) admin shell: the front door of the admins. It signs them in against
[identity-api](../../services/identity-api/README.md), lists the modules their roles allow and hosts
each module's admin UI in an iframe ([ADR 0001](../../docs/adr/0001-iframe-postmessage-protocol.md)).
Phase 6 of the [roadmap](../../docs/ROADMAP.md) builds it.

Status: the scaffold. It serves an empty shell with the typed identity-api client, the security
headers and the security checks in place. Sign-in, the session, the module registry and the iframe
host are the next Phase 6 issues.

Stack: React 19, TypeScript (strict), Vite, MUI through the shared [`@shazlo/ui`](../../packages/ui)
theme, React Router, TanStack Query. It starts from the foundations of the
[vendor portal](../vendor-portal/README.md) (typed client, error model, headers from one definition,
safe rendering), copied rather than shared: when a third app needs them, extract a package.

## Running it

```sh
npm ci                                   # at the repository root
cp apps/shazlo-one/.env.example apps/shazlo-one/.env.local
npm run dev -w @shazlo/shazlo-one        # http://localhost:5173
```

It needs a running identity-api for anything beyond the empty page (compose: `docker compose
--profile identity up -d`). identity-api's `CORS_ALLOWED_ORIGINS` must contain the shell's exact
origin; compose already sets `http://localhost:5173`, which is why the dev server insists on that
port (`strictPort`). The refresh cookie is `SameSite=Strict`, so the shell and the API must be the
same site (both on `localhost`).

## Settings

| Variable | Meaning |
| --- | --- |
| `VITE_IDENTITY_API_URL` | Required. The identity-api origin, for example `http://localhost:8001`: no path, no credentials, `https` outside development. It is compiled into the build, so it is public: never put a secret in it. |

A missing or invalid value shows a "The shell is misconfigured" screen that says what is wrong (and
never prints the value), instead of a blank page. `src/config/env.ts` has the rules.

## Commands (from the repository root)

| Command | What it does |
| --- | --- |
| `npm run dev -w @shazlo/shazlo-one` | Dev server on port 5173 |
| `npm run build -w @shazlo/shazlo-one` | Typecheck, then a production build in `apps/shazlo-one/dist` |
| `npm run typecheck -w @shazlo/shazlo-one` | `tsc` only |
| `npx vitest run --project shazlo-one` | The shell's tests (jsdom, Testing Library) |
| `npm run lint` | ESLint for the whole repository |
| `npm run api:generate -w @shazlo/shazlo-one` | Rewrites `src/api/schema.d.ts` from `services/identity-api/openapi.json` |
| `npm run api:check -w @shazlo/shazlo-one` | Fails when `schema.d.ts` is stale |

CI runs lint, `api:check`, typecheck, the tests and the build (`apps-ci.yml`), and `npm audit` covers
the shell's dependencies.

When identity-api's API changes, regenerate its document (`python -m identity_api.cli
export-openapi` in `services/identity-api`), then `api:generate` here, and commit both.

## Layout

```
src/
  main.tsx            entry: fonts, then <App />
  App.tsx             checks the environment, then renders the router (or the misconfigured screen)
  app/                Providers (theme, error boundary, query cache), routes, router, query defaults
  api/                the typed client: client.ts, errors.ts, instance.ts, schema.d.ts (generated)
  config/env.ts       VITE_IDENTITY_API_URL, checked once at start
  session/            the admin session: store, AuthProvider, guards, return-to check
  security/           headers.ts (every header, defined once), moduleOrigins.ts, sensitiveState.ts, and the tests
  components/         ErrorBoundary, ErrorScreen, RouteError, NotFound, Misconfigured
  hooks/              usePageTitle
  pages/              one file per route
  test/               test setup
```

## Calling identity-api

`src/api` is the only way the shell talks to identity-api. Paths, parameters and bodies are typed
from `services/identity-api/openapi.json`; a screen passes a path, never a URL:

```ts
const { data } = api.useQuery('get', '/v1/me')
```

Every call sends the cookie (the refresh cookie must reach `/v1/auth/*`) and throws instead of
returning an error object:

- `ApiError` for any non-2xx answer: `status`, `code` (`invalid_credentials`, ...), `message`,
  `fieldErrors` (a `422`, keyed by field), `retryAfter` (a `429`) and `requestId` (the
  `X-Request-ID`, to quote to support).
- `NetworkError` (`kind` is `network` or `timeout`) when nothing answers.
- The browser's own `AbortError` when the caller cancels.

Queries retry only network errors and `5xx` answers, twice. The client adds the access token and,
on a `401` from anything but `/v1/auth/*`, renews the session once and repeats the call.

## The admin session

`src/session` holds the session (ADR 0009). Read it with `useSession()`.

- The 15-minute access token lives in memory only, never in web storage, a URL or a log. After a
  reload the session comes back from `POST /v1/auth/refresh` (the `identity_refresh` cookie), then
  `GET /v1/me` gives the profile and roles.
- It renews at 80% of the token's life and once on a `401`. Concurrent calls share one refresh. A
  `409 refresh_conflict` is retried once. A `401` on refresh ends the session; a network or `5xx`
  failure does not (`unavailable` before the first sign-in, a retry in 15 seconds after).
- Tabs tell each other only the words `login` and `logout` on a `BroadcastChannel`, never a token.
- States: `loading`, `signedIn`, `passwordChangeRequired`, `signedOut`, `unavailable`. An admin who
  must change their password has a token with no roles; the guards hold them at `/change-password`.
- Guards: `RequireAuth` (sends to `/login?return-to=...`, the path checked against `shellPaths`),
  `PublicOnly`, `RequirePasswordChange` and `RequireRole anyOf={[...]}`.
- `getModuleToken(audience)` exchanges the identity token (`POST /v1/auth/token`) for a module token,
  shared between callers, never kept past its own or the identity token's expiry. `403
  audience_not_allowed` and `400 unknown_audience` are `AudienceNotAllowedError` and
  `UnknownAudienceError`.
- Ending the session clears the query cache, the sensitive forms (`registerSensitiveReset`) and every
  module token.

## Security rules

The shell is where admins sign in, so a script running on it could act as an admin. These rules are
enforced by tests and lint, not by review alone.

- **Headers from one definition.** `src/security/headers.ts` produces the headers for the dev server,
  the preview server and `vercel.json` (committed with a placeholder API origin; the Vercel build
  rewrites it from `VITE_IDENTITY_API_URL`, and fails if that is not a plain https origin).
  The Content-Security-Policy has `script-src 'self'` (no inline script, no `eval`; development adds
  `'unsafe-inline'` for the React refresh preamble only), `connect-src` the identity API only,
  `frame-src` only the registered module origins (`src/security/moduleOrigins.ts`; `'none'` while
  there are none), `frame-ancestors 'none'` (the shell is never framed), `object-src 'none'` and
  `base-uri 'self'`. Also `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, and
  HSTS in production. A module's own backend calls run inside its frame, under its own policy, so
  they never widen the shell's `connect-src`.
- **No web storage.** `localStorage`, `sessionStorage` and `indexedDB` are forbidden (lint and a
  source test). The access token lives in memory and the refresh token is an `HttpOnly` cookie.
- **No raw HTML.** `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` and `insertAdjacentHTML` are
  forbidden, and so are `eval` and `new Function`. Text from the API is rendered as text.
- **No logging of secrets.** `console.log` is forbidden (only `console.error`), and a source test
  fails any log call that mentions a token or a password.
- **The shared theme.** No hard-coded colour or font family in the source (`noHardcodedStyle.test.ts`).
- **Plain failures.** A root error boundary and a route error element show a message and a way out,
  never a stack trace. Every page has one `h1` and sets its title (`usePageTitle`).
- **A clean production build.** `src/security/build.test.ts` builds the app and fails on an inline
  script, an inline event handler, a `javascript:` URL or a `data:` asset.

## Deployment

`vercel.json` rewrites every path to the single page and carries the security headers. The
per-environment URLs and domains are Phase 8.
