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
| `npm run dev:with-module -w @shazlo/shazlo-one` | The shell (5173) and the reference module (5175) together |
| `npm run dev:module -w @shazlo/shazlo-one` | Only the reference module, on port 5175 |
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
  App.tsx             checks the environment and the module registry, then renders the router (or the misconfigured screen)
  app/                Providers (theme, error boundary, query cache), routes, router, query defaults
  api/                the typed client: client.ts, errors.ts, instance.ts, schema.d.ts (generated)
  config/env.ts       VITE_IDENTITY_API_URL, checked once at start
  session/            the admin session: store, AuthProvider, guards, return-to check
  modules/            registry.ts (the module list and its checks), loadRegistry, ModuleRegistryProvider
  security/           headers.ts (every header, defined once), sensitiveState.ts, PasswordField.tsx, and the tests
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
- `getModuleToken(audience, scope)` exchanges the identity token (`POST /v1/auth/token`) for a module token,
  kept per `scope` (the module's id), shared only between callers of the same scope, never kept past its
  own or the identity token's expiry. `dropModuleTokens(scope)` forgets a module's tokens when its page is left. `403
  audience_not_allowed` and `400 unknown_audience` are `AudienceNotAllowedError` and
  `UnknownAudienceError`.
- Screens: `/login` (one message for every `401`, a countdown for `429`, the password dropped from
  state as soon as it is sent and from the query cache when the call ends) and `/change-password`.
  An admin who must change their password sees "Choose your password", can reach nothing else, and
  then continues to `return-to`; any other admin reaches "Change your password" from the account
  menu. The API ends every other session and returns a new one, which the shell adopts. The account
  menu shows the admin's name, email and roles, and signs out (every tab follows). Password inputs
  go through `PasswordField` only (a test enforces it).
- Ending the session clears the query cache, the sensitive forms (`registerSensitiveReset`) and every
  module token.
  A renewal that comes back with another admin does the same; one that comes back with new roles
  drops the cached module tokens. A sign-out (in any tab) while a renewal is under way wins: the
  renewal's answer is thrown away.
- Session and token-exchange answers are checked: a non-empty token and a lifetime between 0 and a
  day, or the answer is refused.

## Modules and the layout

The module registry is `src/modules/registry.ts`: one list per environment (`development`,
`preview`, `production`). **Adding a module is one entry** there, and the navigation, the routes and
the Content-Security-Policy `frame-src` all follow:

```ts
{
  id: 'vendor-admin',            // the address, /m/vendor-admin; lower case, digits, hyphens
  title: 'Vendor admin',
  description: 'Review vendor applications, products and brand pages.',
  url: 'https://vendor-admin.shazlo.com/',
  origin: 'https://vendor-admin.shazlo.com',   // exact; never a wildcard or a pattern
  roles: ['vendor_reviewer'],    // an admin needs one of these; super_admin opens every module
  audience: 'vendor-api',        // the token audience identity-api issues for it
  supportedVersions: [1],
}
```

The registry is checked when the shell builds (the Vite config and the Vercel prebuild step) and
when it starts (a bad one shows the misconfiguration screen). It refuses a wildcard or pattern
origin, a non-https origin outside development, a `url` that is not on its `origin`, duplicate ids
or origins, and an empty role list; the message names the module and what to change. Which list a
build uses: `development` for `npm run dev`, `preview` when `VITE_DEPLOY_ENV` (or Vercel's
`VERCEL_ENV`) is `preview`, `production` otherwise. The file has no imports, so Node and Vite read
it without loading the app.

- **Layout:** a skip link, an app bar (Shazlo-One, account menu), a navigation drawer (permanent from
  900 px, behind a menu button below), and one `<main>`. After each navigation the page heading
  takes focus (not on the first page).
- **Role filtering:** a module shows only if the admin holds one of its roles (`super_admin` sees
  all). "Admins" is for `super_admin` only. The session reads `GET /v1/me` again on every renewal, so
  a changed role shows without a new sign-in.
- **Routes:** `/m/:moduleId/*` (the rest of the path belongs to the module). An unknown id is "Page
  not found"; a module the roles do not allow is the 403 page. Neither renders a frame.
- **Home:** a card for each module the admin may open, or an explanation when there is none.

## The module host

`/m/:moduleId` puts the module in a frame and does the handshake of ADR 0001 (`src/components/ModuleHost.tsx`,
built on `createShellChannel` from `@shazlo/shell-protocol`).

- **The frame:** `title`, `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"` (no top
  navigation, popups or modals), `referrerpolicy="no-referrer"`, `allow=""`. Its `src` is exactly the
  registry's `url`: a token is never in an address.
- **Order:** the channel (and so the `message` listener) is created first, then `src` is set, so an early
  `ready` is never missed.
- **On `ready`** (from the module's exact origin **and** its frame window, nothing else is read): the shell
  picks a version, exchanges a token for the registry's `audience`, and sends `auth` with `replyTo`. A second
  `ready` (the module reloaded) gets the current `auth` again, from the cache while the token is good. With no
  common version the shell sends `error` `version_unsupported` and shows a panel naming the module and its version.
- **Tokens** are kept per module (its id), never shared (two modules on `vendor-api` get a token each), and
  dropped when the page is left, when the frame is reloaded, and when the session ends.
- **Exchange failures:** `403 audience_not_allowed` (the admin lost the role) is the 403 page, with no frame.
  A network error, a 5xx, an unknown audience or an ended session is an error panel with **Retry**.
- **No `ready` in 10 seconds** (also what a CSP or framing refusal looks like, because the parent cannot see
  it): an error panel with Retry, which gives the frame a new load. After 3 failed retries it says "unavailable",
  offers no more Retry and calls the failure reporter once (`setModuleFailureReporter` in
  `src/modules/moduleFailure.ts`; nothing is wired up by default). A module that answers resets the count.
- **While it starts** the page shows a loading state; the shell's navigation and account menu stay usable
  throughout, and leaving the page removes the frame and its listener.

### Keeping the module supplied

A module's token lasts **5 minutes** (identity-api's `EXCHANGED_TOKEN_TTL_SECONDS`), the identity token **15**. The host
(`ModuleHost.tsx`, with the maths in `src/modules/refreshSchedule.ts`) keeps the module's token fresh:

- **Schedule:** from each token's own life, a new token is exchanged and sent as `auth` at 80% of its life or 30
  seconds before it ends, whichever is first (never earlier than its half-life). A reload resumes from the token
  the module was last given.
- **Identity first:** if the identity token would end before a new module token should, it is renewed before the
  exchange, so the module token gets its whole life. If that renewal cannot be done now, the exchange goes on with
  what the shell holds and the module token is cut short.
- **`token:request`:** answered with a fresh `auth`, at most once per 30 seconds per module, whatever it sends.
- **A failed refresh** (network, 5xx): the module keeps its token; the shell retries after 5, 15, then every 30
  seconds, and a retry that works resets the backoff. When the token ends, the frame is removed, the session ends
  as *expired* (no server call) and the admin goes to login, back to `/m/<id>` afterwards.
- **A role removed** (`403 audience_not_allowed` on a refresh or request): the module closes and the 403 page shows.
  A role removed from the admin's own session (read again on renewal) does the same through the page's role check.
- **The session ending anywhere** (sign-out here or in another tab, a revoked refresh family, a deactivated admin)
  removes the frame and drops every token at once: the guards unmount the page, which clears its timers, closes the
  channel and drops the module's tokens.

Not here yet: title and deep-link sync, toasts, and a module's `logout` and `error` messages (#257). Until then the
reference module's buttons for those send messages the host does not act on.

## The reference module

`dev-module/` is a tiny module for development and the shell's tests, and a model for module authors
(Phase 7 and later). It is built on `createModuleClient` from `@shazlo/shell-protocol`, runs on its own
origin (`http://localhost:5175`) and is **never built or deployed** (`vite build` on its config fails).
It is in the **development** registry only, for `super_admin` and `vendor_reviewer`, so it can never be
framed by a preview or production shell (a test checks it).

```sh
npm run dev:with-module -w @shazlo/shazlo-one   # shell on 5173, module on 5175
```

- It sends `ready`, keeps the token from `auth` **in memory only**, and shows the admin's email, roles and
  when the token expires (never the token).
- It calls vendor-api's `GET /v1/admin/me` with that token (`aud=vendor-api`) and shows the answer. A `401`
  makes it send `token:request` (at most once every 30 seconds) and repeat the call when the shell answers.
- Buttons send every module-to-shell message: `title` (in-module pages), a `toast` of each level, `logout`,
  and a non-fatal and a fatal `error`. The shell's `navigate` and `error` are shown.
- Its responses carry `Content-Security-Policy: frame-ancestors <shell origin>` (plus `http://localhost:5173`
  in development) and `Referrer-Policy: no-referrer`, so any other origin that tries to frame it is refused.
- Opened directly, outside the shell, it says so and does nothing else: no listener, no message, no request.
- Settings: `VITE_SHELL_ORIGIN` (default `http://localhost:5173`) and `VITE_VENDOR_API_URL` (default
  `http://localhost:8002`), both exact origins, checked by the protocol package. Put them in
  `dev-module/.env.local` to change them.
- vendor-api must allow the module's origin: compose and `.env.example` set `VENDOR_CORS_ALLOWED_ORIGINS` to
  `http://localhost:5174,http://localhost:5175`. If you made your `.env` before this, add the second origin.
- The module's config reads the protocol package, which is TypeScript source, so its dev server runs with
  `--configLoader runner` (the scripts above do that).

## Security rules

The shell is where admins sign in, so a script running on it could act as an admin. These rules are
enforced by tests and lint, not by review alone.

- **Headers from one definition.** `src/security/headers.ts` produces the headers for the dev server,
  the preview server and `vercel.json` (committed with a placeholder API origin; the Vercel build
  rewrites it from `VITE_IDENTITY_API_URL`, and fails if that is not a plain https origin).
  The Content-Security-Policy has `script-src 'self'` (no inline script, no `eval`; development adds
  `'unsafe-inline'` for the React refresh preamble only), `connect-src` the identity API only,
  `frame-src` only the registered module origins (from the module registry, `src/modules/registry.ts`; `'none'` while
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
