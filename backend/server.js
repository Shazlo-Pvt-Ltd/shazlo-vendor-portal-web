// Load .env before app.js is evaluated: it reads TRUST_PROXY when the module loads.
import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

// Render sets RENDER on its services. Behind its proxy, an unset TRUST_PROXY makes every client
// share the proxy's address and so one rate-limit budget (see README.md, "Rate limits").
if (process.env.RENDER && !process.env.TRUST_PROXY) {
  console.warn(
    "TRUST_PROXY is not set: rate limits will treat every client behind the proxy as one. See backend/README.md."
  );
}

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
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
