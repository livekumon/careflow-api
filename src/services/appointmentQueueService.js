const Appointment = require("../models/Appointment");
const Ticket = require("../models/Ticket");
const Clinic = require("../models/Clinic");
const { avgFor, waitingTickets, maskPhone } = require("./queueService");
const { timeToMinutes } = require("./appointmentService");
const { getZonedParts, resolveClinicTimezone, DEFAULT_TIMEZONE } = require("./timezoneService");

function todayStr(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return getZonedParts(now, timeZone).dateStr;
}

function windowBounds(doctor, appt, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const before = Math.max(0, Number(doctor.checkInBeforeMin) || 10);
  const after = Math.max(0, Number(doctor.checkInAfterMin) || 15);
  const startMin = timeToMinutes(appt.startTime);
  return {
    before,
    after,
    date: appt.date,
    startMin,
    openMin: startMin - before,
    closeMin: startMin + after,
    timeZone,
  };
}

/**
 * Check-in phase using clinic timezone (not server local/UTC).
 * @returns {'early'|'open'|'late'}
 */
function getCheckInPhase(doctor, appt, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const bounds = windowBounds(doctor, appt, now, timeZone);
  const zoned = getZonedParts(now, timeZone);
  if (zoned.dateStr < appt.date) return "early";
  if (zoned.dateStr > appt.date) return "late";
  if (zoned.minutes < bounds.openMin) return "early";
  if (zoned.minutes <= bounds.closeMin) return "open";
  return "late";
}

async function clinicTimezoneForDoctor(doctor) {
  if (!doctor?.clinicId) return DEFAULT_TIMEZONE;
  const clinic = await Clinic.findById(doctor.clinicId).lean();
  return resolveClinicTimezone(clinic);
}

async function allocateDisplayToken(doctor, date) {
  const timeZone = await clinicTimezoneForDoctor(doctor);
  const day = date || todayStr(new Date(), timeZone);
  if (doctor.tokenDate !== day) {
    doctor.tokenDate = day;
    doctor.tokenSeq = 0;
  }
  doctor.tokenSeq += 1;
  await doctor.save();
  return doctor.tokenSeq;
}

async function nextAppendOrderKey(doctorId, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const waiting = await waitingTickets(doctorId);
  const zoned = getZonedParts(now, timeZone);
  const nowMin = zoned.minutes + now.getSeconds() / 60;
  const maxWaiting = waiting.reduce((m, t) => Math.max(m, Number(t.orderKey) || 0), 0);
  return Math.max(maxWaiting, nowMin) + 1;
}

function midpointOrderKey(beforeKey, afterKey) {
  const a = Number(beforeKey);
  const b = Number(afterKey);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    return a + 0.5;
  }
  return (a + b) / 2;
}

