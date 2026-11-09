# shazlo-auth

Verifies identity-api access tokens the same way in every service, so security code is not copied between them (ADR 0009). Used by `services/identity-api` and, later, `vendor-api` and the vendor-admin backend.

## Install (path dependency)

`shazlo-auth` is not published, and the name is not ours on PyPI. So a service must **not** list `shazlo-auth` in its `pyproject.toml` dependencies: pip could then satisfy it from an index with someone else's package (dependency confusion). Instead, the service puts the path in a `requirements-shared.txt` next to its `pyproject.toml`:

```text
--config-settings editable_mode=compat -e ../../packages/py-auth[fastapi]
```

Keep the option **before** `-e`. Dependabot reads the text after `-e` as the path, so an option after it breaks every Python dependency update; pip accepts either order.

and installs that first, from the service directory (CI does the same whenever the file exists):

```sh
pip install -r requirements-shared.txt
pip install -e '.[dev]'
```

`editable_mode=compat` keeps the package visible to mypy. In Docker, build from the repository root and build `packages/py-auth` from its path along with the service (see `services/identity-api/Dockerfile`).

## Use

```python
from shazlo_auth import JwksClient, TokenVerifier
from shazlo_auth.fastapi import get_current_admin, require_role

keys = JwksClient.from_url("https://identity.shazlo.store/.well-known/jwks.json")
app.state.token_verifier = TokenVerifier(
    keys, issuer="https://identity.shazlo.store", audience="vendor-api"
)


@router.get("/reviews", dependencies=[Depends(require_role("vendor_reviewer"))])
async def reviews(admin: AuthenticatedAdmin = Depends(get_current_admin)): ...
```

Create the `JwksClient` once per process, never per request: it holds the cache.

## What it checks

- **Algorithm:** `RS256` only. The header is checked before any key is looked up, so `none`, `HS*` (including an HMAC keyed with the public key) and other algorithms are refused.
- **Claims:** `iss` and `aud` must match, `exp` is checked with 30 seconds of leeway. `aud` must be exactly this service's name as one string (a list is refused). `sub` (a UUID), `roles` (a list of strings), `jti`, `iat` and the `kid` header are required.
- **Roles:** `require_role(*roles)` passes an admin who holds any of them. `super_admin` always passes. `get_current_admin` refuses a token that only allows a password change (`must_change_password`).
- **Errors:** missing or invalid token is `401` with `WWW-Authenticate: Bearer`, a missing role is `403`. Both are plain `HTTPException`s, so the service's own error handlers shape the response.

## Extra claims

A service can put claims of its own into its tokens (vendor-api adds `vendor_id`). `AccessClaims.extra` returns every claim the verifier does not read itself, as a read-only mapping. To refuse a token that lacks one, list it:

```python
verifier = TokenVerifier(
    keys,
    issuer="https://vendor.shazlo.store",
    audience="vendor-api",
    required_extra_claims=["vendor_id"],
)
claims = await verifier.verify(token)
claims.extra["vendor_id"]
```

A token without the claim, or with it set to `null`, raises `InvalidTokenError`. The claims the verifier already reads (`sub`, `roles`, ...) cannot be listed.

## JWKS client

| Rule | Value |
|---|---|
| Cache | 10 minutes |
| Refetch on an unknown `kid` or an expired cache | at most once per minute, whatever the traffic (successes and failures count) |
| Expired cache, cached `kid` | answered at once from the cache; one refresh runs in the background |
| Unknown `kid` | waits for a fetch (or for the background refresh already running) |
| Concurrent callers | share one fetch |
| Fetch fails | the last good keys stay in use; the next try waits for the minute. Before the first success every token is rejected |
| Bad document (no usable key) | treated as a failed fetch, so it never replaces good keys |
| Keys accepted | RSA, 2048 bits or more, `use` `sig` (or absent), `alg` `RS256` (or absent), with a `kid` |
| URL | `https` only. Plain `http` only for `localhost`, `127.0.0.1` or `::1`, or with `allow_insecure=True` (a trusted private network, e.g. a compose hostname) |
| Fetch limits | 3 seconds for the whole fetch (`timeout=`), 256 KiB body, read as a stream and abandoned past the limit |

Consequence of the one-minute bound: a token signed with a brand-new key can be rejected for up to a minute after the last fetch. ADR 0009 avoids that by publishing a key one cache TTL before signing with it.

Consequence of the background refresh: a key removed from the JWKS is still accepted until the refresh that follows the cache expiry finishes (at most the fetch timeout later).

A service that holds its keys itself (identity-api) passes `StaticKeySource` instead, so there is no HTTP call.

## Develop

```sh
cd packages/py-auth
pip install -e '.[dev]'
ruff check . && ruff format --check . && mypy && pytest
```
