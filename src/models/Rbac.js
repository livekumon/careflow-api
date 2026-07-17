const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    system: { type: Boolean, default: false },
  },
  { _id: false }
);

const pageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    desc: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const actionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    page: { type: String, required: true },
    roles: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const rbacSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, unique: true },
    roles: { type: [roleSchema], default: [] },
    pages: { type: [pageSchema], default: [] },
    pageAccess: { type: mongoose.Schema.Types.Mixed, default: {} },
    actions: { type: [actionSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Rbac", rbacSchema);
