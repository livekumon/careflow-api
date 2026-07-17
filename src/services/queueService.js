const Doctor = require("../models/Doctor");
const Ticket = require("../models/Ticket");
const Clinic = require("../models/Clinic");

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
  return Ticket.find({ doctorId, status: "waiting" }).sort({ createdAt: 1 }).lean();
}

function serializeTicket(ticket, position, avg) {
  if (!ticket) return null;
  return {
    id: String(ticket._id),
    name: ticket.name,
    phone: ticket.phone,
    status: ticket.status,
    source: ticket.source,
    waitMinutes: position != null ? (position + 1) * avg : null,
    position: position != null ? position + 1 : null,
    createdAt: ticket.createdAt,
  };
}

async function serializeDoctor(doctor) {
  const avg = avgFor(doctor.consultHistory);
  const waiting = await waitingTickets(doctor._id);
  let serving = null;
  if (doctor.servingTicketId) {
    serving = await Ticket.findById(doctor.servingTicketId).lean();
  }
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
    await Ticket.findByIdAndUpdate(doctor.servingTicketId, {
      status: "done",
      completedAt: new Date(),
    });
    logDuration(doctor);
  }

  const next = await Ticket.findOne({ doctorId: doctor._id, status: "waiting" }).sort({ createdAt: 1 });
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
