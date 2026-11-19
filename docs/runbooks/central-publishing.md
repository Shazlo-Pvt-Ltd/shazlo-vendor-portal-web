# Publishing to the central app: running and repairing it

How `vendor-api` gets approved brand pages and products to the central app, and what to do when it
does not. The design is [ADR 0003](../adr/0003-central-app-publishing-contract.md); the wire format
is in [the contract](../adr/0003-contract/README.md). The code is `services/vendor-api` (the outbox,
`services/publisher.py`, `services/reconciliation.py`).

In one paragraph: an approval (or a suspension, a reinstatement, an archive) writes an event to the
`outbox_events` table **in the same transaction**. A separate process, the worker, sends the events
to `CENTRAL_API_URL`, signed, retrying on failure. Nothing the worker does can undo an approval, and
nothing the central app does can block one.

## Watching it work on your machine

```sh
cp .env.example .env     # set POSTGRES_PASSWORD, VENDOR_JWT_KEYS (see the README, "vendor-api") and
                         # uncomment CENTRAL_PUBLISHING_ENABLED=true
docker compose --profile vendor --profile central build
docker compose --profile vendor run --rm vendor-api alembic upgrade head
docker compose --profile vendor run --rm vendor-api python -m vendor_api.cli seed-dev
docker compose --profile vendor --profile central up -d
```

Open <http://localhost:8003>: the stub lists what it holds. The seed's approved vendor, brand page
and products arrive within a few seconds of the worker starting (the seed queued their events; the
`vendor-worker` service sends them). Approving something through `/v1/admin/reviews` (with an admin
token from identity-api) sends it too. The stub's `PUT /_stub/mode` makes it fail on purpose
(`{"mode": "error_500", "remaining": 3}`).

The worker is idle, and says so in its log, while `CENTRAL_PUBLISHING_ENABLED` is off. Events are
still written and queue up, so turning it on later sends everything.

## Running and scaling the worker

- One process: `python -m vendor_api.worker` (compose: `vendor-worker`). It reads the API's settings
  (the same `Settings` class), so it needs `DATABASE_URL` and `REDIS_URL` and the `CENTRAL_*` settings, and
  nothing else in development. With `ENV=prod` it also needs what the API needs in prod (for example
  `RATE_LIMIT_HMAC_KEY`, `JWT_ISSUER` and the `IDENTITY_*` pair), because those checks run on every start.
- **Run more than one if you like.** They claim rows with `FOR UPDATE SKIP LOCKED` and never send
  one row twice at the same moment, and an aggregate's events go out one at a time, in version order.
  One worker handles a few hundred events a minute; the limit that matters is the central app's.
- Stop it with `SIGTERM`: the request in flight finishes (a request is cut off after 30 seconds),
  claims not yet started are given back. Give it 45 seconds (compose sets `stop_grace_period: 45s`).
- A worker that dies mid-send leaves rows in `sending`. The sweeper (every minute, in every worker)
  puts them back after 2 minutes. The central app answers `duplicate` if the event had arrived. A worker
  that was only slow cannot overwrite what the next worker records: a result counts only from the
  worker that still holds the row's claim token.
- The same process runs the nightly reconciliation at `RECONCILE_AT` (UTC, default `03:00`), under an
  advisory lock, so several workers do not repeat it.

## Is it healthy?

`GET /ready` has an `outbox` object, and `GET /v1/admin/outbox/stats` (an admin token) has the same:

| Field | Alert when |
| --- | --- |
| `dead` | greater than 0: an event needs a person |
| `oldest_due_age_seconds` | growing past a few minutes: the worker is down, paused or the central app is failing |
| `pending` | large and growing, with the age above: delivery is not keeping up |

The worker logs (JSON) carry `event_id`, `event_type`, `version` and `attempt`, never a body or a
secret. `"alert": true` marks the two lines to page on: **an event is dead** and **publishing
paused**.

## A dead event: read it, retry it

An event is `dead` after a permanent answer (`400`, `409`, `413`, `422`) or its 8th failed attempt
(about two days of retries).

