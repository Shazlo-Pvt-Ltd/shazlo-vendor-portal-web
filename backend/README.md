# Shazlo backend (legacy)

A Node.js/Express backend with MongoDB for the consumer waitlist, brand registration, catalog upload and the old seller approval screens. **It is the legacy service**: the rewrite replaces its vendor and admin parts with `services/vendor-api` and `services/identity-api` and leaves it untouched until Phase 8 of the [roadmap](../docs/ROADMAP.md). It has no authentication, so the admin and upload endpoints below are **off by default**: they are mounted only when `LEGACY_ADMIN_ENABLED=true`, which is for local development. On a deployed service leave it unset; those routes then answer `404`. Every route that touches the database is rate-limited per client address (see [Rate limits](#rate-limits)).

## Prerequisites

- Node.js (see the `engines` field of the root `package.json`)
- A MongoDB database (Atlas or local) for running it; the tests start their own

## Installation

1. **Install dependencies:**

   ```bash
   npm ci
   ```

2. **Environment setup:** copy `.env.example` to `.env` and set `MONGODB_URI` (the connection string with your credentials) and, for image uploads, the three `CLOUDINARY_*` values. `PORT` defaults to 5000. Behind a proxy (Render), also set `TRUST_PROXY` (see [Rate limits](#rate-limits)). The example sets `LEGACY_ADMIN_ENABLED=false`; change it to `true` in your local `.env` only, to mount the unauthenticated `/api/admin` and `/api/upload` routes that the legacy admin screens call at `http://localhost:5000`. `CORS_ORIGIN` is a comma-separated list of allowed origins (for example `https://shazlo.store,https://www.shazlo.store`); unset, every origin is allowed and the server logs a warning, so set it wherever the service is deployed. `JWT_SECRET` is in the example file but no code reads it.

3. **Database setup:** none. Mongoose creates the collections on first use. With Atlas, allow your IP address in Network Access.

## Running the application

```bash
npm run dev     # nodemon
npm start       # node server.js
```

The server listens on port 5000 (or `PORT`). The Express application itself is `app.js`; `server.js` connects to MongoDB and starts listening.

## API endpoints

Mounted in `app.js`:

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` | Health check |
| `POST /api/waitlist/add` | Add `{ name, email, gender, city }` to the waitlist; a repeated email answers `200` with `alreadyAdded: true` |
| `POST /api/register-brand` | Register a brand |
| `POST /api/upload/images` (only with `LEGACY_ADMIN_ENABLED=true`) | Upload images (multipart field `images`) to Cloudinary and return their URLs |
| `POST /api/upload/products` (only with `LEGACY_ADMIN_ENABLED=true`) | Save `{ products, sellerId }`; every product is stored as `pending` |
| `GET /api/admin/sellers` (all `/api/admin` routes: only with `LEGACY_ADMIN_ENABLED=true`) | List sellers |
| `GET /api/admin/products`, `GET /api/admin/products/:sellerId` | List products, or one seller's |
| `PUT /api/admin/products/:productId/approve`, `PUT /api/admin/products/:productId/reject` | Approve or reject a product |

`routes/preRegister.js` (pre-registration with email confirmation) and its model exist but are **not mounted**, so `/api/preregister/*` does not respond.

## Rate limits

Each client address gets a budget per 15 minutes (`lib/rateLimits.js`):

| Class | Routes | Requests per 15 min |
| --- | --- | --- |
| Public forms | `POST /api/waitlist/add` and `POST /api/register-brand`, each on its own | 50 |
| Pre-registration (not mounted) | `register` | 5 |
| Lookups | pre-registration `confirm`, `check` and `stats` (not mounted) | 60 |
| Uploads (only with `LEGACY_ADMIN_ENABLED=true`) | `POST /api/upload/images` and `POST /api/upload/products`, together | 30 |
| Admin (only with `LEGACY_ADMIN_ENABLED=true`) | every `/api/admin` route, together | 300 |

Over the budget, a route answers `429` with `{ "message": "Too many requests, please try again later." }` and the `RateLimit` and `RateLimit-Policy` headers. `GET /api/health` and unknown routes are not limited: they do not touch the database. IPv6 clients are counted per /56, so one client cannot rotate through its own addresses. The counts live in the process's memory: a restart resets them, and running more than one instance would need a shared store.

The client address is Express's `req.ip`, which depends on **`TRUST_PROXY`**:

- **Unset** (local development, tests): the TCP peer. Behind a proxy this would make every visitor share the proxy's address and therefore one budget, so on Render (where `RENDER` is set) the server **refuses to start** without it. Set `TRUST_PROXY=false` to run there without trusting any proxy on purpose.
- **A hop count**: the address that many entries from the right of `X-Forwarded-For`, which the proxies add and the client cannot forge. A comma-separated list of proxy addresses or subnets (`loopback`, `10.0.0.0/8`) also works. **On Render, start with `2`**: a request goes client → Cloudflare → Render's proxy → app and arrives with `X-Forwarded-For: <client>, <Cloudflare edge>`, so `1` would make every visitor look like a Cloudflare address. Render does not remove an `X-Forwarded-For` the client sends, which is why the count must not be too high either. Render does not document the chain, so confirm it with the check below.
- `true`, or a subnet that covers every address (`0.0.0.0/0`, `::/0`), is **refused at startup**: it would trust an `X-Forwarded-For` that the client writes itself. Do not combine subnets that together cover the internet either.

To check the value after a deploy, without writing anything to the database (an empty body is refused before any query, but it still counts):

```bash
# From network A (for example a laptop on Wi-Fi): the 51st request answers 429.
for i in $(seq 1 51); do curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{}' https://<service>/api/waitlist/add; done | sort | uniq -c
# Still on network A: a forged header must not get a fresh budget, so this must answer 429 too.
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -H "X-Forwarded-For: 203.0.113.9" -d '{}' https://<service>/api/waitlist/add
# From network B (for example a phone on mobile data), within the same 15 minutes, the same
# request must answer 400, not 429.
```

If network B is also limited, `TRUST_PROXY` is too low (every visitor shares one budget): raise it by one. If the forged header gets a `400`, it is too high (clients choose their own budget): lower it by one.

## Other limits

- JSON and form bodies: 100 KB, except `POST /api/upload/products` (5 MB, read only after its rate limit). Larger bodies answer `413`; compressed bodies are measured after decompression.
- `POST /api/upload/products`: `sellerId` must be a 24-character ObjectId and `products` a list of 1 to 1000 objects.
- `POST /api/upload/images`: at most 20 images of 5 MB each, declared as JPEG, PNG, WebP, GIF, AVIF or HEIC/HEIF (not SVG, which can carry script; a `.heic`/`.heif` file the browser could not name is accepted too), and at most 10 small text fields beside them.
- Only strings reach a database query: an object such as `{"$gt": ""}` in an email or id answers `400`. Mongoose's `sanitizeFilter` is on as a second line of defence.
- Errors answer in JSON without the underlying error text or a stack trace; the details go to the server log.

## Data models

`models/`: `Brand`, `Product` (status `pending`, `approved` or `rejected`), `WaitlistUser` and `PreRegister` (not used by a mounted route). What the rewrite takes from them is listed in the [roadmap](../docs/ROADMAP.md#what-carries-over-from-the-legacy-code).

## Environment variables read by the code

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
TRUST_PROXY=
CORS_ORIGIN=
LEGACY_ADMIN_ENABLED=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

## Testing

```bash
npm test            # in backend/: the legacy-backend Vitest project (run `npm ci` at the repository root first)
npm test            # at the repository root: every Vitest project
```

The integration suite starts its own disposable MongoDB process (it downloads the binary on the first run) and never uses `MONGODB_URI`. See [the test strategy](../docs/testing.md).

## Deployment

There is no Dockerfile or deployment configuration for this service in the repository. It has no authentication: keep `LEGACY_ADMIN_ENABLED` unset, set `CORS_ORIGIN` to the site's origins and `TRUST_PROXY` wherever it runs behind a proxy (its rate limits need it), and it is still not production-ready as it stands.
