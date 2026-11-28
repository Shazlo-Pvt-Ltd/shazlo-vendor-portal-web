# Local end to end: Vendor Portal, Shazlo One and the Vendors module

Runs every piece on one machine, walks a product from a seller to an admin and back, and then stops each
vendor app in turn to show the failure isolation of [ADR 0011](../adr/0011-vendor-portal-and-vendors-module-as-microservices.md).
The CI `compose` job (`.github/workflows/services-ci.yml`) runs the API half of this on every pull request.

| Piece | Address | What it is |
|---|---|---|
| identity-api | http://localhost:8001 | Admin sign-in and module tokens (ADR 0009) |
| vendor-api, seller app | http://localhost:8002 | The Vendor Portal's backend: `/v1/auth`, `/v1/vendor/*`, `/v1/public/*` |
| vendor-admin-api, admin app | http://localhost:8004 | The Vendors module's backend: `/v1/admin/*` only, same database |
| central-stub | http://localhost:8003 | Stand-in for the central app; holds what was published |
| Mailpit | http://localhost:8025 | Every email vendor-api sends |
| Vendor Portal | http://localhost:5174 | The seller web app |
| Vendors module | http://localhost:5193 | Shazlo One's review and vendor management, framed by the shell |
| Shazlo One | http://localhost:5192 | The admin shell |

