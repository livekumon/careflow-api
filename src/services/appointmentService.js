const { normalizeScheduleSets } = require("./scheduleService");

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00")
    .split(":")
    .map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseDateOnly(dateStr) {
  const [y, mo, d] = String(dateStr || "")
    .split("-")
    .map((n) => Number(n));
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d);
}

function dayKeyForDate(dateStr) {
  const dt = parseDateOnly(dateStr);
  if (!dt) return null;
  return DAY_KEYS[dt.getDay()];
}

function isSlotWithinSchedule(doctor, dateStr, startTime, endTime) {
  const day = dayKeyForDate(dateStr);
  if (!day) return false;
  const sets = normalizeScheduleSets(doctor.schedule);
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end <= start) return false;

  for (const set of sets) {
    if (!set.days?.includes(day)) continue;
    for (const slot of set.slots || []) {
      const slotStart = timeToMinutes(slot.start);
      const slotEnd = timeToMinutes(slot.end);
      if (start >= slotStart && end <= slotEnd) return true;
    }
  }
  return false;
}

/** Generate 15-min candidate starts inside doctor's schedule for a date. */
function listOpenSlots(doctor, dateStr, durationMinutes = 15) {
  const day = dayKeyForDate(dateStr);
  if (!day) return [];
  if (doctor.available === false) return [];

  const sets = normalizeScheduleSets(doctor.schedule);
  const starts = new Set();
  for (const set of sets) {
    if (!set.days?.includes(day)) continue;
    for (const slot of set.slots || []) {
      let t = timeToMinutes(slot.start);
      const end = timeToMinutes(slot.end);
      while (t + durationMinutes <= end) {
        starts.add(minutesToTime(t));
        t += durationMinutes;
      }
    }
  }
  return [...starts].sort();
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

module.exports = {
  timeToMinutes,
  minutesToTime,
  dayKeyForDate,
  isSlotWithinSchedule,
  listOpenSlots,
  rangesOverlap,
};
