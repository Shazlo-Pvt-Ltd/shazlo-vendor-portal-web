# Shazlo backend (legacy)

A Node.js/Express backend with MongoDB for the consumer waitlist, brand registration, catalog upload and the old seller approval screens. **It is the legacy service**: the rewrite replaces its vendor and admin parts with `services/vendor-api` and `services/identity-api` and leaves it untouched until Phase 8 of the [roadmap](../docs/ROADMAP.md). It has no authentication: the admin and catalog upload endpoints below are public, so anyone who can reach the service can list every seller (with phone and email), approve or reject products and add products for any seller. Rate limits only slow that down.

## Prerequisites

- Node.js (see the `engines` field of the root `package.json`)
- A MongoDB database (Atlas or local) for running it; the tests start their own

## Installation

1. **Install dependencies:**

   ```bash
   npm ci
   ```

2. **Environment setup:** copy `.env.example` to `.env` and set `MONGODB_URI` (the connection string with your credentials) and, for image uploads, the three `CLOUDINARY_*` values. `PORT` defaults to 5000. Behind a reverse proxy, set `TRUST_PROXY` (see [Rate limits](#rate-limits)). `JWT_SECRET` and `CORS_ORIGIN` are in the example file but no code reads them today.

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
| `GET /api/health` | Health check (not rate-limited) |
| `POST /api/waitlist/add` | Add `{ name, email, gender, city }` to the waitlist; a repeated email (compared lowercased and trimmed) answers `200` with `alreadyAdded: true` |
| `POST /api/register-brand` | Register a brand |
| `POST /api/upload/images` | Upload images (multipart field `images`) to Cloudinary and return their URLs |
| `POST /api/upload/products` | Save `{ products, sellerId }`; every product is stored as `pending` |
| `GET /api/admin/sellers` | List sellers |
| `GET /api/admin/products`, `GET /api/admin/products/:sellerId` | List products, or one seller's |
| `PUT /api/admin/products/:productId/approve`, `PUT /api/admin/products/:productId/reject` | Approve or reject a product; `approve` takes an optional `adminId` |

`routes/preRegister.js` (pre-registration with email confirmation) and its model exist but are **not mounted**, so `/api/preregister/*` does not respond. Its `/confirm` and `/stats` handlers call model methods that do not exist, so they would answer `500` if it were mounted.

Errors are answered in JSON without stack traces or database error text; the details go to the server log.

## Input validation

A JSON or urlencoded body can carry an object such as `{"$gt": ""}` where a string is expected, and MongoDB would read it as an operator (NoSQL injection). So:

- Every value that reaches a query is checked to be a string first; anything else answers `400`. `POST /api/waitlist/add` answers `400` when a field is not a string or the email is not an address. `PUT .../approve` answers `400` unless `adminId` is absent or a 24-hex-character ObjectId (the legacy admin screen sends `"admin123"`, which the schema could never store; that used to fail with a `500`). Malformed `:productId` and `:sellerId` values answer `400` instead of a `500`.
- As defence in depth, `app.js` sets Mongoose's `sanitizeFilter`, which turns any `$` operator object in a query filter into a literal `$eq` match. Keep Mongoose at 8.24.7 or later: earlier 8.x releases skipped it for `$nor` and `countDocuments`.
- Email addresses are checked by `lib/validation.js` in linear time (at most 254 characters). The model's previous pattern backtracked exponentially on inputs such as `"a@a" + "a".repeat(30)`.
- `POST /api/upload/images` accepts at most 20 files of at most 5 MB each (they are held in memory), declared as JPEG, PNG, WebP, GIF or AVIF: other types answer `415`, too many or too large `413`. `POST /api/upload/products` takes a valid `sellerId` and 1 to 1000 product objects.

## Rate limits

Every route except the health check is limited per client IP with [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), in windows of 15 minutes (`lib/rateLimits.js`):

| Class | Requests per 15 minutes | Routes |
| --- | --- | --- |
| Public submit | 20 | `POST /api/waitlist/add`, `POST /api/register-brand` (counted separately), `POST /api/preregister/register` |
| Lookup | 60 | `GET /api/preregister/confirm/:token`, `/check/:email`, `/stats` |
| Upload | 30 | `POST /api/upload/images` and `/products`, together |
| Admin | 300 | every `/api/admin/*` route, together |

A request over the limit answers `429` with `{ "message": "Too many requests, please try again later." }`; every response carries `RateLimit` and `RateLimit-Policy` headers (IETF draft 8). The counters live in the process memory: they reset on restart, and with more than one instance each instance counts separately. `createApp({ rateLimits })` in `app.js` overrides the budgets; the tests use it.

### Client IP and `TRUST_PROXY`

The limits key on `req.ip`, which comes from Express's `trust proxy` setting, read from `TRUST_PROXY` (`lib/trustProxy.js`):

- **Unset** (the default): no proxy is trusted and `req.ip` is the TCP peer. Right for local development and tests. Behind a proxy it is wrong in a harmful way: every client appears as the proxy and they all share one budget, so 20 people could fill the waitlist budget for everyone.
- **A number**: the count of proxies in front of the app. Express takes the address that many entries from the right of `X-Forwarded-For`, which the client cannot forge.
- **Addresses or subnets**: a comma-separated list such as `loopback, uniquelocal` or `10.0.0.0/8`, for proxies with known addresses.
- **`true` is refused** at startup: it trusts the left-most `X-Forwarded-For` entry, which any client can set to get a fresh budget.

The service is hosted on Render (`*.onrender.com`, called from `app/`), which sits behind a proxy chain whose length Render does not document. Before deploying, find the right number: deploy with a temporary route that returns `req.ip`, call it, and raise `TRUST_PROXY` from `1` until it shows your own public IP; then remove the route. On Render, `server.js` logs a warning at startup while `TRUST_PROXY` is unset, and express-rate-limit logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` when a proxy header arrives that is not trusted.

## Data models

`models/`: `Brand`, `Product` (status `pending`, `approved` or `rejected`), `WaitlistUser` and `PreRegister` (not used by a mounted route). What the rewrite takes from them is listed in the [roadmap](../docs/ROADMAP.md#what-carries-over-from-the-legacy-code).

## Environment variables read by the code

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
# Number of proxies in front of the app (or their addresses); unset trusts none. See "Rate limits".
TRUST_PROXY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

`RENDER`, which Render sets itself, only switches on the startup warning about `TRUST_PROXY`.

## Testing

```bash
npm test            # in backend/: the legacy-backend Vitest project (run `npm ci` at the repository root first)
npm test            # at the repository root: every Vitest project
```

The integration suite starts its own disposable MongoDB process (it downloads the binary on the first run) and never uses `MONGODB_URI`. See [the test strategy](../docs/testing.md).

## Deployment

There is no Dockerfile or deployment configuration for this service in the repository; `app/` calls it on Render. Set `TRUST_PROXY` there (see [Rate limits](#rate-limits)). It enables CORS for every origin and has no authentication, so it is not production-ready as it stands: the admin and catalog upload routes must not be reachable from the internet until they require a credential.