Other projects on the machine may hold these ports. Every host port comes from `.env`
(`IDENTITY_API_PORT`, `VENDOR_API_PORT`, `VENDOR_ADMIN_API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, ...); change
them there and use the same ports below. Never point a test run at another project's Redis: the e2e tests
flush database 1 of whatever `REDIS_URL` names.

## 1. Start the backends

From the repository root, with Docker running:

```bash
cp .env.example .env                       # then set POSTGRES_PASSWORD
docker compose up -d --wait                # Postgres, Redis, Mailpit
docker compose --profile full build
```

Each service signs with its own key, passed as one line of JSON (a bind-mounted PEM fails the file-mode
check). Generate both into `.env`:

```bash
for svc in identity vendor; do
  line=$(docker compose --profile $svc run --rm --no-deps -T $svc-api python -c "import json; from shazlo_security.keys import generate_private_key, new_kid, private_key_pem; print('$(echo $svc | tr a-z A-Z)_JWT_KEYS=' + json.dumps({new_kid(): private_key_pem(generate_private_key()).decode()}, separators=(',', ':')))")
  grep -v "^$(echo $svc | tr a-z A-Z)_JWT_KEYS=" .env > .env.new && printf '%s\n' "$line" >> .env.new && mv .env.new .env
done
```

Migrate, seed one super admin and the demo vendor, and start everything:

```bash
docker compose --profile identity run --rm identity-api alembic upgrade head
docker compose --profile identity run --rm -e SEED_ADMIN_EMAIL=admin@shazlo.test \
  -e SEED_ADMIN_PASSWORD='<12+ characters>' identity-api python -m identity_api.cli seed
docker compose run --rm vendor-cli alembic upgrade head                 # as the owner of the tables
docker compose run --rm vendor-cli python -m vendor_api.cli db-logins  # each app's own login
docker compose run --rm -e SEED_VENDOR_PASSWORD='<12+ characters>' \
  vendor-cli python -m vendor_api.cli seed-dev
echo CENTRAL_PUBLISHING_ENABLED=true >> .env
docker compose --profile full up -d --wait
curl -fsS localhost:8001/ready; curl -fsS localhost:8002/ready; curl -fsS localhost:8004/ready
```

The seeded admin must change the password at the first sign-in (Shazlo One asks; identity-api refuses a
token exchange until then). The demo seller is `owner@demo-brand.test`.

The vendor apps log in as their own users (`vendor_seller_app`, `vendor_admin_app`, `vendor_worker_app`),
each with only its table rights; their passwords are the `VENDOR_*_DB_PASSWORD` in `.env`. To see what
one may not do:

```bash
docker compose exec -T postgres psql -U vendor_admin_app -d vendor -c 'SELECT count(*) FROM auth_tokens'
# ERROR:  permission denied for table auth_tokens
```

**Check the split.** Each vendor app answers only its own routes:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8002/v1/admin/me     # 404
curl -s -o /dev/null -w '%{http_code}\n' localhost:8004/v1/vendor/me    # 404
```

## 2. Start the three web apps

Each in its own terminal, from the repository root (`npm ci` first):

```bash
cp apps/vendor-portal/.env.example apps/vendor-portal/.env.local      # VITE_VENDOR_API_URL=http://localhost:8002
npm run dev -w @shazlo/vendor-portal                                   # :5174

npm run serve -w @shazlo/mock-vendor-api                               # :5194, see the note below
npm run dev -w @shazlo/vendor-admin                                    # :5193

echo VITE_MOCK_API=off > apps/shazlo-one/.env.local                    # real identity-api; registry/development.json
npm run dev -w @shazlo/shazlo-one                                      # :5192
```

identity-api must allow the shell: `CORS_ALLOWED_ORIGINS=http://localhost:5192,http://localhost:4192` and, over
plain http, `COOKIE_SECURE=false` (see `apps/shazlo-one/README.md`).

**Note.** Until the Vendors module moves onto vendor-api's admin routes (#294 to #298), its screens still
read the mock vendor-api on :5194, which accepts only the identity mock's tokens. With the real identity-api,
Shazlo One's Home and badge already come from the real admin app (`GET :8004/v1/admin/module-summary`); review
decisions in step 3 are made with the API until then.

## 3. Walk a product through

1. **Seller** (http://localhost:5174, the demo seller): edit a product and submit it for review.
2. **Admin** (http://localhost:5192, the seeded admin): Home's Vendors card counts one more waiting, and so
   does the badge on Vendors in the sidebar.
3. **Decide** with the admin app. Get a module token, then approve one product and reject another with a reason:

   ```bash
   admin=$(curl -fsS localhost:8001/v1/auth/login -H 'content-type: application/json' \
     -d '{"email": "admin@shazlo.test", "password": "<new password>"}' | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
   token=$(curl -fsS localhost:8001/v1/auth/token -H 'content-type: application/json' -H "Authorization: Bearer $admin" \
     -d '{"audience": "vendor-api"}' | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
   curl -fsS 'localhost:8004/v1/admin/reviews?subject=product' -H "Authorization: Bearer $token"
   curl -fsS -X POST localhost:8004/v1/admin/reviews/<id>/approve -H "Authorization: Bearer $token" \
     -H 'content-type: application/json' -d '{"version": <version>}'
   curl -fsS -X POST localhost:8004/v1/admin/reviews/<other id>/reject -H "Authorization: Bearer $token" \
     -H 'content-type: application/json' -d '{"version": <version>, "reason": "The second photo is blurred."}'
   ```

4. **Admin**: Home shows both under Recent decisions, by the admin's name.
5. **Seller**: one product is live; the other is sent back with the reason word for word.
6. **Published**: `curl -fsS localhost:8003/_stub/state` holds only the approved product.

## 4. Failure drill

**The admin app is down.** Sellers carry on; Shazlo One stays up and only Vendors says so.

```bash
docker compose --profile vendor stop vendor-admin-api
```

- The Vendor Portal still signs in, edits and submits (it never calls :8004).
- Shazlo One still signs in, and Admins & roles and Change password work. On Home, only the Vendors card
  says its figures did not load, and the Vendors row has no badge (never a 0). Each summary request gives up
  after 5 seconds.

```bash
docker compose --profile vendor start vendor-admin-api
```

**The seller app is down.** Reviewing carries on.

```bash
docker compose --profile vendor stop vendor-api
docker compose --profile vendor up -d --wait --no-deps vendor-admin-api
curl -fsS localhost:8004/v1/admin/reviews -H "Authorization: Bearer $token"          # answers
curl -fsS localhost:8004/v1/admin/module-summary -H "Authorization: Bearer $token"   # answers
docker compose --profile vendor start vendor-api
```

**The Vendors module's web app is down** (stop `npm run dev -w @shazlo/vendor-admin`). Shazlo One shows Vendors
under its registry title with no pages; opening it shows "did not load" with Try again, and after three
silent attempts "Vendors is unavailable right now". Home and Admins & roles still work.

**The vendor database is down** (`docker compose stop postgres`). Both vendor apps fail their `/ready`: this
is the one failure they share. identity-api has its own database in the same Postgres server locally, so it
fails too here; in production it is a separate database.

## 5. Stop

```bash
docker compose --profile full down          # add -v to drop the databases as well
```
