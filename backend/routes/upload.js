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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_REQUEST = 20;
const MAX_PRODUCTS_PER_UPLOAD = 1000;
const CATALOG_BODY_LIMIT = "5mb";
// Text fields beside the images: the admin screen sends none, so a few small ones are plenty.
const MAX_TEXT_FIELDS = 10;
const MAX_TEXT_FIELD_BYTES = 100 * 1024;
// The type the browser declares, which a client can forge; Cloudinary's image upload still
// rejects anything that does not decode as an image. HEIC/HEIF is what iPhones take photos in.
// SVG is left out on purpose: it can carry script.
const ALLOWED_IMAGE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

class UnsupportedImageTypeError extends Error {}

// Chrome on Windows often has no type for an iPhone HEIC photo and sends it as
// application/octet-stream or with no type at all; the file name is all it has.
function isUnnamedHeic(file) {
  return ["", "application/octet-stream"].includes(file.mimetype) && /\.hei[cf]$/i.test(file.originalname);
}

const parseImageParts = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_IMAGES_PER_REQUEST,
    fields: MAX_TEXT_FIELDS,
    fieldSize: MAX_TEXT_FIELD_BYTES,
    parts: MAX_IMAGES_PER_REQUEST + MAX_TEXT_FIELDS,
  },
  fileFilter(req, file, accept) {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype) || isUnnamedHeic(file)) accept(null, true);
    else accept(new UnsupportedImageTypeError());
  },
}).array("images");

// Parses the images and answers upload limit violations with a 4xx in JSON instead of a 500.
function receiveImages(req, res, next) {
  parseImageParts(req, res, (error) => {
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
      if (["LIMIT_FIELD_COUNT", "LIMIT_FIELD_VALUE", "LIMIT_PART_COUNT"].includes(error.code)) {
        return res.status(413).json({ message: "Too many or too large text fields in the upload" });
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
  router.post("/images", uploadLimiter, receiveImages, async (req, res) => {
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

  // Upload products (placeholder, can be expanded). app.js leaves this route's JSON to the
  // parser here, which runs after the limiter and allows a larger body than the forms.
  router.post("/products", uploadLimiter, express.json({ limit: CATALOG_BODY_LIMIT }), async (req, res) => {
    try {
      // Express 5 leaves req.body undefined when the request has no body.
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
