const { normalizeScheduleSets } = require("./scheduleService");
const { getZonedParts, resolveClinicTimezone, DEFAULT_TIMEZONE } = require("./timezoneService");

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00")
    .split(":")
    .map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * @param {object} doctor
 * @param {Date} [now]
 * @param {string} [timeZone] IANA zone, e.g. Asia/Kolkata
 */
function isWithinSchedule(doctor, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const sets = normalizeScheduleSets(doctor.schedule);
  const zoned = getZonedParts(now, timeZone);
  const day = zoned.dayKey;
  const minutes = zoned.minutes;

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
 *  available: boolean,
 *  timeZone: string
 * }}
 */
function getDoctorAvailability(doctor, now = new Date(), timeZoneOrClinic = DEFAULT_TIMEZONE) {
  const timeZone = resolveClinicTimezone(timeZoneOrClinic);
  const available = doctor.available !== false;
  const reason = String(doctor.unavailableReason || "").trim();
  const queueExtended = Boolean(doctor.queueExtended);
  const withinHours = isWithinSchedule(doctor, now, timeZone);

  if (!available) {
    return {
      canJoin: false,
      status: "unavailable",
      reason: reason || "Doctor is not available today",
      withinHours,
      queueExtended,
      available: false,
      timeZone,
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
      timeZone,
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
      timeZone,
    };
  }

  return {
    canJoin: false,
    status: "outside_hours",
    reason: "Outside consultation hours",
    withinHours: false,
    queueExtended: false,
    available: true,
    timeZone,
  };
}

function assertCanJoinQueue(doctor, { forceExtend = false, timeZone } = {}) {
  const availability = getDoctorAvailability(doctor, new Date(), timeZone);
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
