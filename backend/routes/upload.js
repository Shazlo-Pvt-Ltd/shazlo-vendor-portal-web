import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import Product from "../models/Product.js";
import { rateLimitOptions } from "../lib/rateLimits.js";
import { isObjectIdString, isPlainObject } from "../lib/validation.js";

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Files are buffered in memory before they go to Cloudinary, so one request may hold at most
// MAX_IMAGES_PER_REQUEST * MAX_IMAGE_BYTES (100 MB) of image data.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_REQUEST = 20;
export const MAX_PRODUCTS_PER_UPLOAD = 1000;
// The type the browser declares, which a client can forge; Cloudinary's image upload still
// rejects anything that does not decode as an image.
export const ALLOWED_IMAGE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

class UnsupportedImageTypeError extends Error {}

const receiveImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_REQUEST },
  fileFilter(req, file, accept) {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) accept(null, true);
    else accept(new UnsupportedImageTypeError());
  },
}).array("images");

// Answer upload limit violations with a 4xx in JSON instead of the default error page.
function images(req, res, next) {
  receiveImages(req, res, (error) => {
    if (!error) return next();
    if (error instanceof UnsupportedImageTypeError) {
      return res.status(415).json({
        message: `Only these image types are accepted: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
      });
    }
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: `Each image must be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` });
      }
      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(413).json({ message: `At most ${MAX_IMAGES_PER_REQUEST} images per request` });
      }
      return res.status(400).json({ message: "Invalid upload: send images in the multipart field \"images\"" });
    }
    // Anything else comes from the multipart parser (a truncated body, a missing boundary or a
    // malformed part header): the client's fault, and memory storage itself cannot fail.
    console.error("Malformed multipart upload:", error.message);
    res.status(400).json({ message: "Malformed multipart body" });
  });
}

/** `rateLimits` overrides the budgets in lib/rateLimits.js (tests lower them). */
export function createUploadRouter({ rateLimits } = {}) {
  const router = express.Router();
  const uploadLimiter = rateLimit(rateLimitOptions("upload", rateLimits));

  // Upload images to Cloudinary
  router.post("/images", uploadLimiter, images, async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No images provided" });
      }

      const uploadPromises = req.files.map((file) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "shazlo_catalog" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result.secure_url);
            }
          );
          stream.end(file.buffer);
        });
      });

      const urls = await Promise.all(uploadPromises);

      res.status(200).json({ urls });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  // Upload products (placeholder, can be expanded)
  router.post("/products", uploadLimiter, async (req, res) => {
    try {
      const { products, sellerId } = req.body ?? {};
      if (!products || !sellerId) {
        return res
          .status(400)
          .json({ message: "Products and sellerId required" });
      }
      if (!isObjectIdString(sellerId)) {
        return res.status(400).json({ message: "Invalid sellerId" });
      }
      if (
        !Array.isArray(products) ||
        products.length === 0 ||
        products.length > MAX_PRODUCTS_PER_UPLOAD ||
        !products.every(isPlainObject)
      ) {
        return res.status(400).json({
          message: `Products must be a list of 1 to ${MAX_PRODUCTS_PER_UPLOAD} objects`,
        });
      }

      const savedProducts = await Product.insertMany(
        // Review fields belong to the moderation endpoint, never the uploader.
        products.map((p) => ({
          ...p,
          sellerId,
          status: "pending",
          approvedAt: undefined,
          approvedBy: undefined,
        }))
      );
      res
        .status(200)
        .json({
          message: "Products uploaded successfully",
          products: savedProducts,
        });
    } catch (error) {
      console.error("Save products error:", error);
      res.status(500).json({ message: "Failed to save products" });
    }
  });

  return router;
}

export default createUploadRouter();
