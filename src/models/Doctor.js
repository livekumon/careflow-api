const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    specialty: { type: String, required: true },
    servingTicketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },
    doneCount: { type: Number, default: 0 },
    consultHistory: { type: [Number], default: () => [10, 10, 10, 10, 10] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

doctorSchema.index({ clinicId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Doctor", doctorSchema);
