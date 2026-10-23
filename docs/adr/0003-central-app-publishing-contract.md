# 0003. Central-app publishing contract

- Status: proposed
- Date: 2026-10-23
- Issue: #32
- Related: [ROADMAP](../ROADMAP.md) Phase 4 (central-app publishing); [draft contract](0003-contract/README.md)

## Context

Vendors edit their brand page and products in `vendor-api`. Nothing is shown to shoppers until an admin approves it. **Only approved content is sent to the central app**, the consumer application that lives in a separate repository (`shazlo-server`) and has its own database and release cycle.

Two systems that change independently must stay consistent, even though:

- the network fails and either side restarts or deploys at any time;
- a message may be delivered twice, late or out of order;
- an approval must never be lost, and a withdrawn product must stop being shown quickly;
- the central app is the authority for what shoppers see and for **stock**, and vendors must not be able to change it behind its back.

The roadmap leaves the ingestion contract open ("endpoint, payload, auth") and says Phase 4 starts with a stub receiver. This ADR decides the contract so both sides can build against it.

## Decision

`vendor-api` **pushes** signed events to the central app. Events are written to a **transactional outbox** in the same database transaction as the approval, and a worker delivers them with retries. The full contract is in [`0003-contract/`](0003-contract/README.md); this section records the decisions.

### 1. Push through one ingest endpoint

The central app exposes `POST /internal/v1/events`. The body is one event in a common envelope (`event_id`, `type`, `version`, `occurred_at`, `producer`, `aggregate`, `payload`).

Five event types:

| Type | When |
| --- | --- |
| `brand_profile.published` | An admin approves a brand page version |
| `brand_profile.unpublished` | A brand page is withdrawn, or the vendor is suspended or rejected |
| `product.published` | An admin approves a product (or a pending revision of one) |
| `product.unpublished` | A product is withdrawn, archived, sent back to review, or the vendor is suspended |
| `vendor.status_changed` | A vendor is approved, rejected or suspended |

Events carry the **full state** of the aggregate, not a change. A missed or skipped event is repaired by the next one.

**What is deliberately left out:** stock (the central app owns it) and vendor contact details (phone, email, founder name). Payload schemas reject unknown fields, so neither can be added by accident.

### 2. HMAC signing and replay protection

Each request carries `X-Shazlo-Key-Id`, `X-Shazlo-Timestamp` (Unix seconds) and `X-Shazlo-Signature: v1=<hex>`, where the hex value is `HMAC_SHA256(secret, timestamp + "." + raw_body)`. The receiver:

- rejects a timestamp more than **60 seconds** away from its clock;
- verifies the signature over the raw bytes with a constant-time comparison **before** parsing the JSON;
- de-duplicates on `event_id`, which is stored for at least 30 days.

A replay inside the 60-second window is harmless because of the de-duplication. The key id allows two keys to be active during rotation. A test vector is in the contract so both sides can check their implementation.

### 3. Idempotency, ordering and versions

- **Idempotency:** `event_id` (also sent as `Idempotency-Key`). A repeat returns `200` with `duplicate`. The same id with a different body returns `409`.
- **Ordering:** no global order is promised. Each aggregate has a monotonic `version`. The receiver applies an event only if its version is higher than the version it holds, and otherwise answers `200` with `stale`.
- `vendor-api` sends events for **one aggregate one at a time in version order**, so a publish is never overtaken by its own withdrawal. Different aggregates are independent.

### 4. Retries, backoff and dead letter

| Result | Meaning | Action |
| --- | --- | --- |
| `200` | accepted, duplicate or stale | Mark `sent` |
| `400`, `401`, `409`, `413`, `422` | Permanent | Mark `dead` at once and alert. Five consecutive `401` responses pause publishing |
| `408`, `429`, `5xx`, timeout, network error | Temporary | Retry |

Backoff after each failure: 30 s, 2 min, 10 min, 1 h, 6 h, 12 h, 24 h, each with plus or minus 20% jitter. After the 8th failed attempt (about two days) the event becomes `dead`: it is listed in the admin review screen with a **Retry** button (Phase 7). A dead event does not block newer versions of the same aggregate, because those carry the full state.

### 5. Transactional outbox

The outbox row is written in the **same transaction** as the approval, so an approval and its event are saved together or not at all. The event can never be lost between "committed" and "queued".

```sql
CREATE TABLE outbox_events (
  id               uuid PRIMARY KEY,                 -- this is the event_id
  aggregate_type   text        NOT NULL,             -- brand_profile | product | vendor
  aggregate_id     uuid        NOT NULL,
  event_type       text        NOT NULL,
  version          integer     NOT NULL,
  payload          jsonb       NOT NULL,             -- the full event body
  status           text        NOT NULL DEFAULT 'pending',  -- pending | sending | sent | dead
  attempts         integer     NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (aggregate_type, aggregate_id, version)
);
CREATE INDEX outbox_due ON outbox_events (next_attempt_at) WHERE status = 'pending';
```

The publisher worker claims due rows with `FOR UPDATE SKIP LOCKED`, so several workers can run safely, and skips any aggregate that still has an earlier unsent version:

