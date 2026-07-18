/** Default clinic timezone — India clinics; Vercel servers run in UTC. */
const DEFAULT_TIMEZONE = process.env.CLINIC_TIMEZONE || "Asia/Kolkata";

const WEEKDAY_TO_KEY = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

/**
 * Calendar / clock parts for an instant in a given IANA timezone.
 * @returns {{ timeZone: string, dayKey: string, minutes: number, dateStr: string, hour: number, minute: number }}
 */
function getZonedParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const tz = timeZone || DEFAULT_TIMEZONE;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const dayKey = WEEKDAY_TO_KEY[parts.weekday] || "mon";
  return {
    timeZone: tz,
    dayKey,
    minutes: hour * 60 + minute,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
  };
}

function resolveClinicTimezone(clinicOrTz) {
  if (!clinicOrTz) return DEFAULT_TIMEZONE;
  if (typeof clinicOrTz === "string") return clinicOrTz || DEFAULT_TIMEZONE;
  return clinicOrTz.timezone || DEFAULT_TIMEZONE;
}

module.exports = {
  DEFAULT_TIMEZONE,
  getZonedParts,
  resolveClinicTimezone,
};
