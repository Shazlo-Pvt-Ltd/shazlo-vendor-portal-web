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

`VITE_API_URL` in `.env` is the only variable the code reads: the host of the waitlist and registration backend, for example `http://localhost:5000`. Set it to the host only: `src/config/apiBase.js` builds the waitlist, brand-registration and pre-registration URLs from it (`apiUrl("/api/waitlist/add")`) and joins them with exactly one slash. It drops trailing slashes, surrounding spaces and a trailing `/api` (an older value ended in `/api`), so the URLs never become `//api` or `/api/api`. Unset, it falls back to the hosted waitlist service (`https://shazlo-waitlist-gtge.onrender.com`). Vite reads it at build time, so a change on the hosting side only takes effect on the next build. `src/services/api.js` appends `/api` for the pre-registration client, which calls the `/preregister` routes that `backend` does not mount. Some other screens still call hard-coded hosts. `VITE_APP_NAME` and `VITE_APP_VERSION` in `.env.example` are not read.

See [the test strategy](../docs/testing.md) for what the tests cover. `vercel.json` holds the hosting rewrite.
