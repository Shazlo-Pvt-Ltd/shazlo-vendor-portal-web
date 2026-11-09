# shazlo-security

Security code that identity-api and vendor-api share instead of copying (ADR 0010): password hashing, rate limiting and client-IP detection. Import name: `shazlo_security`. It imports nothing from a service (a test fails if it does): a service passes in its configuration and maps the exceptions raised here to its own HTTP errors.

## Install (path dependency)

Like `shazlo-auth`, it is not published and the name is not ours on PyPI, so a service must **not** list it in its `pyproject.toml`. Put the path in `requirements-shared.txt` and install that first:

```text
-e ../../packages/py-security --config-settings editable_mode=compat
```

```sh
pip install -r requirements-shared.txt
pip install -e '.[dev]'
```

In Docker, build from the repository root, copy `packages/py-security` and add it to the `pip wheel` command (see `services/identity-api/Dockerfile`).

## Passwords (`shazlo_security.passwords`)

- `PasswordConfig(time_cost, memory_cost_kib, parallelism)`: Argon2id cost. Defaults are the OWASP baseline; raising them rehashes on the next successful login.
- `PasswordService(config)`: `hash`, and `verify_login(stored_hash | None, password)` which returns `PasswordCheck(ok, new_hash)`. An unknown account still pays for a full verification. The CPU-heavy calls run in a thread.
- `check_password(password, email=..., min_length=...)` raises `PasswordPolicyError`; `MAX_PASSWORD_LENGTH` is 128.

## Rate limiting (`shazlo_security.rate_limit`)

- `RedisRateLimiter(redis, prefix)`: fixed-window counters. The key **prefix is required** (identity-api uses `identity:rl:`, vendor-api will use `vendor:rl:`), so two services on one Redis never see each other's counters.
- `RateLimitGuard(limiter, RateLimitConfig(hmac_key, fail_closed))`: `check(endpoint, [Check(scope, subject, RateRule(limit, window_seconds))])` hits every counter and raises `RateLimited(retry_after)` if any is over. Subjects are hashed with the HMAC key, so Redis holds no emails or IPs. If Redis is down, endpoints in `fail_closed` raise `RateLimiterUnavailable`; the others skip the limit and log a warning. `reset` never raises.
- The service maps `RateLimited` to `429` with `Retry-After` and `RateLimiterUnavailable` to `503`.

## Refresh tokens (`shazlo_security.refresh_tokens`)

`RefreshTokenStore(redis, RefreshTokenConfig(prefix, token_ttl, family_max_ttl, reuse_grace_seconds))` keeps sessions as token families in Redis. The **prefix is required**. Subjects are plain UUIDs (an admin, a vendor user); the store knows nothing else about them. Only SHA-256 hashes of tokens are stored.

- `generation(subject)`, then `start_family(subject, generation)` at login. If `revoke_all` ran in between (a password change raced the login), `StaleSessionError` is raised.
- `rotate(token)` exchanges a token for the next one in its family, atomically (Lua). A token that was already used revokes the whole family and raises `InvalidRefreshTokenError`, unless it was used less than `reuse_grace_seconds` ago: then `RefreshConflictError` is raised and nothing is revoked (a second tab).
- `revoke_by_token`, `revoke_family`, `revoke_all(subject)` (also bumps the subject's generation) and `family_id_of(token)` (for rate limits).

Redis key layout, each key starting with the prefix (for example `identity:`):

| Key | Holds |
| --- | --- |
| `<prefix>rf:<family>` | hash `{subject_id, expires_at, generation}`: the family and its hard limit |
| `<prefix>ra:<subject>` | set of the subject's family IDs, so every session can be ended at once |
| `<prefix>rg:<subject>` | the subject's session generation |
| `<prefix>rt:<hash>` | the family a token belongs to; lives as long as the token |
| `<prefix>rtu:<hash>` | when the token was used (Unix seconds), written once by the rotation |

Cookie names are the service's business, and must differ per service: identity-api uses `identity_refresh`, vendor-api will use `vendor_refresh`.

## Keys and tokens (`shazlo_security.keys`, `shazlo_security.tokens`)

- `KeyRingConfig(keys_dir, keys_json, signing_kid)` and `load_keyring(config)` build a `KeyRing`: RSA keys of at least 2048 bits from `<kid>.pem` files and/or a JSON object, one of them signing and the others published only (rotation). Private key files must not be readable by other users. `KeyRing.jwks()` is built from public keys only. `generate_private_key`, `new_kid` and `write_new_key` are what a service's `generate-key` command calls.
- `TokenIssuer(issuer, keyring, access_ttl_seconds=...)` signs RS256 access tokens (one audience, ids and roles only). `extra_claims={"vendor_id": ...}` adds claims of the service's own; a claim the issuer sets itself (`iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `roles`, ...) cannot be replaced. Verify with `packages/py-auth`, which returns the extra claims and can require them.

## Client IP (`shazlo_security.client_ip`)

`client_ip(peer, forwarded_for, trusted_networks)` believes `X-Forwarded-For` only when the TCP peer is a trusted proxy, reading it from the right. `rate_limit_subject(ip, ipv6_prefix)` counts IPv6 clients per network. `parse_networks(cidrs)` builds the trusted list.

## Tests

```sh
cd packages/py-security
pip install -e '.[dev]'
ruff check . && ruff format --check . && mypy && pytest
```

No Redis is needed: the tests use `fakeredis`.
