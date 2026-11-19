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
// matched literally (and fails to cast) instead of acting as an operator. Supported since
// Mongoose 6; applies to every query in the process.
mongoose.set("sanitizeFilter", true);

/**
 * Builds the HTTP application. Keep HTTP composition separate from database connection and
 * process lifecycle: tests use this same application with a disposable local MongoDB instance.
 *
 * @param {object} [options]
 * @param {object} [options.rateLimits] per-class `{ windowMs, limit }` overrides (lib/rateLimits.js)
 * @param {boolean|number|string[]} [options.trustProxy] Express `trust proxy`; defaults to TRUST_PROXY
 */
export function createApp({
  rateLimits,
  trustProxy = parseTrustProxy(process.env.TRUST_PROXY),
} = {}) {
  const app = express();
  // req.ip, which every rate limiter keys on, depends on this (see lib/trustProxy.js).
  app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/waitlist", createWaitlistRouter({ rateLimits }));
  app.use("/api", createBrandRouter({ rateLimits }));
  app.use("/api/upload", createUploadRouter({ rateLimits }));
  app.use("/api/admin", createAdminRouter({ rateLimits }));

  // Not rate-limited: it touches no database and the host polls it.
  app.get("/api/health", (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.use("*", (req, res) => {
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

export default createApp();
