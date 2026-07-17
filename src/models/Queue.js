const crypto = require("crypto");
const mongoose = require("mongoose");

function generateQueueCode() {
  // Short public id — not the Mongo _id. Decouples QR from internal doctor/clinic ids.
  return `q_${crypto.randomBytes(5).toString("hex")}`;
}

const queueSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true },
    /** doctor = QR for one doctor; clinic = QR for whole clinic (patient picks doctor). */
    scope: { type: String, enum: ["clinic", "doctor"], default: "doctor", required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

queueSchema.index(
  { clinicId: 1, doctorId: 1 },
  {
    unique: true,
    name: "clinic_doctor_queue_unique",
    partialFilterExpression: { scope: "doctor" },
  }
);
queueSchema.index(
  { clinicId: 1 },
  {
    unique: true,
    name: "clinic_queue_unique",
    partialFilterExpression: { scope: "clinic" },
  }
);
queueSchema.index({ scope: 1 });

module.exports = mongoose.model("Queue", queueSchema);
module.exports.generateQueueCode = generateQueueCode;
