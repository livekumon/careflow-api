const mongoose = require("mongoose");

const STATUSES = ["booked", "arrived", "cancelled", "completed", "noshow"];

const appointmentSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true },
    durationMin: { type: Number, default: 15 },
    /** Stable queue number reserved at booking. */
    queueNumber: { type: Number, default: null },
    /** Reserved order key (usually startTime in minutes). */
    orderKey: { type: Number, default: null },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },
    notes: { type: String, default: "" },
    status: { type: String, enum: STATUSES, default: "booked", index: true },
    createdByRole: { type: String, default: "receptionist" },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

appointmentSchema.index({ clinicId: 1, doctorId: 1, date: 1, startTime: 1 });

module.exports = mongoose.model("Appointment", appointmentSchema);
module.exports.STATUSES = STATUSES;
