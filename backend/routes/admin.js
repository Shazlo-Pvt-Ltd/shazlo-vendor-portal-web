import express from "express";
import rateLimit from "express-rate-limit";
import Brand from "../models/Brand.js";
import Product from "../models/Product.js";
import { rateLimitOptions } from "../lib/rateLimits.js";
import { isObjectIdString } from "../lib/validation.js";

// These endpoints have no authentication (see README.md). Ids are checked before any query so
// that a malformed id answers 400 rather than a 500, and only strings ever reach Mongoose.
// Failures are logged here and answered without the error text, which can describe the database.

/** `rateLimits` overrides the budgets in lib/rateLimits.js (tests lower them). */
export function createAdminRouter({ rateLimits } = {}) {
  const router = express.Router();
  const adminLimiter = rateLimit(rateLimitOptions("admin", rateLimits));

  // Get all sellers
  router.get("/sellers", adminLimiter, async (req, res) => {
    try {
      const sellers = await Brand.find({});
      res.status(200).json({ sellers });
    } catch (error) {
      console.error("Fetch sellers error:", error);
      res.status(500).json({ message: "Failed to fetch sellers" });
    }
  });

  // Get all products with seller info
  router.get("/products", adminLimiter, async (req, res) => {
    try {
      const products = await Product.find({}).populate("sellerId", "name email");
      res.status(200).json({ products });
    } catch (error) {
      console.error("Fetch products error:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  // Get products by seller
  router.get("/products/:sellerId", adminLimiter, async (req, res) => {
    try {
      const { sellerId } = req.params;
      if (!isObjectIdString(sellerId)) {
        return res.status(400).json({ message: "Invalid seller id" });
      }
      const products = await Product.find({ sellerId }).populate(
        "sellerId",
        "name email"
      );
      res.status(200).json({ products });
    } catch (error) {
      console.error("Fetch seller products error:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  // Approve product
  router.put("/products/:productId/approve", adminLimiter, async (req, res) => {
    try {
      const { productId } = req.params;
      // Express 5 leaves req.body undefined when the request has no body.
      const { adminId } = req.body ?? {};
      if (!isObjectIdString(productId)) {
        return res.status(400).json({ message: "Invalid product id" });
      }
      // Optional, but when present it must be an id string: never an object that could carry
      // operators into the update.
      let approvedBy;
      if (adminId !== undefined) {
        if (typeof adminId !== "string" || !isObjectIdString(adminId)) {
          return res.status(400).json({ message: "Invalid admin id" });
        }
        approvedBy = adminId;
      }

      const product = await Product.findByIdAndUpdate(
        productId,
        {
          status: "approved",
          approvedAt: new Date(),
          approvedBy,
        },
        { returnDocument: "after" }
      ).populate("sellerId", "name email");

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.status(200).json({ message: "Product approved", product });
    } catch (error) {
      console.error("Approve product error:", error);
      res.status(500).json({ message: "Failed to approve product" });
    }
  });

  // Reject product
  router.put("/products/:productId/reject", adminLimiter, async (req, res) => {
    try {
      const { productId } = req.params;
      if (!isObjectIdString(productId)) {
        return res.status(400).json({ message: "Invalid product id" });
      }

      const product = await Product.findByIdAndUpdate(
        productId,
        { status: "rejected" },
        { returnDocument: "after" }
      ).populate("sellerId", "name email");

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.status(200).json({ message: "Product rejected", product });
    } catch (error) {
      console.error("Reject product error:", error);
      res.status(500).json({ message: "Failed to reject product" });
    }
  });

  return router;
}