function minutesToClock(total) {
  const m = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Mark booked appointments past the check-in window as noshow. */
async function expireMissedAppointments(clinicId, doctorId, date, doctor, now = new Date()) {
  const timeZone = await clinicTimezoneForDoctor(doctor);
  const day = date || todayStr(now, timeZone);
  const booked = await Appointment.find({
    clinicId,
    doctorId,
    date: day,
    status: "booked",
  });
  let changed = 0;
  for (const appt of booked) {
    if (getCheckInPhase(doctor, appt, now, timeZone) === "late") {
      appt.status = "noshow";
      await appt.save();
      changed += 1;
    }
  }
  return changed;
}

function serializeAppointmentExtra(appt, doctor, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const tz = timeZone || DEFAULT_TIMEZONE;
  const phase =
    appt.status === "booked"
      ? getCheckInPhase(doctor, appt, now, tz)
      : appt.status === "noshow"
        ? "late"
        : null;
  const bounds = windowBounds(doctor, appt, now, tz);
  return {
    queueNumber: appt.queueNumber,
    durationMin: appt.durationMin,
    orderKey: appt.orderKey,
    ticketId: appt.ticketId ? String(appt.ticketId) : null,
    checkInPhase: phase,
    checkInWindow: {
      beforeMin: bounds.before,
      afterMin: bounds.after,
      openTime: minutesToClock(bounds.openMin),
      closeTime: minutesToClock(bounds.closeMin),
      timeZone: tz,
    },
  };
}

async function createTicketForAppointment(doctor, appt, { orderKey, clinicId }) {
  const waiting = await waitingTickets(doctor._id);
  const displayToken = appt.queueNumber || (await allocateDisplayToken(doctor, appt.date));
  if (!appt.queueNumber) {
    appt.queueNumber = displayToken;
  }

  const ticket = await Ticket.create({
    clinicId: clinicId || appt.clinicId,
    doctorId: doctor._id,
    name: appt.patientName,
    phone: appt.phone || "—",
    status: "waiting",
    source: "appointment",
    displayToken,
    orderKey,
    appointmentId: appt._id,
    positionAtJoin: displayToken,
  });

  appt.status = "arrived";
  appt.ticketId = ticket._id;
  appt.orderKey = orderKey;
  await appt.save();

  return { ticket, waitingCount: waiting.length };
}

async function checkInAppointment(doctor, appt, { clinicId, now = new Date() } = {}) {
  if (appt.status === "arrived" && appt.ticketId) {
    const err = new Error("Already checked in");
    err.status = 400;
    err.code = "ALREADY_CHECKED_IN";
    throw err;
  }
  if (appt.status === "cancelled" || appt.status === "completed") {
    const err = new Error(`Appointment is ${appt.status}`);
    err.status = 400;
    throw err;
  }

  const timeZone = await clinicTimezoneForDoctor(doctor);
  await expireMissedAppointments(appt.clinicId, doctor._id, appt.date, doctor, now);
  const fresh = await Appointment.findById(appt._id);
  if (!fresh) {
    const err = new Error("Appointment not found");
    err.status = 404;
    throw err;
  }

  if (fresh.status === "noshow") {
    const err = new Error("Check-in window has passed. Choose insert or add to end of queue.");
    err.status = 409;
    err.code = "LATE_CHECKIN";
    throw err;
  }
  if (fresh.status !== "booked") {
    const err = new Error(`Cannot check in when status is ${fresh.status}`);
    err.status = 400;
    throw err;
  }

  const phase = getCheckInPhase(doctor, fresh, now, timeZone);
  if (phase === "early") {
    const bounds = windowBounds(doctor, fresh, now, timeZone);
    const err = new Error(
      `Check-in opens at ${minutesToClock(bounds.openMin)} (${bounds.before} min before appointment)`
    );
    err.status = 400;
    err.code = "TOO_EARLY";
    throw err;
  }
  if (phase === "late") {
    fresh.status = "noshow";
    await fresh.save();
    const err = new Error("Check-in window has passed. Choose insert or add to end of queue.");
    err.status = 409;
    err.code = "LATE_CHECKIN";
    throw err;
  }

  const orderKey =
    Number(fresh.orderKey) || timeToMinutes(fresh.startTime) || (await nextAppendOrderKey(doctor._id));
  return createTicketForAppointment(doctor, fresh, { orderKey, clinicId });
}

/**
 * Late join after missed window.
 * placement: 'end' | 'insert'
 * afterTicketId: insert after this waiting ticket (required for insert)
 */
async function lateJoinAppointment(doctor, appt, { placement, afterTicketId, clinicId } = {}) {
  if (appt.ticketId && appt.status === "arrived") {
    const err = new Error("Already checked in");
    err.status = 400;
    throw err;
  }
  if (!["noshow", "booked"].includes(appt.status)) {
    const err = new Error(`Cannot late-join when status is ${appt.status}`);
    err.status = 400;
    throw err;
  }

  const timeZone = await clinicTimezoneForDoctor(doctor);
  // Ensure booked-past-window is treated as noshow
  if (appt.status === "booked" && getCheckInPhase(doctor, appt, new Date(), timeZone) === "late") {
    appt.status = "noshow";
    await appt.save();
  }

  let orderKey;
  const waiting = await waitingTickets(doctor._id);
  if (placement === "insert" && waiting.length && afterTicketId) {
    const idx = waiting.findIndex((t) => String(t._id) === String(afterTicketId));
    if (idx < 0) {
      const err = new Error("That patient is not waiting");
      err.status = 400;
      throw err;
    }
    const beforeKey = Number(waiting[idx].orderKey) || idx + 1;
    const afterKey =
      idx + 1 < waiting.length
        ? Number(waiting[idx + 1].orderKey) || beforeKey + 1
        : beforeKey + 1;
    orderKey = midpointOrderKey(beforeKey, afterKey);
  } else if (placement === "insert" && waiting.length && !afterTicketId) {
    const err = new Error("Select who to insert after");
    err.status = 400;
    err.code = "AFTER_TICKET_REQUIRED";
    throw err;
  } else {
    orderKey = await nextAppendOrderKey(doctor._id);
  }

  if (appt.status === "noshow") {
    // reopen for arrival
    appt.status = "booked";
  }

  return createTicketForAppointment(doctor, appt, { orderKey, clinicId });
}

async function createWalkInTicket(doctor, { clinicId, name, phone, source }) {
  const timeZone = await clinicTimezoneForDoctor(doctor);
  const displayToken = await allocateDisplayToken(doctor, todayStr(new Date(), timeZone));
  const orderKey = await nextAppendOrderKey(doctor._id, new Date(), timeZone);
  const waiting = await waitingTickets(doctor._id);
  const ticket = await Ticket.create({
    clinicId,
    doctorId: doctor._id,
    name,
    phone: phone ? maskPhone(phone) : "—",
    status: "waiting",
    source,
    displayToken,
    orderKey,
    positionAtJoin: displayToken,
  });
  return { ticket, rankIndex: waiting.length };
}

module.exports = {
  todayStr,
  windowBounds,
  getCheckInPhase,
  allocateDisplayToken,
  nextAppendOrderKey,
  expireMissedAppointments,
  serializeAppointmentExtra,
  checkInAppointment,
  lateJoinAppointment,
  createWalkInTicket,
  avgFor,
};
