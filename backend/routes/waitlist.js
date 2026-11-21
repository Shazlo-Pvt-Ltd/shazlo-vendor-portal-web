import express from "express";
import rateLimit from "express-rate-limit";
import { addToWaitlist } from "../controllers/waitlist.js";
import { rateLimitOptions } from "../lib/rateLimits.js";

/** `rateLimits` overrides the budgets in lib/rateLimits.js (tests lower them). */
export function createWaitlistRouter({ rateLimits } = {}) {
  const router = express.Router();
  const submitLimiter = rateLimit(rateLimitOptions("publicSubmit", rateLimits));

  router.post("/add", submitLimiter, addToWaitlist);

  return router;
}
