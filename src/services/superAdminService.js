const Clinic = require("../models/Clinic");
const Doctor = require("../models/Doctor");
const Ticket = require("../models/Ticket");
const Appointment = require("../models/Appointment");
const { getZonedParts, DEFAULT_TIMEZONE } = require("./timezoneService");

const RANGES = new Set(["today", "week", "month", "year", "custom"]);

function addDaysIso(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function countDaysInclusive(fromStr, toStr) {
  const a = Date.parse(`${fromStr}T00:00:00Z`);
  const b = Date.parse(`${toStr}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function eachDay(fromStr, toStr) {
  const days = [];
  let cur = fromStr;
  while (cur <= toStr) {
    days.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return days;
}

function eachMonth(fromStr, toStr) {
  const months = [];
  let [y, m] = fromStr.split("-").map(Number);
  const [ey, em] = toStr.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
function zonedDateTimeToUtc(dateStr, hour = 0, minute = 0, timeZone = DEFAULT_TIMEZONE) {
  let utcMs = Date.parse(
    `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`
  );
  for (let i = 0; i < 4; i += 1) {
    const p = getZonedParts(new Date(utcMs), timeZone);
    const [ty, tm, td] = p.dateStr.split("-").map(Number);
    const [yy, ym, yd] = dateStr.split("-").map(Number);
    const dayDiff = Math.round(
      (Date.UTC(yy, ym - 1, yd) - Date.UTC(ty, tm - 1, td)) / 86400000
    );
    const desiredMin = hour * 60 + minute;
    const actualMin = p.hour * 60 + p.minute;
    utcMs += (dayDiff * 1440 + (desiredMin - actualMin)) * 60000;
  }
  return new Date(utcMs);
}

function startOfDayUtc(dateStr, timeZone) {
  return zonedDateTimeToUtc(dateStr, 0, 0, timeZone);
}

function endOfDayUtc(dateStr, timeZone) {
  // exclusive next-day start is cleaner for queries; keep inclusive end for $lte
  const next = addDaysIso(dateStr, 1);
  return new Date(startOfDayUtc(next, timeZone).getTime() - 1);
}

function mondayOf(dateStr, timeZone) {
  const noon = zonedDateTimeToUtc(dateStr, 12, 0, timeZone);
  const dayKey = getZonedParts(noon, timeZone).dayKey;
  const sinceMon = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }[dayKey] ?? 0;
  return addDaysIso(dateStr, -sinceMon);
}

function resolvePeriod({ range = "month", from, to, timeZone = DEFAULT_TIMEZONE } = {}) {
  const today = getZonedParts(new Date(), timeZone).dateStr;
  let period = RANGES.has(range) ? range : "month";
  let fromStr;
  let toStr = today;

  if (period === "today") {
    fromStr = today;
  } else if (period === "week") {
    fromStr = mondayOf(today, timeZone);
  } else if (period === "month") {
    fromStr = `${today.slice(0, 8)}01`;
  } else if (period === "year") {
    fromStr = `${today.slice(0, 4)}-01-01`;
  } else {
    // custom
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    fromStr = iso.test(String(from || "")) ? String(from) : addDaysIso(today, -29);
    toStr = iso.test(String(to || "")) ? String(to) : today;
    if (fromStr > toStr) {
      const tmp = fromStr;
      fromStr = toStr;
      toStr = tmp;
    }
    // Cap custom span at 366 days
    if (countDaysInclusive(fromStr, toStr) > 366) {
      fromStr = addDaysIso(toStr, -365);
    }
  }

  const fromDate = startOfDayUtc(fromStr, timeZone);
  const toDate = endOfDayUtc(toStr, timeZone);
  const dayCount = countDaysInclusive(fromStr, toStr);
  const granularity = dayCount > 62 ? "month" : "day";
  const buckets =
    granularity === "month" ? eachMonth(fromStr, toStr) : eachDay(fromStr, toStr);

  return {
    range: period,
    from: fromStr,
    to: toStr,
    fromDate,
    toDate,
    dayCount,
    granularity,
    buckets,
    timeZone,
  };
}

function fillSeries(buckets, rows) {
  const map = new Map(rows.map((r) => [r._id, r.count]));
  return buckets.map((date) => ({ date, count: map.get(date) || 0 }));
}

function dateFormatForGranularity(granularity) {
  return granularity === "month" ? "%Y-%m" : "%Y-%m-%d";
}

async function countByPeriod(Model, dateField, period) {
  const fmt = dateFormatForGranularity(period.granularity);
  return Model.aggregate([
    { $match: { [dateField]: { $gte: period.fromDate, $lte: period.toDate } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: fmt,
            date: `$${dateField}`,
            timezone: period.timeZone,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

async function getSuperAdminDashboard(opts = {}) {
  const period = resolvePeriod(opts);
  const createdInRange = { $gte: period.fromDate, $lte: period.toDate };
  const fmt = dateFormatForGranularity(period.granularity);

  const [
    clinicsTotal,
    doctorsTotal,
    appointmentsTotal,
    patientsServed,
    clinicTrendRows,
    doctorTrendRows,
    servedTrendRows,
    clinics,
  ] = await Promise.all([
    Clinic.countDocuments({ active: true, createdAt: createdInRange }),
    Doctor.countDocuments({ active: true, createdAt: createdInRange }),
    Appointment.countDocuments({ createdAt: createdInRange }),
    Ticket.countDocuments({
      status: "done",
      $or: [
        { completedAt: createdInRange },
        { completedAt: null, updatedAt: createdInRange },
      ],
    }),
    countByPeriod(Clinic, "createdAt", period),
    countByPeriod(Doctor, "createdAt", period),
    Ticket.aggregate([
      {
        $match: {
          status: "done",
          $or: [
            { completedAt: createdInRange },
            { completedAt: null, updatedAt: createdInRange },
          ],
        },
      },
      {
        $addFields: {
          servedAt: { $ifNull: ["$completedAt", "$updatedAt"] },
        },
      },
      {
        $match: {
          servedAt: createdInRange,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: fmt,
              date: "$servedAt",
              timezone: period.timeZone,
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Clinic.find({ active: true, createdAt: createdInRange })
      .select("name slug location createdAt accessStopped accessStoppedAt accessStoppedReason")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const locationMap = new Map();
  for (const c of clinics) {
    const city = String(c.location?.city || "").trim() || "Unknown";
    const state = String(c.location?.state || "").trim();
    const country = String(c.location?.country || "").trim() || "India";
    const key = state ? `${city}, ${state}` : city;
    const prev = locationMap.get(key) || { label: key, city, state, country, count: 0 };
    prev.count += 1;
    locationMap.set(key, prev);
  }

  const locations = [...locationMap.values()].sort((a, b) => b.count - a.count);

  return {
    period: {
      range: period.range,
      from: period.from,
      to: period.to,
      dayCount: period.dayCount,
      granularity: period.granularity,
      timeZone: period.timeZone,
    },
    totals: {
      clinics: clinicsTotal,
      doctors: doctorsTotal,
      appointments: appointmentsTotal,
      patientsServed,
    },
    trends: {
      granularity: period.granularity,
      clinics: fillSeries(period.buckets, clinicTrendRows),
      doctors: fillSeries(period.buckets, doctorTrendRows),
      patientsServed: fillSeries(period.buckets, servedTrendRows),
    },
    locations,
    clinics: clinics.map((c) => serializeClinicRow(c)),
    timeZone: period.timeZone,
  };
}

function serializeClinicRow(c) {
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    location: {
      address: c.location?.address || "",
      city: c.location?.city || "",
      state: c.location?.state || "",
      country: c.location?.country || "India",
    },
    createdAt: c.createdAt,
    accessStopped: Boolean(c.accessStopped),
    accessStoppedAt: c.accessStoppedAt || null,
    accessStoppedReason: c.accessStoppedReason || "",
  };
}

async function setClinicAccess({ clinicId, accessStopped, reason = "" } = {}) {
  if (!clinicId) {
    const err = new Error("Clinic id is required");
    err.status = 400;
    throw err;
  }
  const stopped = Boolean(accessStopped);
  const clinic = await Clinic.findOneAndUpdate(
    { _id: clinicId, active: true },
    {
      $set: {
        accessStopped: stopped,
        accessStoppedAt: stopped ? new Date() : null,
        accessStoppedReason: stopped ? String(reason || "admin").slice(0, 40) : "",
      },
    },
    { new: true }
  )
    .select("name slug location createdAt accessStopped accessStoppedAt accessStoppedReason")
    .lean();

  if (!clinic) {
    const err = new Error("Clinic not found");
    err.status = 404;
    throw err;
  }
  return serializeClinicRow(clinic);
}

module.exports = { getSuperAdminDashboard, resolvePeriod, setClinicAccess };
