# Central-app publishing contract (draft v0.1)

Companion to [ADR 0003](../0003-central-app-publishing-contract.md). This is what `vendor-api` (the **producer**) sends and what the central app (the **receiver**, `shazlo-server`) must implement.

Machine-readable parts: [`openapi.yaml`](openapi.yaml), [`schemas/`](schemas), [`examples/`](examples).

## 1. Scope

Only **approved** content leaves `vendor-api`. Four kinds of fact are published:

| Event type | Aggregate | Meaning |
| --- | --- | --- |
| `brand_profile.published` | `brand_profile` | The approved brand page (a new approved version replaces the previous one) |
| `brand_profile.unpublished` | `brand_profile` | The brand page must no longer be shown |
| `product.published` | `product` | The approved product (a new approved version replaces the previous one) |
| `product.unpublished` | `product` | The product must no longer be shown (withdraw) |
| `vendor.status_changed` | `vendor` | The vendor was approved, rejected or suspended. A suspension hides all of the vendor's products |

Every event carries the **full current state** of its aggregate, not a delta. That is what makes retries, duplicates and skipped events safe.

**Not in this contract**

- **Stock counts.** The central app owns stock. How a vendor sets stock is a separate contract (a command to the central app) and is out of scope here.
- **Contact details** (phone, email, founder name). They are never published.
- Orders and payments.

## 2. Transport and signing

`POST {CENTRAL_API_URL}/internal/v1/events` with `Content-Type: application/json`. The body is one event (section 3).

### Headers

| Header | Value |
| --- | --- |
| `X-Shazlo-Key-Id` | Which shared secret signed the request (for example `k1`). Supports rotation |
| `X-Shazlo-Timestamp` | Unix time in seconds when the request was signed |
| `X-Shazlo-Signature` | `v1=` followed by the lowercase hex of `HMAC_SHA256(secret, timestamp + "." + raw_body)` |
| `Idempotency-Key` | The `event_id` from the body |

### Signing (producer)

1. Serialise the event to JSON **once**. These exact bytes are both signed and sent.
2. `signing_string = timestamp + "." + body_bytes` (the timestamp as decimal digits, a single dot, then the body).
3. `signature = "v1=" + hex(HMAC_SHA256(secret_for_key_id, signing_string))`.

### Verification (receiver)

1. Look up the secret for `X-Shazlo-Key-Id`. Unknown key: `401`.
2. Reject if `abs(now - timestamp)` is more than **60 seconds** (`401`, `stale_timestamp`).
3. Recompute the signature over the **raw bytes as received** (never over re-serialised JSON) and compare with a **constant-time** comparison. Mismatch: `401`, `bad_signature`.
4. Only then parse the JSON, validate it against the schema (`422` on failure), and apply the rules in section 5.

### Replay protection

A captured request is useless after about a minute (timestamp window). Inside that window a replay is harmless, because the receiver de-duplicates on `event_id` (section 5). The receiver keeps `event_id` values for at least **30 days**.

### Key rotation

Two keys may be active at once. The producer starts signing with the new `key_id`; the receiver accepts both until the old key is retired. Secrets are generated with at least 32 random bytes and are never committed.

### Worked example (test vector)

Use this to test an implementation. The secret is a test value only.

```
secret:         shazlo-contract-test-secret-not-for-production
key id:         k1
timestamp:      1792750800
body (371 bytes, exactly):
{"event_id":"d2c8a7b1-3e5f-4092-8b4c-6f9e1d8b2c35","type":"brand_profile.unpublished","version":4,"occurred_at":"2026-10-24T08:00:00Z","producer":"vendor-api","aggregate":{"type":"brand_profile","id":"3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10"},"payload":{"vendor_id":"3f0c8a52-6b0e-4a8b-9c1d-2a7d5e9b1c10","reason":"vendor_suspended","unpublished_at":"2026-10-24T08:00:00Z"}}

signing string: "1792750800." + body
signature:      v1=634f5e1066ac490d1e347ddf886c874a5083ec5f01b38c706c069e3056470785
```

The request:

```
POST /internal/v1/events HTTP/1.1
Content-Type: application/json
X-Shazlo-Key-Id: k1
X-Shazlo-Timestamp: 1792750800
X-Shazlo-Signature: v1=634f5e1066ac490d1e347ddf886c874a5083ec5f01b38c706c069e3056470785
Idempotency-Key: d2c8a7b1-3e5f-4092-8b4c-6f9e1d8b2c35
```

## 3. Envelope

| Field | Type | Rule |
| --- | --- | --- |
| `event_id` | UUID | Unique per event |
| `type` | string | One of the five event types |
| `version` | integer, at least 1 | Monotonic per aggregate. Increases with every publish or unpublish of that aggregate |
| `occurred_at` | RFC 3339 time | When the decision happened |
| `producer` | `"vendor-api"` | Constant |
| `aggregate` | `{ type, id }` | `type` is `brand_profile`, `product` or `vendor`; `id` is a UUID |
| `payload` | object | Depends on `type` (section 4) |

Schema: [`schemas/envelope.schema.json`](schemas/envelope.schema.json).

## 4. Event payloads

Money is always an **integer number of paise** (1 INR = 100 paise). Times are RFC 3339 in UTC. Image URLs are HTTPS (Cloudinary).

### `brand_profile.published`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `vendor_id` | UUID | yes | |
| `slug` | string | yes | Lowercase letters, digits and hyphens |
| `brand_name` | string | yes | |
| `tagline` | string | no | At most 160 characters |
| `about` | string | no | At most 4000 characters |
| `logo_url`, `banner_url`, `website_url` | HTTPS URL | no | |
| `instagram_handle` | string | no | Without `@` |
| `categories` | string[] | yes | At least one, unique |
| `price_range` | `{ min_paise, max_paise }` | yes | `max_paise` is at least `min_paise` |
| `published_at` | time | yes | |

