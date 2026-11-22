// Load .env before app.js is evaluated: it builds the application when the module loads, reading
// TRUST_PROXY, LEGACY_ADMIN_ENABLED and CORS_ORIGIN.
import "dotenv/config";
import mongoose from "mongoose";
import app, { legacyAdminEnabled, corsOrigins } from "./app.js";

const PORT = process.env.PORT || 5000;

// Render sets RENDER on its services. Behind its proxy, an unset TRUST_PROXY would make every
// visitor share the proxy's address and so one rate-limit budget, which locks the whole site out
// of the waitlist after a few dozen sign-ups. Refuse to start instead (see README.md, "Rate
// limits"); set TRUST_PROXY=false to run without trusting any proxy on purpose.
if (process.env.RENDER && !process.env.TRUST_PROXY) {
  console.error(
    "TRUST_PROXY is not set: rate limits would treat every visitor behind Render's proxy as one. Set it (see backend/README.md, \"Rate limits\")."
  );
  process.exit(1);
}

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    if (legacyAdminEnabled()) console.warn("LEGACY_ADMIN_ENABLED is on: unauthenticated /api/admin and /api/upload are mounted.");
    if (!corsOrigins()) console.warn("CORS_ORIGIN is not set: every origin is allowed.");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await mongoose.connection.close();
  process.exit(0);
});

export default app;
