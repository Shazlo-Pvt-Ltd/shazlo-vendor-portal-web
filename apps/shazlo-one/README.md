# shazlo-one

React + TypeScript admin shell: login, module navigation and the iframe host for each service's admin UI ([ADR 0001](../../docs/adr/0001-iframe-postmessage-protocol.md), [ADR 0009](../../docs/adr/0009-auth-model.md)).

Status: scaffold (Phase 6, [#249](https://github.com/Shazlo-Pvt-Ltd/shazlo-vendor-portal-web/issues/249)). It serves an empty shell, checks its settings, talks to identity-api through a typed client and sets its security headers. Sign-in, the module registry and the iframe host follow in the next Phase 6 issues.

## Run it

```bash
npm install                                  # at the repository root
cp apps/shazlo-one/.env.example apps/shazlo-one/.env.local   # optional: the default below works with docker compose
npm run dev -w @shazlo/shazlo-one            # http://localhost:5173
```

Port **5173** is fixed (`strictPort`): it is the origin identity-api's `CORS_ALLOWED_ORIGINS` expects, and the one its `SameSite=Strict` refresh cookie is sent from.

## Settings

| Variable | Meaning |
|---|---|
| `VITE_IDENTITY_API_URL` | identity-api origin, for example `https://identity.shazlo.com`. Read at **build** time. An origin only: no path, query, fragment or credentials. `https` outside development. |

The app checks it at start. When it is missing or wrong, the shell shows a "misconfigured" screen that names the problem (never the value) instead of a blank page. In development, an unset value falls back to `http://localhost:8001` for the headers only; the app still asks you to set it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev -w @shazlo/shazlo-one` | Dev server on 5173 with the security headers |
| `npm run build -w @shazlo/shazlo-one` | Typecheck, then production build (`prebuild` rewrites `vercel.json` on Vercel only) |
| `npm run preview -w @shazlo/shazlo-one` | Serve the build on 5173 with the production policy |
| `npm run api:generate -w @shazlo/shazlo-one` | Regenerate `src/api/schema.d.ts` from `services/identity-api/openapi.json` |
| `npm run api:check -w @shazlo/shazlo-one` | Fail if the generated types are out of date (CI runs it) |
| `npm run typecheck`, `npm test`, `npm run lint` | At the root, for every workspace |

## Layout

```text
src/
  api/        typed client (openapi-fetch), ApiError / NetworkError, session hooks, schema.d.ts (generated)
  app/        providers, routes, router, query client
  components/ error boundary, error and not-found screens, "misconfigured" screen
  config/     environment check
  hooks/      usePageTitle
  pages/      screens
  security/   headers.ts (the one definition), moduleOrigins.ts (frame-src), source and build tests
  test/       test setup
```

## Errors

`createApiClient` throws instead of returning an error object: `ApiError` for any non-2xx answer (`status`, `code`, `message`, `fieldErrors` from a `422`, `retryAfter` from `Retry-After`, `requestId` from `X-Request-ID`) and `NetworkError` (`network` or `timeout`) when nothing answers. A `401` outside `/v1/auth/*` triggers one session renewal and one resend; the session code registers its hooks with `registerSessionHooks`, so the client never imports the session. Both come from the vendor portal's client.

## Security rules

Enforced by lint (`eslint.config.js`) and by tests in `src/security` and `src/noHardcodedStyle.test.ts`:

- **No web storage.** No `localStorage`, `sessionStorage` or `indexedDB`. The access token lives in memory; the refresh token is an HttpOnly cookie.
- **No HTML from strings.** No `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` or `insertAdjacentHTML`; no `eval` or `new Function`.
- **No `console.log`.** Only `console.error` is allowed, and never with a token or password.
- **No hard-coded colours or fonts.** Everything comes from the `@shazlo/ui` theme.
- **No stack traces.** The root error boundary and the route error element show a plain message; one `h1` and one page title per screen.
- **Headers from one definition.** `src/security/headers.ts` produces the dev and preview headers and `vercel.json`; a test fails if `vercel.json` drifts. The CSP has `script-src 'self'`, `connect-src` the identity API only, `frame-src` only the registered module origins (`src/security/moduleOrigins.ts`; `'none'` while the list is empty), `frame-ancestors 'none'` (the shell is never framed), `object-src 'none'` and `base-uri 'self'`. Also `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` and, in production only, HSTS.
- **Production build has no inline script**, inline handler, `javascript:` URL or `data:` asset (`security/build.test.ts`).
