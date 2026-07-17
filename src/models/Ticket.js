const mongoose = require("mongoose");

const STATUSES = ["waiting", "serving", "done", "cancelled", "noshow"];

const ticketSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, default: "—" },
    status: { type: String, enum: STATUSES, default: "waiting", index: true },
    source: { type: String, enum: ["manual", "qr", "self"], default: "manual" },
    positionAtJoin: { type: Number, default: 0 },
    calledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ doctorId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model("Ticket", ticketSchema);
module.exports.STATUSES = STATUSES;
