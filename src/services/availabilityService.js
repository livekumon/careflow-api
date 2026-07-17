const { normalizeScheduleSets } = require("./scheduleService");

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00")
    .split(":")
    .map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function isWithinSchedule(doctor, now = new Date()) {
  const sets = normalizeScheduleSets(doctor.schedule);
  const day = DAY_KEYS[now.getDay()];
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const set of sets) {
    if (!set.days?.includes(day)) continue;
    for (const slot of set.slots || []) {
      const start = timeToMinutes(slot.start);
      const end = timeToMinutes(slot.end);
      if (minutes >= start && minutes <= end) return true;
    }
  }
  return false;
}

/**
 * @returns {{
 *  canJoin: boolean,
 *  status: 'available' | 'unavailable' | 'outside_hours' | 'extended',
 *  reason: string,
 *  withinHours: boolean,
 *  queueExtended: boolean,
 *  available: boolean
 * }}
 */
function getDoctorAvailability(doctor, now = new Date()) {
  const available = doctor.available !== false;
  const reason = String(doctor.unavailableReason || "").trim();
  const queueExtended = Boolean(doctor.queueExtended);
  const withinHours = isWithinSchedule(doctor, now);

  if (!available) {
    return {
      canJoin: false,
      status: "unavailable",
      reason: reason || "Doctor is not available today",
      withinHours,
      queueExtended,
      available: false,
    };
  }

  if (withinHours) {
    return {
      canJoin: true,
      status: "available",
      reason: "",
      withinHours: true,
      queueExtended,
      available: true,
    };
  }

  if (queueExtended) {
    return {
      canJoin: true,
      status: "extended",
      reason: "Queue extended by front desk",
      withinHours: false,
      queueExtended: true,
      available: true,
    };
  }

  return {
    canJoin: false,
    status: "outside_hours",
    reason: "Outside consultation hours",
    withinHours: false,
    queueExtended: false,
    available: true,
  };
}

function assertCanJoinQueue(doctor, { forceExtend = false } = {}) {
  const availability = getDoctorAvailability(doctor);
  if (availability.status === "unavailable") {
    const err = new Error(availability.reason);
    err.status = 403;
    err.code = "DOCTOR_UNAVAILABLE";
    err.availability = availability;
    throw err;
  }
  if (availability.canJoin) return availability;

  if (forceExtend) {
    return { ...availability, canJoin: true, status: "extended", queueExtended: true };
  }

  const err = new Error(availability.reason);
  err.status = 403;
  err.code = "OUTSIDE_HOURS";
  err.availability = availability;
  throw err;
}

module.exports = {
  isWithinSchedule,
  getDoctorAvailability,
  assertCanJoinQueue,
};