1. Find it: `GET /v1/admin/outbox?status=dead` (add `vendor_id` or `aggregate_type` to narrow it).
2. Read why: `GET /v1/admin/outbox/{id}`. `last_error` is `HTTP <status>` and the central app's error
   code (`schema_invalid`, `event_id_conflict`...), and `history` lists every attempt in order.
3. Fix the cause, if it is yours or theirs:
   - `422 schema_invalid`: the event does not match the contract. Tell the vendor-api developers; a
     retry will fail the same way. The next approval of that page or product sends the full state
     again and supersedes it, so a dead event is not a lost vendor.
   - `5xx` for a long time: the central app was down. Retry once it is back.
   - `409 event_id_conflict`: the central app saw this id with other content. Do not retry; ask them.
4. Retry: `POST /v1/admin/outbox/{id}/retry`. Only a `dead` event can be retried (`409` otherwise),
   its attempts start again, and the log records your admin id. It is sent in its turn and never
   before an earlier version of the same aggregate that is still waiting.

A dead event does not block newer versions of the same aggregate: they carry the full state.

## The signing key: paused publishing, rotating it

Five `401` answers in a row mean the central app does not accept our signature. The worker **pauses**,
logs `publishing paused` with `"alert": true`, and tries one event every 5 minutes. No event is
killed and none uses up an attempt. Check `CENTRAL_SIGNING_KEY_ID` and `CENTRAL_SIGNING_SECRET`
against what the central app holds, fix them, restart the worker; the next probe succeeds and
everything waiting goes out.

Rotating the secret without a pause: [central-api-key-rotation.md](central-api-key-rotation.md).

## Resyncing a vendor (or everything)

When the central app lost data, or a catalog was published before the outbox existed, re-send the
**current state**:

```sh
python -m vendor_api.cli resync --vendor <slug-or-id>                  # its page, status and every product
python -m vendor_api.cli resync --vendor <slug> --product <sku>        # one product (a SKU is unique per vendor)
python -m vendor_api.cli resync --product <product-id>
python -m vendor_api.cli resync --all
```

It prints how many events it wrote and how many it left alone because one was already waiting. It
does not need the central app to be up, and it writes each event above every version vendor-api has
already written for that aggregate. Each run writes new events (it is a deliberate re-send).

It does not ask the central app what it holds, so it cannot help when the central app holds
something **newer** than vendor-api's own history (vendor-api's database was restored from a
backup): the central app answers `stale` and keeps what it has. The nightly reconciliation compares
versions with the central app and writes above them, so that is the repair for a restored database.
To run it sooner, set `RECONCILE_AT` to a few minutes ahead and restart the worker.

## The central app is down for a long time

- Nothing is lost. Approvals keep working and events queue in `outbox_events`; each retries on the
  backoff (30 s, 2 min, 10 min, 1 h, 6 h, 12 h, 24 h) and becomes `dead` after the 8th failed
  attempt, about two days in.
- **Before it comes back** there is nothing to do. Watch `oldest_due_age_seconds` and `dead`.
- **When it comes back**: the events still `pending` go out by themselves. For the ones that went
  `dead` during the outage, retry them (the list above), or simply run `resync --all`, which sends the
  current state of everything (cheaper than retrying a thousand events one by one, and it covers
  versions superseded in the meantime). The next nightly reconciliation catches whatever is left.
- If the outbox grows large, `RECONCILE_MAX_PENDING` stops the nightly job from adding to it.
- To stop sending on purpose (a planned freeze), set `CENTRAL_PUBLISHING_ENABLED=false` and restart
  the worker. Events keep queueing. Do not set `OUTBOX_EVENTS_ENABLED=false` in production: approvals
  would then write no event at all, and only a `resync` would repair that.

## Things that look wrong and are not

- `sent` events older than 30 days are removed, but the **latest event of every page, product and
  vendor stays**, however old: the writer reads it to know what the central app holds, and the
  reconciliation and `resync` read it too. Do not delete them by hand.
- An event `sent` with a version lower than the central app's: it was answered `stale`, which is a
  success. The central app keeps the newest version.
- Two events for one product a minute apart: a suspension and a reinstatement are two events, in order.
- `attempts` is 0 on an event that was refused with `401`: by design, see above.
