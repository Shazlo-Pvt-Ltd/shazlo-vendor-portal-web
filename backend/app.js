import express from "express";
import cors from "cors";
import waitlistRoutes from "./routes/waitlist.js";
import brandRoutes from "./routes/brand.js";
import uploadRoutes from "./routes/upload.js";
import adminRoutes from "./routes/admin.js";

// Keep HTTP composition separate from database connection and process lifecycle.
// Tests use this same application with a disposable local MongoDB instance.
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/waitlist", waitlistRoutes);
app.use("/api", brandRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);

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

export default app;