### `brand_profile.unpublished`

`vendor_id`, `reason` (`withdrawn`, `vendor_suspended`, `rejected_after_publish`), `unpublished_at`.

### `product.published`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `product_id`, `vendor_id` | UUID | yes | |
| `sku` | string | yes | Unique per vendor |
| `title` | string | yes | |
| `description` | string | no | |
| `category` | string | yes | |
| `subcategory` | string | no | |
| `gender` | `women`, `men`, `unisex` | yes | |
| `fabric` | string | no | |
| `variants` | array | yes | At least one |
| `images` | array | yes | 1 to 10, ordered by `position` |
| `weight_grams` | integer | no | |
| `returnable` | boolean | yes | |
| `return_window_days` | integer 0 to 30 | when `returnable` is true | |
| `published_at` | time | yes | |

Each **variant**: `variant_id` (UUID), `sku`, `size` and `color` (optional), `price_paise` (at least 1), `mrp_paise` (at least `price_paise`). **No stock field.** Each **image**: `url`, `position` (from 1), optional `alt`.

### `product.unpublished`

`product_id`, `vendor_id`, `reason` (`withdrawn`, `archived`, `back_in_review`, `vendor_suspended`, `rejected_after_publish`), `unpublished_at`.

### `vendor.status_changed`

`vendor_id`, `status` (`approved`, `rejected`, `suspended`), optional `reason`, `changed_at`.

## 5. Delivery rules

### Idempotency
The receiver stores every `event_id` it has handled. A repeat returns `200` with `"status": "duplicate"` and changes nothing. The same `event_id` with a **different** body returns `409`.

### Ordering
There is **no global ordering**. Per aggregate, `version` increases. The receiver keeps the highest version it has applied for each aggregate and answers `200` with `"status": "stale"` (changing nothing) to an event whose version is not higher. Because events carry full state, skipping a missed event is safe.

The producer sends events of **one aggregate one at a time, in version order**. An event for another aggregate never waits for it.

### Responses

| Status | Meaning | Producer action |
| --- | --- | --- |
| `200` | `accepted`, `duplicate` or `stale` | Mark sent |
| `400`, `401`, `409`, `413`, `422` | Permanent problem | Mark `dead` immediately and alert. After 5 consecutive `401` responses the producer pauses publishing (probably a key problem) |
| `408`, `429`, `5xx`, network error or timeout | Temporary | Retry with backoff |

`429` honours `Retry-After`. The producer's request timeout is 10 seconds.

### Retries and the dead letter
Delays after a failed attempt: 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours, 12 hours, 24 hours, each with plus or minus 20% random jitter. After the 8th failed attempt (about two days) the event becomes `dead`: it stops retrying, raises an alert, and appears in the admin review screen with a **Retry** button. A dead event does not block later versions of the same aggregate, because those carry the full state.

### Reconciliation
Every night `vendor-api` calls `GET /internal/v1/versions?aggregate_type=...` (paged) and compares it with what it has published. For any aggregate where the receiver holds a lower version, or none, `vendor-api` re-sends the current state as a new event with a new `event_id`. An operator can trigger the same job at any time.

## 6. Field mapping from the legacy models

The legacy Express and MongoDB models are a reference only (nothing is reused).

| Legacy field | Contract field | Notes |
| --- | --- | --- |
| `Brand.brand_name` | `brand_name` | |
| `Brand.website_or_instagram` | `website_url` or `instagram_handle` | Split by content |
| `Brand.product_type` | `categories` | Becomes a list |
| `Brand.price_range.min/max` | `price_range.min_paise/max_paise` | Rupees times 100 |
| `Brand.founder_contact`, `phone`, `email` | *not published* | Contact details stay in `vendor-api` |
| `Brand.status` | publish and unpublish events | The lifecycle is carried by events |
| `Product.productId` | `sku` | |
| `Product.name` | `title` | |
| `Product.category`, `subcategory` | `category`, `subcategory` | |
| `Product.price` | `variants[].price_paise` | Rupees times 100 |
| `Product.discount` | derives `variants[].mrp_paise` | **Confirm** whether `discount` is a percent or an amount |
| `Product.stock` | *not published* | Central app owns stock |
| `Product.color`, `size` | `variants[].color`, `size` | One variant per size and colour |
| `Product.material` | `fabric` | |
| `Product.gender` | `gender` | Normalise to `women`, `men`, `unisex` |
| `Product.imageUrl1..3` | `images[]` with `position` 1 to 3 | |
| `Product.weight` | `weight_grams` | **Confirm** the legacy unit |
| `Product.returnable` (text) | `returnable` (boolean) | |
| `Product.sellerId` | `vendor_id` | |
| `Product.status` | publish and unpublish events | |

## 7. Questions for the central-app team

Proposed answers are in [ADR 0003](../0003-central-app-publishing-contract.md#questions-to-confirm-with-the-central-app-team). The central app must confirm each before this contract is marked accepted.

## 8. Files

| File | Purpose |
| --- | --- |
| [`openapi.yaml`](openapi.yaml) | The ingest and reconciliation endpoints, headers and responses |
| [`schemas/envelope.schema.json`](schemas/envelope.schema.json) | The envelope |
| `schemas/<event type>.schema.json` | One schema per event type |
| `examples/<event type>.json` | One valid example per event type. Every example validates against its schema |
