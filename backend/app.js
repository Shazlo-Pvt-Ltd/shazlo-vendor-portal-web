import express from "express";
import cors from "cors";
import waitlistRoutes from "./routes/waitlist.js";
import brandRoutes from "./routes/brand.js";
import uploadRoutes from "./routes/upload.js";
import adminRoutes from "./routes/admin.js";

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

// Keep HTTP composition separate from database connection and process lifecycle.
// Tests use this same application with a disposable local MongoDB instance.
export function createApp({ env = process.env } = {}) {
  const app = express();
  const origins = corsOrigins(env);
  app.use(cors(origins ? { origin: origins } : undefined));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/waitlist", waitlistRoutes);
  app.use("/api", brandRoutes);
  if (legacyAdminEnabled(env)) {
    app.use("/api/upload", uploadRoutes);
    app.use("/api/admin", adminRoutes);
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

  return app;
}

export default createApp();
