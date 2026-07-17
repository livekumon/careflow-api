const mongoose = require("mongoose");

const STATUSES = ["waiting", "serving", "done", "cancelled", "noshow"];

const ticketSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, default: "—" },
    status: { type: String, enum: STATUSES, default: "waiting", index: true },
    source: { type: String, enum: ["manual", "qr", "self", "appointment"], default: "manual" },
    /** Stable patient-facing queue number — never renumbered after assign. */
    displayToken: { type: Number, default: null },
    /** Internal sort key; fractional inserts use values like 4.5. */
    orderKey: { type: Number, default: null, index: true },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
      index: true,
    },
    positionAtJoin: { type: Number, default: 0 },
    calledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ doctorId: 1, status: 1, orderKey: 1, createdAt: 1 });

module.exports = mongoose.model("Ticket", ticketSchema);
module.exports.STATUSES = STATUSES;
