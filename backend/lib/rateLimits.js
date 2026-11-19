// Per-IP request budgets for each class of route. Every router builds its own limiter with
// express-rate-limit's in-memory store, so the counts belong to one process: running more than
// one instance multiplies them and would need a shared store (for example Redis).
//
// The client IP comes from req.ip, which depends on the `trust proxy` setting in app.js
// (TRUST_PROXY): if it is wrong behind a proxy, every client shares the proxy's budget.

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const DEFAULT_RATE_LIMITS = Object.freeze({
  // Unauthenticated writes: waitlist, brand registration, pre-registration.
  publicSubmit: Object.freeze({ windowMs: FIFTEEN_MINUTES, limit: 20 }),
  // Unauthenticated reads by token or address (pre-registration confirm and check).
  lookup: Object.freeze({ windowMs: FIFTEEN_MINUTES, limit: 60 }),
  // Image upload to Cloudinary and catalog import.
  upload: Object.freeze({ windowMs: FIFTEEN_MINUTES, limit: 30 }),
  // Seller and product moderation screens, which reload their lists after every action.
  admin: Object.freeze({ windowMs: FIFTEEN_MINUTES, limit: 300 }),
});

/**
 * Options for express-rate-limit for one route class. `overrides` maps a class name to
 * `{ windowMs, limit }`; createApp passes it through so tests can lower or raise a budget.
 */
export function rateLimitOptions(kind, overrides = {}) {
  const defaults = DEFAULT_RATE_LIMITS[kind];
  if (!defaults) throw new Error(`Unknown rate limit class: ${kind}`);
  const { windowMs = defaults.windowMs, limit = defaults.limit } = overrides[kind] ?? {};
  return {
    windowMs,
    limit,
    // RateLimit and RateLimit-Policy headers (IETF draft 8) tell clients when to retry.
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
  };
}
