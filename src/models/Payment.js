const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    planId: { type: String, required: true },
    billingPeriod: { type: String, enum: ["annual", "monthly"], required: true },
    amountUsd: { type: Number, required: true },
    amountInr: { type: Number, default: null },
    currency: { type: String, default: "USD" },
    method: { type: String, enum: ["paypal", "razorpay"], required: true },
    status: {
      type: String,
      enum: ["created", "completed", "failed", "cancelled"],
      default: "created",
      index: true,
    },
    providerOrderId: { type: String, required: true, index: true },
    providerPaymentId: { type: String, default: "" },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ clinicId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
