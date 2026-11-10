# central-stub

A stand-in for the central app's ingest API ([ADR 0003](../../docs/adr/0003-central-app-publishing-contract.md)), for local development, vendor-api's end-to-end test, and the central-app team to compare against. It implements `POST /internal/v1/events` and `GET /internal/v1/versions` from [`docs/adr/0003-contract/openapi.yaml`](../../docs/adr/0003-contract/openapi.yaml), in memory. **It is not deployed**, and its `/_stub/*` endpoints have no authentication: it listens on localhost only.

## Run it

```
docker compose --profile central up -d --build central-stub     # http://localhost:8003
```

or without Docker, from this directory: `pip install -r requirements-shared.txt && pip install -e '.[dev]' && uvicorn central_stub.main:app --port 8003`.

Open <http://localhost:8003> to see what it holds (brand pages, products, vendors, with the version and the latest payload of each): approve something and watch it arrive.

## The receiver's rules

In this order, all from the ADR:

1. (a misbehaviour switch, below)
2. a body over **256 KB** is `413 payload_too_large`;
3. the **HMAC signature** is verified over the raw bytes, in constant time, **before** the body is parsed (`401` with `unknown_key`, `stale_timestamp` (more than 60 s off), `malformed_signature` or `bad_signature`);
4. the body must be JSON that validates against the event's schema in `docs/adr/0003-contract/schemas/` (unknown fields, such as stock or contact data, are refused): `422 schema_invalid`, with the failing fields;
5. `Idempotency-Key` must equal `event_id` (`422 idempotency_key_mismatch`);
6. the same `event_id` with a different body is `409 event_id_conflict`; with the same body it is `200 duplicate`;
7. an event whose `version` is not higher than the one held for that aggregate is `200 stale` and changes nothing; otherwise `200 accepted`.

`GET /internal/v1/versions?aggregate_type=...&cursor=...&limit=...` returns what it holds, ordered by aggregate id (`state` is `published`, or `unpublished`; a vendor is `published` only while `approved`).

## Misbehaving on purpose

So the worker's retries and dead-lettering can be seen locally:

```
curl -X PUT localhost:8003/_stub/mode -H 'content-type: application/json' -d '{"mode": "error_500", "remaining": 3}'
```

`mode` is `ok`, `error_500`, `rate_limited` (`429`, `Retry-After: 30`), `unauthorized` (`401`) or `timeout` (waits `STUB_TIMEOUT_SECONDS`, default 120, then answers). `remaining` (optional) is how many answers are bad before it goes back to `ok`. A failed attempt stores nothing. Also: `GET /_stub/state` (JSON), `POST /_stub/reset` (forget everything).

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `STUB_SIGNING_KEYS` | `k1:central-stub-dev-secret-change-me-0123456789` | `key-id:secret` pairs, comma separated (two during a rotation); secrets are at least 32 characters. In compose: `CENTRAL_STUB_SIGNING_KEYS`. Point vendor-api's `CENTRAL_SIGNING_KEY_ID` and `CENTRAL_SIGNING_SECRET` at the same pair |
| `STUB_MODE` | `ok` | the starting mode |
| `STUB_TIMEOUT_SECONDS` | `120` | how long `timeout` waits |
| `STUB_RETRY_AFTER_SECONDS` | `30` | `Retry-After` of `rate_limited` |
| `CONTRACT_DIR` | `docs/adr/0003-contract` | where the schemas are read from (the image sets it) |

## Tests

`pip install -r requirements-shared.txt && pip install -e '.[dev]' && pytest`: every example of the contract is accepted, and each rule above has a test.
