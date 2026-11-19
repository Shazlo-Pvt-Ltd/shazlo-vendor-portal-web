# app (legacy website)

The consumer landing site, waitlist and the old seller and admin screens: React 19 and Vite, in plain JavaScript. **It is the legacy app**, left untouched until Phase 8 of the [roadmap](../docs/ROADMAP.md); the vendor and admin web apps are being rebuilt under `apps/`. It has its own `package-lock.json` and is not an npm workspace. Its API is the legacy Express service in [`../backend`](../backend/README.md).

## Run it

```bash
npm ci              # in app/
cp .env.example .env
npm run dev         # Vite dev server
npm run build       # production build into dist/
npm run lint
npm test            # the legacy-app Vitest project (run `npm ci` at the repository root first)
```

`VITE_API_URL` in `.env` is the only variable the code reads: the base URL of the pre-registration client in `src/services/api.js`, which calls the `/preregister` routes that `backend` does not mount. Most other screens call hard-coded hosts. `VITE_APP_NAME` and `VITE_APP_VERSION` in `.env.example` are not read.

See [the test strategy](../docs/testing.md) for what the tests cover. `vercel.json` holds the hosting rewrite.
