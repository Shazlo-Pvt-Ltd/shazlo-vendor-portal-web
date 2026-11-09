# 0010. Share the security plumbing between identity-api and vendor-api; copy the glue

- Status: proposed
- Date: 2026-11-04
- Issue: #72
- Related: [0009 auth model](0009-auth-model.md); `packages/py-auth` (the verifier side); [ROADMAP](../ROADMAP.md) Phase 2

## Context

`vendor-api` (Phase 2) needs most of what `identity-api` built in Phase 1, because vendors get the same kind of sessions as admins: Argon2 passwords, a rotating refresh token in a cookie with a family in Redis, rate-limited auth endpoints, and an RS256 key ring that issues short-lived access tokens and publishes a JWKS (ADR 0009: vendor-api issues its own tokens with its own key). The roadmap says vendor-api uses "the same conventions as identity-api".

What identity-api has today, by size (lines, from the Phase 1 branch):

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
- Names that must differ per service are hard-coded: the Redis key prefixes (`rf:`, `ra:`, `rg:`, `rt:`, `rtu:`, `rl:`), the logger names (`identity_api.*`) and the cookie name (`refresh_token`).
- Both services run on one parent domain and share one Redis, so a prefix or cookie name that is not per service is a bug. A refresh cookie set with `COOKIE_DOMAIN=shazlo.store` by one service is sent to the other.

## Decision

**Option 3 (hybrid).** Share the security-sensitive code, copy the glue.

### 1. A new package for the shared security code

`packages/py-security` (distribution `shazlo-security`, import `shazlo_security`), typed and with its own tests, installed as a path dependency exactly like `packages/py-auth`. It holds:

- the refresh-token store (families, rotation, reuse detection, generations);
- the rate limiter, the guard and the client-IP helper;
- password hashing and the password policy;
- the key ring, the token issuer and the JWKS document builder.

It does **not** hold logging, the request-ID middleware or the error handlers. Those stay in each service (about 180 lines, rarely change, and a difference between services does no harm). The error shape `{"error": {"code", "message", "request_id"}}` stays a convention, and each service tests it.

A rule keeps the package from becoming a junk drawer: **only code with security consequences that two services use belongs in it.**

### 2. The package never imports a service

Shared code takes small frozen dataclasses (for example `RefreshTokenConfig`, `RateLimitConfig`, `PasswordConfig`, `KeyRingConfig`), which each service builds from its own `Settings`. It never imports a service's `Settings`, `ApiError` or models. It raises its own exceptions (`RateLimited` with `retry_after`, `RateLimiterUnavailable`, `InvalidRefreshToken`) and each service maps them to its own error responses. It works with plain IDs, not with `Admin` or `VendorUser`.

### 3. Names that must differ per service

- **Redis prefix is required, with no default.** identity-api uses `identity:` and vendor-api uses `vendor:`. Keys become `identity:rf:<family>` and so on, and `identity:rl:...` for the limiter.
- **Cookie names differ:** `identity_refresh` and `vendor_refresh`.
- **Each service has its own `RATE_LIMIT_HMAC_KEY`**, so even a prefix mistake could not mix counters.
- Logger names stay per service.

This renames identity-api's existing keys and cookie. That is safe now because nothing has been deployed, so no session exists. It would sign everyone out later, so it has to happen before the first deployment (Phase 8).

### 4. How this sits next to `py-auth`

`py-auth` remains the **verifier**: it is what every service that only checks tokens depends on, and it stays small (PyJWT, httpx, optionally FastAPI). `py-security` is the **issuer and session** side and pulls in Redis and Argon2. Services that only verify do not get those dependencies. `py-security` may use `py-auth` types, never the other way round.

vendor tokens carry a `vendor_id` claim that `py-auth`'s `AccessClaims` does not expose. `py-auth` gains a way to read additional claims (for example `AccessClaims.extra`), so vendor-api's own verifier does not need a copy.

### 5. Packaging, CI and Docker

Same rules as `py-auth` (see its README and `requirements-shared.txt`):

- Installed from the repository path through `requirements-shared.txt`, never as a plain `shazlo-security` requirement. The name is not ours on PyPI, so a plain requirement could install someone else's package.
- `--config-settings editable_mode=compat`, so mypy can see it.
- The service images are built from the repository root and copy `packages/py-security`.
- `services-ci` gets a job for the package and both services list it in their path filters, so changing the package re-runs identity-api and vendor-api.
- The package's tests run against fakeredis with Lua, including the rotation scripts.

### 6. Order of work

identity-api moves onto the package first, and its tests stay green apart from the intended rename of prefixes and cookie. vendor-api then starts from the package. Two follow-up issues in the Phase 2 milestone do this: one for the package, passwords, rate limiter and client IP; one for the refresh-token store, the key ring and issuer, and the `py-auth` extra claims.

## Consequences

- A security fix is made and reviewed once, and both services get it in the same change. Vendor sessions behave exactly like admin sessions, which is what ADR 0009 describes.
- Phase 2 starts later: the package has to exist before vendor-api's key, login and rate-limit issues can use it. The scaffold, compose, schema and email issues are not blocked.
- Any change to the package re-runs CI for both services. In a monorepo with path dependencies both services upgrade in the same pull request, so there are no version pins to manage.
- vendor-api cannot diverge from identity-api in security behaviour by accident. If it needs different behaviour, that becomes a configuration option in the package, not a fork.
- Renaming the Redis prefixes and the cookie in identity-api is a one-time breaking change, acceptable only because nothing is deployed.
- The package boundary needs discipline: no service imports, no growth beyond the rule above, and config through dataclasses.

## Alternatives considered

- **Option 1: copy the code into vendor-api.** Fastest start and no coupling, but two copies of about 850 lines of security code, and the Phase 1 review already showed how often that code changes. Rejected.
- **Option 2: one `py-common` package with everything, including logging, middleware and error handlers.** One style everywhere, but a bigger move now, it ties rarely changing glue to the release cadence of security code, and "common" packages attract unrelated code. Rejected for the glue; kept for the security code (Option 3).
- **Put the shared code into `py-auth`.** One package instead of two, but every service that only verifies tokens would then depend on Redis and Argon2, and `py-auth`'s small surface and strict review would be lost. Rejected.
- **Publish the package to a private index.** Needed only for polyrepo; in this repository path dependencies are simpler and keep the PyPI name risk out. Rejected.
- **Make vendor-api a module of identity-api.** Contradicts ADR 0007 and ADR 0009 (separate identities, separate issuers). Out of scope.

## Revisit when

A third service needs sessions, tokens or rate limits (check that the package still has the right scope), the package starts to collect code that is not security-related, or vendor sessions need semantics that cannot be expressed as configuration.
