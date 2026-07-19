const mongoose = require("mongoose");

const clinicSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    /** Lowercase trimmed name for case-insensitive login lookup. */
    nameKey: { type: String, required: true, unique: true, index: true },
    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    location: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" },
    },
    /** IANA timezone for consultation hours (Vercel runs in UTC). */
    timezone: { type: String, default: "Asia/Kolkata" },
    /** Default appointment check-in window (minutes before / after start). */
    checkInBeforeMin: { type: Number, default: 10 },
    checkInAfterMin: { type: Number, default: 15 },
    active: { type: Boolean, default: true },
    /**
     * Soft stop — clinic stays in the system but staff/patient access is blocked.
     * Used for admin archive and payment expiry.
     */
    accessStopped: { type: Boolean, default: false, index: true },
    accessStoppedAt: { type: Date, default: null },
    /** e.g. admin | payment | other */
    accessStoppedReason: { type: String, default: "" },
    /** Free trial end (30 days from registration). */
    trialEndsAt: { type: Date, default: null, index: true },
    /** trial | active | expired */
    subscriptionStatus: {
      type: String,
      enum: ["trial", "active", "expired"],
      default: "trial",
      index: true,
    },
    /** solo | pack | bulk */
    subscriptionPlan: { type: String, default: "" },
    /** annual | monthly */
    subscriptionBilling: { type: String, default: "" },
    subscriptionEndsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Clinic", clinicSchema);
