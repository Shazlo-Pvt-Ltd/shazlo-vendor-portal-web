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
