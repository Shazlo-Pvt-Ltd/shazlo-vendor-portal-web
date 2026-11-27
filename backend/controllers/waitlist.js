import WaitlistUser from "../models/WaitlistUser.js";
import { isValidEmail } from "../lib/validation.js";

export const addToWaitlist = async (req, res) => {
  try {
    // Express 5 leaves req.body undefined when the request has no body.
    const { name, email, gender, city } = req.body ?? {};

    // Validate required fields
    if (!name || !email || !gender || !city) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Only strings may reach the query: an object such as {"$gt": ""} would match any record.
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof gender !== "string" ||
      typeof city !== "string"
    ) {
      return res.status(400).json({ error: "All fields must be text" });
    }

    // The schema lowercases and trims on save; look up the same normalized form.
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: "Please provide a valid email address" });
    }

    // Check duplicate email
    const existing = await WaitlistUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(200).json({
        message: "Email already added",
        alreadyAdded: true,
      });
    }

    // Create user
    await WaitlistUser.create({ name, email: normalizedEmail, gender, city });

    return res.status(201).json({
      message: "Successfully added to waitlist",
      alreadyAdded: false,
    });

  } catch (err) {
    console.error("Waitlist error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
