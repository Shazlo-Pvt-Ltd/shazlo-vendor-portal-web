// Load .env before app.js builds the application: it reads LEGACY_ADMIN_ENABLED and CORS_ORIGIN.
import "dotenv/config";
import mongoose from "mongoose";
import app, { legacyAdminEnabled, corsOrigins } from "./app.js";

const PORT = process.env.PORT || 5000;

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
