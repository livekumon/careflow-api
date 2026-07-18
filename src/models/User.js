const mongoose = require("mongoose");

const ROLES = ["receptionist", "doctor", "admin", "superadmin"];

const userSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Tenant staff: unique email per clinic
userSchema.index(
  { clinicId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { clinicId: { $type: "objectId" } },
  }
);
// Super admins: unique email globally
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { role: "superadmin" },
  }
);

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
