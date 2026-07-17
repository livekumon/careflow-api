const mongoose = require("mongoose");
const { defaultScheduleSets } = require("../services/scheduleService");

const slotSchema = new mongoose.Schema(
  {
    start: { type: String, default: "09:00" },
    end: { type: String, default: "17:00" },
  },
  { _id: false }
);

const scheduleSetSchema = new mongoose.Schema(
  {
    days: [{ type: String, enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }],
    slots: { type: [slotSchema], default: () => [{ start: "09:00", end: "17:00" }] },
  },
  { _id: false }
);

const doctorSchema = new mongoose.Schema(
  {
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    specialty: { type: String, required: true },
    servingTicketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },
    doneCount: { type: Number, default: 0 },
    consultHistory: { type: [Number], default: () => [10, 10, 10, 10, 10] },
    schedule: { type: [scheduleSetSchema], default: defaultScheduleSets },
    /** Receptionist can mark doctor unavailable (leave / other). */
    available: { type: Boolean, default: true },
    unavailableReason: { type: String, default: "" },
    /** Receptionist can extend queue beyond consultation hours. */
    queueExtended: { type: Boolean, default: false },
    /** Minutes before appointment start when check-in opens. */
    checkInBeforeMin: { type: Number, default: 10 },
    /** Minutes after appointment start before auto noshow. */
    checkInAfterMin: { type: Number, default: 15 },
    /** Daily display-token counter (resets when tokenDate changes). */
    tokenDate: { type: String, default: "" },
    tokenSeq: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

doctorSchema.index({ clinicId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Doctor", doctorSchema);
