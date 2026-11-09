# 0010. Share the security plumbing between identity-api and vendor-api; copy the glue

- Status: proposed
- Date: 2026-11-04 (revised 2026-11-09 after review)
- Issue: #72; implemented by #113 and #114
- Related: [0009-auth-model.md](0009-auth-model.md); `packages/py-auth` (the verifier side); `packages/py-security` (this decision); [ROADMAP](../ROADMAP.md) Phase 2

## Context

`vendor-api` (Phase 2) needs most of what `identity-api` built in Phase 1, because vendors get the same kind of sessions as admins: Argon2 passwords, a rotating refresh token in a cookie with a family in Redis, rate-limited auth endpoints, and an RS256 key ring that issues short-lived access tokens and publishes a JWKS. [0009-auth-model.md](0009-auth-model.md) says vendor-api issues its own tokens with its own key. The roadmap says vendor-api uses "the same conventions as identity-api".

What identity-api had when this ADR was written (Phase 1, merged by PR #71), by size in lines:

| Piece | Lines | Notes |
| --- | --- | --- |
| Refresh-token store (`services/refresh_tokens.py`) | 270 | Families, atomic rotation in Lua, a per-admin generation, a reuse grace window |
| Rate limiter, guard and client-IP helper (`services/rate_limit.py`, `core/client_ip.py`) | 190 | Fixed window, HMAC-hashed subjects, trusted proxies, fail-open or fail-closed per endpoint |
| Password hashing and policy (`services/passwords.py`, `password_policy.py`) | 75 | Argon2id with rehash on login |
| Key ring, token issuer, JWKS document (`services/keys.py`, `tokens.py`, `api/jwks.py`) | 315 | Loads keys, signs, builds the JWKS |
| Request-ID middleware, JSON logging, error handlers (`core/middleware.py`, `logging.py`, `errors.py`) | 180 | Thin glue |

About 850 lines are security code and about 180 are glue.

The cost of copying is not hypothetical. The Phase 1 review produced fixes to exactly these pieces: atomic refresh rotation and session generations (#106) and the rate limiter's lockout and IPv6 handling (#105). With a copy, vendor-api would have needed each of those fixes again, and would silently miss the next one.

Three things make plain sharing harder than moving files:

- The pieces read identity-api's `Settings` and raise its `ApiError`.
- Names that must differ per service were hard-coded: the Redis key prefixes (`rf:`, `ra:`, `rg:`, `rt:`, `rtu:`, `rl:`) and the cookie name (`refresh_token`).
- Both services run under one parent domain and share one Redis, so a prefix or cookie name that is not per service is a bug. A refresh cookie set with `Domain=shazlo.store` by one service is also sent to the other.

## Decision

**Option 3 (hybrid).** Share the security-sensitive code, copy the glue.

### 1. A new package for the shared security code

`packages/py-security` (distribution `shazlo-security`, import `shazlo_security`), typed and with its own tests, installed from the repository path exactly like `packages/py-auth`. It holds:

- the refresh-token store (families, rotation, reuse detection, generations): `refresh_tokens.py`;
- the rate limiter, the guard and the client-IP helper: `rate_limit.py`, `client_ip.py`;
- password hashing and the password policy: `passwords.py`;
- the key ring, the token issuer and the JWKS document: `keys.py`, `tokens.py`.

It does **not** hold logging, the request-ID middleware or the error handlers. Those stay in each service (about 180 lines, rarely change, and a difference between services does no harm). The error shape `{"error": {"code", "message", "request_id"}}` stays a convention, and each service tests it.

A rule keeps the package from becoming a junk drawer: **only code with security consequences that two services use belongs in it.**

### 2. The package never imports a service

Shared code takes small frozen dataclasses (`RefreshTokenConfig`, `RateLimitConfig`, `PasswordConfig`, `KeyRingConfig`), which each service builds from its own `Settings`. It never imports a service's `Settings`, `ApiError` or models; `tests/test_independence.py` fails if it does. It raises its own exceptions and each service maps them to its own error responses:

- `RateLimited` (with `retry_after`) and `RateLimiterUnavailable`;
- `InvalidRefreshTokenError`, `RefreshConflictError` (reuse inside the grace window) and `StaleSessionError`;
- `KeyConfigError`, `PasswordPolicyError` and `TokenWindowClosedError`.

It works with plain IDs, not with `Admin` or `VendorUser`.

### 3. Names that must differ per service

- **Redis prefix is required, with no default.** identity-api uses `identity:` and vendor-api uses `vendor:`. Refresh keys become `identity:rf:<family>` and so on, and the limiter's are `identity:rl:...` and `vendor:rl:...`.
- **Cookie names differ:** `identity_refresh` and `vendor_refresh`, both on path `/v1/auth`.
- **Refresh cookies are host-only.** Neither service sets a `Domain` attribute, so the browser sends each cookie back only to the host that set it. With `Domain=shazlo.store`, an admin's `identity_refresh` cookie would also go to vendor-api (same path), even with distinct names. The `COOKIE_DOMAIN` setting is removed from both services.
- **Each service has its own `RATE_LIMIT_HMAC_KEY`**, so even a prefix mistake could not mix counters.
- **Logs.** The package logs under its own module names (`shazlo_security.rate_limit`, `shazlo_security.refresh_tokens`), so a line from the package has the same `logger` value in both services. Each service's JSON formatter (`core/logging.py`) writes `ts`, `level`, `logger`, `message`, `request_id` and the `extra` fields; none of them names the service. Today a line is told apart only by the process that wrote it: each service writes to its own stdout, so the container or host log stream says which service it is. Adding a `service` field to both formatters is a known follow-up.

This renamed identity-api's existing keys and cookie. That was safe because nothing had been deployed, so no session existed. It would sign everyone out later, so it had to happen before the first deployment (Phase 8).

### 4. How this sits next to `py-auth`

`py-auth` remains the **verifier**: it is what every service that only checks tokens depends on, and it stays small (PyJWT, httpx, optionally FastAPI). `py-security` is the **issuer and session** side and pulls in Redis and Argon2. Services that only verify do not get those dependencies.

**The two packages do not depend on each other.** `py-security` imports nothing from `shazlo_auth`, and its `pyproject.toml` does not list it. A service that issues tokens installs both.

**How vendor tokens are verified.** `py-auth`'s `get_current_admin` is for admin tokens only, so vendor-api does not use it for vendors. Instead:

- `py-auth`'s `TokenVerifier` takes `required_extra_claims` and returns any other claims in `AccessClaims.extra`. It still requires `sub` (a UUID), `roles` (a list) and `kid`, pins RS256 and checks `iss`, `aud` and `exp`.
- vendor-api's `VendorTokens` (`services/tokens.py`) builds a `TokenVerifier` over its own public keys (`StaticKeySource(keyring.public_keys)`, so there is no JWKS fetch for its own tokens), with its own issuer, `aud=vendor-api` and `required_extra_claims=["vendor_id"]`. It then requires `vendor_id` to be a UUID and `roles` to be exactly one of `owner` or `staff`.
- vendor-api's own dependency `current_vendor_user` (`api/deps.py`) takes those claims and re-reads the user and the vendor from the database on every request. A disabled user, a suspended or rejected vendor, or a `vendor_id` that is not the user's vendor is refused at once, not when the token expires.
- `/v1/admin/*` uses `py-auth`'s `require_role("vendor_reviewer")` with a `TokenVerifier` fed by a `JwksClient` on identity-api's JWKS (`IDENTITY_JWKS_URL`, `IDENTITY_ISSUER`). A vendor token fails there, and an admin token fails on the vendor routes, because the issuers and keys differ ([0009-auth-model.md](0009-auth-model.md)).

### 5. Packaging, CI and Docker

Same rules as `py-auth` (see its README and each service's `requirements-shared.txt`):

- Each service lists `packages/py-auth` and `packages/py-security` as `-e ../../packages/<name>` lines in `requirements-shared.txt` and installs that file before itself. Neither package is ever in a `pyproject.toml`. The names `shazlo-auth` and `shazlo-security` are not ours on PyPI, so a plain requirement could install someone else's package (dependency confusion); a path install never asks an index.
- `--config-settings editable_mode=compat`, so mypy can see it.
- The service images are built from the repository root and copy `packages/py-auth` and `packages/py-security`.
- `services-ci.yml` has **no path filters, on purpose**: every pull request and every push to main runs every matrix entry, because a filtered-out job would leave its required `test (...)` check pending. The matrix is `identity-api`, `vendor-api`, `py-auth`, `py-security`. Expressions use `startsWith(matrix.service, 'py-')` to run a package in `packages/<name>` and a service in `services/<name>`; only the services install `requirements-shared.txt`. So a change to the package always runs both services' tests too.
- The package's tests run against fakeredis with Lua, including the rotation scripts.

### 6. Order of work

identity-api moves onto the package first, and its tests stay green apart from the intended rename of prefixes and cookie. vendor-api then starts from the package. Two issues in the Phase 2 milestone do this: #113 (the package, passwords, rate limiter and client IP) and #114 (the refresh-token store, the key ring and issuer, and the `py-auth` extra claims).

### 7. Later change: login rate limits cannot lock an account out

The Phase 2 review follow-up changes the shared guard, and both services' login, in the same pull request:

- `RateLimitGuard.check` counts the checks in the order given and stops at the first one that refuses, without counting the ones after it. Callers put the narrow checks first (per IP, then per email and IP), so a request they already refuse never reaches the loose per-email counter. One client can add only as many hits to a victim's per-email counter as its own narrow limits allow.
- A successful login marks its (email, IP) pair for 30 days (`RateLimitGuard.remember`). A later login from a pair that is marked (`remembers`) skips the per-email counter, so someone guessing from elsewhere cannot lock the owner out on their usual network. If Redis cannot answer, `remembers` returns false and the stricter checks apply.

## Consequences

- A security fix is made and reviewed once, and both services get it in the same change. Vendor sessions behave like admin sessions, which is what [0009-auth-model.md](0009-auth-model.md) describes.
- Phase 2 started later: the package had to exist before vendor-api's key, login and rate-limit issues could use it. The scaffold, compose, schema and email issues were not blocked.
- Any change to the package runs CI for both services (as does every other change, since there are no path filters). In a monorepo with path dependencies both services upgrade in the same pull request, so there are no version pins to manage.
- vendor-api cannot diverge from identity-api in security behaviour by accident. If it needs different behaviour, that becomes a configuration option in the package, not a fork.
- Renaming the Redis prefixes and the cookie in identity-api was a one-time breaking change, acceptable only because nothing is deployed.
- Host-only cookies mean the shell and the vendor portal each talk to their own auth service for refresh; neither can refresh against the other.
- Log lines from the package do not say which service wrote them (see section 3).
- The package boundary needs discipline: no service imports, no growth beyond the rule above, and config through dataclasses.

## Alternatives considered

- **Option 1: copy the code into vendor-api.** Fastest start and no coupling, but two copies of about 850 lines of security code, and the Phase 1 review already showed how often that code changes. Rejected.
- **Option 2: one `py-common` package with everything, including logging, middleware and error handlers.** One style everywhere, but a bigger move now, it ties rarely changing glue to the release cadence of security code, and "common" packages attract unrelated code. Rejected for the glue; kept for the security code (Option 3).
- **Put the shared code into `py-auth`.** One package instead of two, but every service that only verifies tokens would then depend on Redis and Argon2, and `py-auth`'s small surface and strict review would be lost. Rejected.
- **Publish the package to a private index.** Needed only for polyrepo; in this repository path dependencies are simpler and keep the PyPI name risk out. Rejected.
- **Make vendor-api a module of identity-api.** [0009-auth-model.md](0009-auth-model.md) decides on two issuers, each with its own key and JWKS, so that a vendor token can never act as an admin. One service would put both behind one key ring. Out of scope.

## Revisit when

A third service needs sessions, tokens or rate limits (check that the package still has the right scope), the package starts to collect code that is not security-related, or vendor sessions need semantics that cannot be expressed as configuration.
