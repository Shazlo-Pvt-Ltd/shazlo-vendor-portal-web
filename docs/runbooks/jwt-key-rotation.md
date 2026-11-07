# Runbook: rotate a JWT signing key (identity-api and vendor-api)

identity-api signs admin tokens and vendor-api signs vendor tokens, each with **its own** RS256 private key, and each publishes its public keys at `GET /.well-known/jwks.json` ([ADR 0009](../adr/0009-auth-model.md)). The two keys are independent: rotate one service at a time, and never give one service the other's key. The steps are the same for both; where they differ, the text says so.

| | identity-api | vendor-api |
|---|---|---|
| Module for `generate-key` | `python -m identity_api.cli generate-key` | `python -m vendor_api.cli generate-key` |
| Compose variable (local) | `IDENTITY_JWT_KEYS` | `VENDOR_JWT_KEYS` |
| Who verifies its tokens | other services, through the JWKS | vendor-api itself (in-process keys), and other services through the JWKS |
| Redis prefix of its refresh tokens | `identity:` | `vendor:` |

Other services verify tokens with the JWKS and cache it for **10 minutes** (`Cache-Control: max-age=600`); on an unknown `kid` they refetch at most once a minute.

**vendor-api checks its own tokens with the keys it loaded at startup, not with a cache.** With several instances, an instance that has not restarted yet does not know `NEW`, so it would reject tokens that an already-restarted instance signed. That is why step 2 (publish `NEW`, keep signing with `OLD`) must be complete on **every** instance before step 5 (sign with `NEW`); for vendor-api the roll in step 2 is the wait, and the 10-minute wait still covers any other service that reads its JWKS.

Two numbers drive every wait below:

- **Cache TTL:** 10 minutes. Until then a service may still hold the old key set.
- **Token lifetime:** `ACCESS_TOKEN_TTL_SECONDS`, 15 minutes by default (both services accept 1 to 3600 seconds). Check the value actually configured for the service you rotate; the waits below use it.

How keys are configured (see `services/identity-api/.env.example` and `services/vendor-api/.env.example`):

- `JWT_KEYS_DIR`: a directory of `<kid>.pem` files, or `JWT_KEYS`: a JSON object `{"<kid>": "<PEM>"}`. Both can be used; a `kid` may appear only once.
- `JWT_SIGNING_KID`: the key that signs. Every other key is **published only**. A published-only key can be configured as a **public** PEM, so a retired private key does not have to be kept.
- Keys are read at startup. A change takes effect when the service restarts. With several instances, restart them one at a time (rolling) and check `/.well-known/jwks.json` on each.

`kid` convention: `YYYY-MM-DD-<6 hex>`, which is what the service's `generate-key` command produces.

## Normal rotation (every 90 days)

Nobody is signed out. Allow about 25 minutes plus the token lifetime in total (40 minutes with the default 15-minute lifetime).

Let `OLD` be the current signing `kid` and `NEW` the new one.

1. **Generate the new key** where your secrets are managed (not on a laptop for production):
   ```sh
   python -m identity_api.cli generate-key --dir <secure dir>   # or: python -m vendor_api.cli ...
   ```
   It prints `NEW`. The private key is written with mode `0600`; never commit or paste it anywhere. The service refuses to load a private key file that other users can read (anything looser than `0600`, or `0640` for a file owned by root), so keep that mode when you mount it.
2. **Publish `NEW` without signing with it.** Add `NEW`'s private key to the secret store next to `OLD`, keep `JWT_SIGNING_KID=OLD`, and roll the service's instances.
3. **Check:** `curl -s $ISSUER/.well-known/jwks.json` lists both `OLD` and `NEW`, on every instance. New tokens still carry `kid` `OLD`.
4. **Wait at least 10 minutes** (one cache TTL), so every service has fetched a key set that contains `NEW`. Signing earlier would hand out tokens that a service with a cached key set cannot verify yet; it would then refetch (at most once a minute), but do not rely on that.
5. **Switch signing to `NEW`:** set `JWT_SIGNING_KID=NEW` and roll the instances. Check that a fresh login gives a token whose header has `kid` `NEW`, and that a service accepts it.
6. **Wait at least the token lifetime plus the cache TTL** (`ACCESS_TOKEN_TTL_SECONDS` + 10 minutes; 25 minutes with the default 900 seconds) after the *last* instance started signing with `NEW`, so every token signed by `OLD` has expired. If `ACCESS_TOKEN_TTL_SECONDS` was lowered recently, use the value that was in force when the last `OLD` token was issued.
7. **Retire `OLD`:** delete `OLD` from the secret store (or from `JWT_KEYS_DIR`/`JWT_KEYS`) and roll the instances. Check that the JWKS lists only `NEW`.
8. **Destroy `OLD`'s private key** everywhere it was stored, and note the rotation date. Schedule the next one in 90 days.

