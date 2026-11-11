# Runbook: rotate the central-app signing key (vendor-api)

vendor-api signs every request it sends to the central app (`POST /internal/v1/events`, `GET /internal/v1/versions`) with a shared secret: `X-Shazlo-Signature: v1=HMAC_SHA256(secret, timestamp + "." + body)` ([ADR 0003](../adr/0003-central-app-publishing-contract.md), contract in [`docs/adr/0003-contract/`](../adr/0003-contract/README.md)). The signing code is `packages/py-security/shazlo_security/signing.py`.

The central app accepts **two keys at once**, each known by a key id (`X-Shazlo-Key-Id`), so a rotation never drops an event. vendor-api sends one key at a time.

| Setting (vendor-api) | Meaning |
|---|---|
| `CENTRAL_SIGNING_KEY_ID` | the id sent as `X-Shazlo-Key-Id` |
| `CENTRAL_SIGNING_SECRET` | the secret: at least 32 characters, random, never committed or logged |

Settings are read at startup; restart vendor-api (one instance at a time) after changing them.

## Where the secrets live

One secret (and key id) per environment, never shared across environments. The secrets themselves are never in the repository, an issue, a PR or chat.

| Environment | vendor-api reads it from | Central app / receiver holds it in | Notes |
|---|---|---|---|
| Local development | `services/vendor-api/.env` (git-ignored), or unset: publishing is off | the stub receiver's own environment (`CENTRAL_SIGNING_SECRET` or its documented test secret) | The contract's test secret (`shazlo-contract-test-secret-not-for-production`) is for tests only; never use it outside them |
| CI | generated per run inside the test, or the contract test vector | n/a | No real secret is stored as a CI secret |
| Staging | the platform's secret manager, injected as `CENTRAL_SIGNING_SECRET` | the central app's secret manager for staging | Its own secret, not production's |
| Production | the platform's secret manager, injected as `CENTRAL_SIGNING_SECRET` (`prod` also needs `CENTRAL_API_URL` over https) | the central app's secret manager for production | Exchanged secret-manager to secret-manager, or through a one-time-secret link; never by chat, email or git |

The hosting platform and its secret manager are not chosen yet (see the roadmap); when they are, name the actual product and path in this table.

## Normal rotation (every 90 days)

Call the current key `OLD` (id `k1`) and the new one `NEW` (id `k2`; use a new id every time).

1. **Generate** `NEW`: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Store it in the secret manager, not in the repository, a ticket or chat.
2. **Add `NEW` to the central app** so it accepts both `k1` and `k2`. Confirm it is live before going on.
3. **Switch vendor-api** to `CENTRAL_SIGNING_KEY_ID=k2` and the new secret, then roll the instances. Instances that have not restarted still sign with `k1`, which the central app still accepts.
4. **Check**: the outbox drains (no growth in `pending`, no `dead` events), and the central app logs no `unknown_key` or `bad_signature`.
5. **Retire `OLD`** from the central app only after every vendor-api instance runs `k2` and a full retry window has passed (the longest backoff in the outbox), so no queued retry is signed with `k1` and rejected.
6. Delete `OLD` from the secret manager.

## If a key leaks

1. Generate `NEW` and add it to the central app (step 1 and 2 above).
2. Switch vendor-api to `NEW` and roll immediately.
3. **Remove the leaked key from the central app right away**, without waiting for a retry window: events signed with it fail with `401 unknown_key`, are retried, and go out with `NEW` once their instance has restarted. Nothing is lost; the outbox keeps them.
4. Look in the central app's logs for requests signed with the leaked key id that vendor-api did not send. Each carries an `event_id`; compare it with the outbox.

The 60-second timestamp window only limits replays of a captured request; it is no defence against a leaked secret.

## What the errors mean

The central app answers `401` with one of these codes; none of them says whether the secret or the id was wrong more than it must:

| Code | Cause | Fix |
|---|---|---|
| `unknown_key` | the key id is not (or no longer) configured at the central app | add it, or point vendor-api at an id the central app knows |
| `bad_signature` | wrong secret, or the body changed after signing | check both sides hold the same secret; a proxy must not rewrite the body |
| `stale_timestamp` | clocks differ by more than 60 seconds | fix NTP on the host |
| `malformed_signature` | a header is missing or not in the `v1=<64 hex>` form | something stripped or rewrote the headers |
