import express from "express";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import PreRegister from "../models/PreRegister.js";
import { rateLimitOptions } from "../lib/rateLimits.js";

// Not mounted in app.js (see README.md); kept rate-limited and injection-safe so that mounting
// it later does not open a hole.

// Validation middleware
const validateRegistration = [
  body("email")
    // express-validator would apply isEmail to each element of an array; demand one string.
    .isString()
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),
  body("name")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters"),
  body("phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),
  body("interests")
    .optional()
    .isArray()
    .withMessage("Interests must be an array"),
  body("referralSource")
    .optional()
    .isIn([
      "social_media",
      "friend_referral",
      "search_engine",
      "advertisement",
      "blog",
      "other",
    ])
    .withMessage("Invalid referral source"),
];

/** `rateLimits` overrides the budgets in lib/rateLimits.js (tests lower them). */
export function createPreRegisterRouter({ rateLimits } = {}) {
  const router = express.Router();
  const registerLimiter = rateLimit(rateLimitOptions("publicSubmit", rateLimits));
  const lookupLimiter = rateLimit(rateLimitOptions("lookup", rateLimits));

  // POST /api/preregister/register
  router.post(
    "/register",
    registerLimiter,
    validateRegistration,
    async (req, res) => {
      try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: errors.array(),
          });
        }

        const {
          email,
          name,
          phone,
          interests,
          referralSource,
          notificationPreferences,
        } = req.body;

        // Only a string may reach the query: an object such as {"$gt": ""} would match any record.
        if (typeof email !== "string") {
          return res.status(400).json({
            success: false,
            message: "Validation failed",
          });
        }

        // Check if user already exists
        const existingUser = await PreRegister.findOne({ email });
        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: "Email already registered for pre-registration",
          });
        }

        // Create new pre-registration
        const preRegister = new PreRegister({
          email,
          name,
          phone,
          interests: interests || [],
          referralSource: referralSource || "other",
          notificationPreferences: notificationPreferences || {
            email: true,
            sms: false,
          },
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get("User-Agent") || "Unknown",
        });

        await preRegister.save();

        res.status(201).json({
          success: true,
          message:
            "Pre-registration successful! We'll notify you when the app launches.",
          data: {
            id: preRegister._id,
            email: preRegister.email,
            name: preRegister.name,
            status: preRegister.status,
            confirmationToken: preRegister.confirmationToken,
          },
        });
      } catch (error) {
        console.error("Pre-registration error:", error);

        if (error.code === 11000) {
          return res.status(409).json({
            success: false,
            message: "Email already registered",
          });
        }

        res.status(500).json({
          success: false,
          message: "Internal server error. Please try again later.",
        });
      }
    }
  );

  // GET /api/preregister/confirm/:token
  router.get("/confirm/:token", lookupLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      const preRegister = await PreRegister.findOne({ confirmationToken: token });
      if (!preRegister) {
        return res.status(404).json({
          success: false,
          message: "Invalid confirmation token",
        });
      }

      await preRegister.confirm();

      res.json({
        success: true,
        message: "Email confirmed successfully!",
        data: {
          email: preRegister.email,
          name: preRegister.name,
          status: preRegister.status,
        },
      });
    } catch (error) {
      console.error("Confirmation error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });

  // GET /api/preregister/stats (admin endpoint)
  router.get("/stats", lookupLimiter, async (req, res) => {
    try {
      const stats = await PreRegister.getStats();

      res.json({
        success: true,
        data: stats[0] || { total: 0, breakdown: [] },
      });
    } catch (error) {
      console.error("Stats error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });

  // GET /api/preregister/check/:email
  router.get("/check/:email", lookupLimiter, async (req, res) => {
    try {
      const { email } = req.params;

      const preRegister = await PreRegister.findOne(
        { email },
        "email status createdAt"
      );

      if (!preRegister) {
        return res.json({
          success: true,
          registered: false,
        });
      }

      res.json({
        success: true,
        registered: true,
        data: {
          email: preRegister.email,
          status: preRegister.status,
          registeredAt: preRegister.createdAt,
        },
      });
    } catch (error) {
      console.error("Check registration error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });

  return router;
}

export default createPreRegisterRouter();
