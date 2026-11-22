import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { createWaitlistRouter } from "./routes/waitlist.js";
import { createBrandRouter } from "./routes/brand.js";
import { createUploadRouter } from "./routes/upload.js";
import { createAdminRouter } from "./routes/admin.js";
import { parseTrustProxy } from "./lib/trustProxy.js";

// Defence in depth behind the string checks in each handler: Mongoose wraps any query filter
// value that is an object with a "$" key in $eq, so a stray {"$gt": ""} from a request body is
// matched literally (and fails to cast) instead of acting as an operator. Applies to every query
// in the process.
mongoose.set("sanitizeFilter", true);

const BODY_LIMIT = "100kb";
// The catalog upload parses its own, larger body after its rate limiter (routes/upload.js), so
// a client over its budget cannot make the server read 5 MB first. Matched the way Express
// routes: any case, with or without a trailing slash.
const CATALOG_PATH = /^\/api\/upload\/products\/?$/i;

// The admin and catalog-upload routes have no authentication, so they are mounted
// only when LEGACY_ADMIN_ENABLED=true (local development). Leave it unset on deployed services.
export function legacyAdminEnabled(env = process.env) {
  return String(env.LEGACY_ADMIN_ENABLED ?? "").trim().toLowerCase() === "true";
}

// CORS_ORIGIN is a comma-separated list of allowed origins. Unset (undefined) keeps every origin
// allowed. Not null: CodeQL treats a null origin as permissive, even behind the check below.
export function corsOrigins(env = process.env) {
  const origins = String(env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return origins.length ? origins : undefined;
}

/**
 * Builds the HTTP application. Keep HTTP composition separate from database connection and
 * process lifecycle: tests use this same application with a disposable local MongoDB instance.
 *
 * @param {object} [options]
 * @param {object} [options.env] where TRUST_PROXY, LEGACY_ADMIN_ENABLED and CORS_ORIGIN are read; defaults to process.env
 * @param {object} [options.rateLimits] per-class `{ windowMs, limit }` overrides (lib/rateLimits.js)
 * @param {boolean|number|string[]} [options.trustProxy] Express `trust proxy`; defaults to env.TRUST_PROXY
 */
export function createApp({
  env = process.env,
  rateLimits,
  trustProxy = parseTrustProxy(env.TRUST_PROXY),
} = {}) {
  const app = express();
  // req.ip, which every rate limiter keys on, depends on this (see lib/trustProxy.js).
  app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");
  const origins = corsOrigins(env);
  app.use(cors(origins ? { origin: origins } : undefined));
  // Small bodies everywhere (forms and admin actions), except the catalog upload.
  const formJson = express.json({ limit: BODY_LIMIT });
  app.use((req, res, next) => (CATALOG_PATH.test(req.path) ? next() : formJson(req, res, next)));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use("/api/waitlist", createWaitlistRouter({ rateLimits }));
  app.use("/api", createBrandRouter({ rateLimits }));
  if (legacyAdminEnabled(env)) {
    app.use("/api/upload", createUploadRouter({ rateLimits }));
    app.use("/api/admin", createAdminRouter({ rateLimits }));
  }

  app.get("/api/health", (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Express 5 rejects a bare "*" path; a handler with no path runs for every request that reaches it.
  app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
  });

  // Last: answer errors in JSON and never with a stack trace. Express's own handler prints the
  // stack unless NODE_ENV is "production". Client errors (malformed or oversized bodies) keep
  // their status; anything else is logged and answered with a generic 500.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status ?? error.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({ message: error.expose ? error.message : "Bad request" });
    }
    console.error("Unhandled error:", error);
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}

// server.js runs this one; tests build their own with createApp.
export default createApp();
