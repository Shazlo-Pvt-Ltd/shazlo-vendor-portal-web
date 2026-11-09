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

## Client IP (`shazlo_security.client_ip`)

`client_ip(peer, forwarded_for, trusted_networks)` believes `X-Forwarded-For` only when the TCP peer is a trusted proxy, reading it from the right. `rate_limit_subject(ip, ipv6_prefix)` counts IPv6 clients per network. `parse_networks(cidrs)` builds the trusted list.

## Tests

```sh
cd packages/py-security
pip install -e '.[dev]'
ruff check . && ruff format --check . && mypy && pytest
```

No Redis is needed: the tests use `fakeredis`.
