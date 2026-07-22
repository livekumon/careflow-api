const Doctor = require("../models/Doctor");
const Ticket = require("../models/Ticket");
const Clinic = require("../models/Clinic");
const Appointment = require("../models/Appointment");

function avgFor(history = []) {
  if (!history.length) return 10;
  return Math.round(history.reduce((a, b) => a + b, 0) / history.length);
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return phone || "—";
  return `${digits.slice(0, 2)}••••${digits.slice(-3)}`;
}

async function waitingTickets(doctorId) {
  return Ticket.find({ doctorId, status: "waiting" })
    .sort({ orderKey: 1, createdAt: 1 })
    .lean();
}

function serializeTicket(ticket, rankIndex, avg) {
  if (!ticket) return null;
  const displayToken =
    ticket.displayToken != null
      ? ticket.displayToken
      : ticket.positionAtJoin || (rankIndex != null ? rankIndex + 1 : null);
  return {
    id: String(ticket._id),
    name: ticket.name,
    phone: ticket.phone,
    status: ticket.status,
    source: ticket.source,
    displayToken,
    orderKey: ticket.orderKey,
    appointmentId: ticket.appointmentId ? String(ticket.appointmentId) : null,
    /** Stable queue number shown to patients — does not change on mid-inserts. */
    position: displayToken,
    /** Live wait from current order (updates when someone is inserted ahead). */
    waitMinutes: rankIndex != null ? (rankIndex + 1) * avg : null,
    ahead: rankIndex != null ? rankIndex : null,
    createdAt: ticket.createdAt,
  };
}

async function serializeDoctor(doctor, timeZoneOrClinic = null) {
  const { getDoctorAvailability } = require("./availabilityService");
  const { resolveClinicTimezone, DEFAULT_TIMEZONE } = require("./timezoneService");
  let timeZone = resolveClinicTimezone(timeZoneOrClinic);
  if (!timeZoneOrClinic && doctor.clinicId) {
    const clinic = await Clinic.findById(doctor.clinicId).lean();
    timeZone = resolveClinicTimezone(clinic) || DEFAULT_TIMEZONE;
  }
  const avg = avgFor(doctor.consultHistory);
  const waiting = await waitingTickets(doctor._id);
  let serving = null;
  if (doctor.servingTicketId) {
    serving = await Ticket.findById(doctor.servingTicketId).lean();
    if (serving && serving.status !== "serving") serving = null;
  }
  if (!serving) {
    serving = await Ticket.findOne({ doctorId: doctor._id, status: "serving" })
      .sort({ calledAt: -1, updatedAt: -1 })
      .lean();
  }
  const availability = getDoctorAvailability(doctor, new Date(), timeZone);
  return {
    id: String(doctor._id),
    key: doctor.key,
    name: doctor.name,
    specialty: doctor.specialty,
    doneCount: doctor.doneCount,
    avgMinutes: avg,
    waitingCount: waiting.length,
    serving: serializeTicket(serving, null, avg),
    queue: waiting.map((t, i) => serializeTicket(t, i, avg)),
    schedule: doctor.schedule || [],
    available: availability.available,
    unavailableReason: availability.status === "unavailable" ? availability.reason : "",
    queueExtended: availability.queueExtended,
    withinHours: availability.withinHours,
    canJoin: availability.canJoin,
    availabilityStatus: availability.status,
    availabilityReason: availability.reason,
    checkInBeforeMin: doctor.checkInBeforeMin ?? 10,
    checkInAfterMin: doctor.checkInAfterMin ?? 15,
    timeZone: availability.timeZone,
  };
}

function logDuration(doctor) {
  const avg = avgFor(doctor.consultHistory);
  const dur = Math.max(4, avg + Math.round((Math.random() - 0.5) * 6));
  doctor.consultHistory.push(dur);
  if (doctor.consultHistory.length > 5) doctor.consultHistory.shift();
  doctor.doneCount += 1;
}

async function advanceQueue(doctor) {
  if (doctor.servingTicketId) {
    const finished = await Ticket.findByIdAndUpdate(
      doctor.servingTicketId,
      { status: "done", completedAt: new Date() },
      { new: true }
    );
    if (finished?.appointmentId) {
      await Appointment.findByIdAndUpdate(finished.appointmentId, { status: "completed" });
    }
    logDuration(doctor);
  }

  const next = await Ticket.findOne({ doctorId: doctor._id, status: "waiting" }).sort({
    orderKey: 1,
    createdAt: 1,
  });
  if (next) {
    next.status = "serving";
    next.calledAt = new Date();
    await next.save();
    doctor.servingTicketId = next._id;
  } else {
    doctor.servingTicketId = null;
  }
  await doctor.save();
  return doctor;
}

/** Clear waiting + serving tickets for a doctor (staff reset). */
async function resetDoctorQueue(doctor) {
  await Ticket.updateMany(
    { doctorId: doctor._id, status: { $in: ["waiting", "serving"] } },
    { $set: { status: "cancelled" } }
  );
  doctor.servingTicketId = null;
  await doctor.save();
  return doctor;
}

async function getDoctorOrThrow(clinicId, doctorId) {
  const doctor = await Doctor.findOne({ _id: doctorId, clinicId, active: true });
  if (!doctor) {
    const err = new Error("Doctor not found");
    err.status = 404;
    throw err;
  }
  return doctor;
}

async function getClinicBySlug(slug) {
  const clinic = await Clinic.findOne({ slug, active: true });
  if (!clinic) {
    const err = new Error("Clinic not found");
    err.status = 404;
    throw err;
  }
  if (clinic.accessStopped) {
    const err = new Error("Clinic access has been stopped");
    err.status = 403;
    err.code = "ACCESS_STOPPED";
    throw err;
  }
  return clinic;
}

module.exports = {
  avgFor,
  maskPhone,
  waitingTickets,
  serializeTicket,
  serializeDoctor,
  advanceQueue,
  resetDoctorQueue,
  getDoctorOrThrow,
  getClinicBySlug,
};