If something looks wrong between steps 2 and 5, undo the last change: no token has been invalidated yet.

## Emergency rotation (suspected key leak)

Do this at once; it ends every session of the service whose key leaked (admins for identity-api, vendors for vendor-api). They sign in again afterwards.

1. **Generate a new key** (step 1 above) and note `NEW`.
2. **Replace the keys:** configure `NEW` as the only key, with `JWT_SIGNING_KID=NEW`. Do **not** keep `OLD`, not even as a public key. Roll all instances of the service together, or restart them at once rather than one by one.
3. **Check** that the JWKS lists only `NEW` and that a fresh login works.
4. **Know the gap.** Whoever holds `OLD` can sign tokens with any `exp`, any `sub` and any `roles`, so the token lifetime does **not** limit the exposure. A forged token verifies on every service that still has `OLD` in its cached key set: up to 10 minutes (the cache TTL) after step 2, and longer on a service that fails to refetch. Close the gap right after step 2 by restarting every service that verifies this service's tokens (or clearing its JWKS cache), then check that a token signed with `OLD` is rejected.
5. **Revoke refresh tokens.** Refresh tokens are not signed, but they were issued under the leaked key's regime and an attacker may have obtained one with a forged session. They live in the service's Redis, under its prefix (`identity:` or `vendor:`); delete every refresh-token key so nobody can refresh without signing in again:
   ```sh
   PREFIX=identity:   # or vendor: for vendor-api (its refresh tokens exist once vendor login does)
   for pattern in "${PREFIX}rf:*" "${PREFIX}rt:*" "${PREFIX}rtu:*" "${PREFIX}ra:*" "${PREFIX}rg:*"; do
     redis-cli -u "$REDIS_URL" --scan --pattern "$pattern" | xargs -r -n 500 redis-cli -u "$REDIS_URL" del
   done
   ```
   (`rf:` refresh-token families, `rt:` tokens, `rtu:` used-token markers, `ra:` each subject's families, `rg:` each subject's session generation; all start with the service's prefix, see `packages/py-security/README.md`. Delete only the leaked service's prefix: the other service's sessions are not affected.) Use `--scan`, never `KEYS`, on a live server. Deleting `rg:` is safe: a missing generation counts as 0, and every family it guarded is gone.
6. **Audit changes made during the leak window.** A forged token can carry a real user's `sub`, so audit entries may name a legitimate account. For identity-api, review every admin account created, re-activated or edited, every role granted or removed, and every password reset. For vendor-api, a forged token can also carry any `vendor_id`: review every vendor's profile, product and user changes and every status change in the audit trail. Cover the whole period between the earliest possible leak and the end of step 4. Revert anything nobody can account for, and disable or reset the accounts involved.
7. **Find out how the key leaked** and fix that first. Review the logs for tokens with unexpected `sub`/`roles` or an `exp` further away than `ACCESS_TOKEN_TTL_SECONDS` between the leak and the rotation, using `jti` to trace them.
8. **Destroy `OLD`** everywhere and record the incident and the rotation time.

## Quick reference

Both services follow this table, each for its own key.

| Situation | `JWT_SIGNING_KID` | JWKS contains |
|---|---|---|
| Steady state | `K1` | `K1` |
| Step 2 to 4: new key announced | `K1` | `K1`, `K2` |
| Step 5 to 6: new key signs | `K2` | `K1`, `K2` |
| After step 7 | `K2` | `K2` |
| Emergency | `K2` | `K2` |
