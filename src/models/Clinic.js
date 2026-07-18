const mongoose = require("mongoose");

const clinicSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    /** Lowercase trimmed name for case-insensitive login lookup. */
    nameKey: { type: String, required: true, unique: true, index: true },
    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    /** IANA timezone for consultation hours (Vercel runs in UTC). */
    timezone: { type: String, default: "Asia/Kolkata" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Clinic", clinicSchema);
