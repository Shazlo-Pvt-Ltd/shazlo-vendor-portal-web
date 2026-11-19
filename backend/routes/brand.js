import express from "express";
import rateLimit from "express-rate-limit";
import { registerBrand } from "../controllers/brand.js";
import { rateLimitOptions } from "../lib/rateLimits.js";

/** `rateLimits` overrides the budgets in lib/rateLimits.js (tests lower them). */
export function createBrandRouter({ rateLimits } = {}) {
  const router = express.Router();
  const submitLimiter = rateLimit(rateLimitOptions("publicSubmit", rateLimits));

  router.post("/register-brand", submitLimiter, registerBrand);

  return router;
}

export default createBrandRouter();