```sql
UPDATE outbox_events o
SET status = 'sending', locked_at = now(), attempts = attempts + 1
WHERE o.id IN (
  SELECT d.id
  FROM outbox_events d
  WHERE d.status = 'pending'
    AND d.next_attempt_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM outbox_events e
      WHERE e.aggregate_type = d.aggregate_type
        AND e.aggregate_id = d.aggregate_id
        AND e.version < d.version
        AND e.status IN ('pending', 'sending')
    )
  ORDER BY d.next_attempt_at
  LIMIT 20
  FOR UPDATE SKIP LOCKED
)
RETURNING o.*;
```

A row stuck in `sending` for more than 2 minutes (a crashed worker) is reset to `pending` by a sweeper. Rows with `status = 'sent'` are kept for 30 days for audit and then removed.

### 6. Reconciliation

The central app also exposes `GET /internal/v1/versions?aggregate_type=...`, which lists the aggregate ids it holds and their versions. Every night `vendor-api` compares that with what it has published and re-sends the current state of any aggregate where the central app is behind. An operator can run the same job on demand. This repairs anything that retries cannot, for example a restored database.

### 7. Contract versioning

The path carries the version (`/v1/`). Adding an optional payload field is not a breaking change, but the schemas reject unknown fields, so the new field is added to the schema and deployed to the receiver **before** the producer starts sending it. Removing or renaming a field, or changing its meaning, needs `/v2/`.

## Questions to confirm with the central-app team

The central app is the consumer backend (`shazlo-server`). Each question has a proposed answer so work can continue.

| # | Question | Proposed answer |
| --- | --- | --- |
| 1 | Who owns stock for published products? | The central app. The publish payload carries no stock. Vendors set stock through a separate command to the central app, defined in its own contract |
| 2 | Money units and currency | Integer paise, INR only |
| 3 | Category and fabric values | Free text from `vendor-api` for now. The central app maps them to its own category list and reports unknown values back so the list can be agreed (open item below) |
| 4 | Images | HTTPS Cloudinary URLs. The central app stores the URLs and may copy them to its own storage later |
| 5 | What does `unpublished` do? | Hide from shoppers but keep history. Never delete. Re-publishing a later version shows it again |
| 6 | How are keys exchanged and rotated? | A random 32-byte secret per environment, shared through a secret manager (not chat or git). Two keys active during rotation |
| 7 | Is there a sandbox? | Yes: the stub receiver in Phase 4 for local development, and a staging central app for end-to-end tests |
| 8 | Latency and error expectations | The receiver answers within 10 seconds. Brand and product changes should be visible within about a minute of approval |
| 9 | Rate limits | Allow bursts of 50 events per second per key. Larger bulk imports are paced by the worker |
| 10 | Is vendor contact data needed centrally? | No. Contact details are not published. If the central app later needs them (for orders) they travel through a separate order contract |
| 11 | Legacy `discount` and `weight` | Confirm whether `discount` is a percent or an amount, and the unit of `weight`, before the data migration in Phase 8 |
| 12 | Maximum event size | 256 KB. Larger bodies get `413` |

## Consequences

**Easier**
- An approval is never lost: it is committed with its event, and delivery is retried for about two days.
- Retries, duplicates and out-of-order delivery are safe by design (idempotency, versions, full-state events).
- Both sides can build and test independently using the schemas, the examples and the stub receiver.
- The central app stays the authority for stock and for what is shown.

**Harder**
- Delivery is **eventually consistent**: a change shows up within seconds to minutes, not instantly.
- Two more moving parts to operate: the publisher worker and the nightly reconciliation job.
- Both sides must keep the schemas in step; contract tests in each repo are required.
- A shared secret must be managed and rotated on both sides.

**Follow-ups**
- Phase 4: implement the outbox, the worker, the dead-letter screen, and the stub receiver from the OpenAPI file.
- Add contract tests in `vendor-api` (examples validate against the schemas) and in the central app (it accepts every example).
- Agree the stock command contract between the central app and `vendor-api` separately.

## Alternatives considered

| Option | Why not |
| --- | --- |
| The central app **pulls** by polling `vendor-api` | Delays visibility, adds load, and needs a cursor and change tracking; a push with an outbox is simpler to reason about |
| A message broker (Kafka, RabbitMQ, a cloud queue) | Another system to run and secure for a handful of events a day. The outbox plus HTTP gives the same guarantees today and can move to a broker later without changing the event format |
| Call the central app inside the approval request (no outbox) | If the central app is down, approvals fail or, worse, succeed without being sent. A dual write has no safe failure mode |
| Change data capture from the database | Couples the central app to `vendor-api`'s table layout, and exposes internal columns and contact data |
| Send deltas instead of full state | A single missed event corrupts the receiver. Full state makes skipping and re-sending safe |
| Publish stock with the product | Two systems would write one number. The central app already owns stock and reserves it at checkout |

## Open items

- Confirm the answers in the table above with the central-app owners, then change the status to accepted.
- Final category and fabric lists, and how unknown values are reported.
- Where the shared secrets live in each environment.
