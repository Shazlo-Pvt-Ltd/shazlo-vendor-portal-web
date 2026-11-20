# Shazlo backend (legacy)

A Node.js/Express backend with MongoDB for the consumer waitlist, brand registration, catalog upload and the old seller approval screens. **It is the legacy service**: the rewrite replaces its vendor and admin parts with `services/vendor-api` and `services/identity-api` and leaves it untouched until Phase 8 of the [roadmap](../docs/ROADMAP.md). It has no authentication, so the admin and upload endpoints below are **off by default**: they are mounted only when `LEGACY_ADMIN_ENABLED=true`, which is for local development. On a deployed service leave it unset; those routes then answer `404`.

## Prerequisites

- Node.js (see the `engines` field of the root `package.json`)
- A MongoDB database (Atlas or local) for running it; the tests start their own

## Installation

1. **Install dependencies:**

   ```bash
   npm ci
   ```

2. **Environment setup:** copy `.env.example` to `.env` and set `MONGODB_URI` (the connection string with your credentials) and, for image uploads, the three `CLOUDINARY_*` values. `PORT` defaults to 5000. `LEGACY_ADMIN_ENABLED=true` mounts the unauthenticated `/api/admin` and `/api/upload` routes (needed by the legacy admin screens, which call `http://localhost:5000`). `CORS_ORIGIN` is a comma-separated list of allowed origins (for example `https://shazlo.store,https://www.shazlo.store`); unset, every origin is allowed and the server logs a warning, so set it wherever the service is deployed. `JWT_SECRET` is in the example file but no code reads it.

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

## Data models

`models/`: `Brand`, `Product` (status `pending`, `approved` or `rejected`), `WaitlistUser` and `PreRegister` (not used by a mounted route). What the rewrite takes from them is listed in the [roadmap](../docs/ROADMAP.md#what-carries-over-from-the-legacy-code).

## Environment variables read by the code

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
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

There is no Dockerfile or deployment configuration for this service in the repository. It has no rate limiting and no authentication: keep `LEGACY_ADMIN_ENABLED` unset, set `CORS_ORIGIN` to the site's origins, and it is still not production-ready as it stands.
