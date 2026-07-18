const Clinic = require("../models/Clinic");
const Doctor = require("../models/Doctor");
const Ticket = require("../models/Ticket");
const Appointment = require("../models/Appointment");
const { getZonedParts, DEFAULT_TIMEZONE } = require("./timezoneService");

function addDaysIso(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lastNDays(n, timeZone = DEFAULT_TIMEZONE) {
  const today = getZonedParts(new Date(), timeZone).dateStr;
  const days = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    days.push(addDaysIso(today, -i));
  }
  return days;
}

function fillSeries(days, rows) {
  const map = new Map(rows.map((r) => [r._id, r.count]));
  return days.map((date) => ({ date, count: map.get(date) || 0 }));
}

async function countByDay(Model, dateField, since, timeZone = DEFAULT_TIMEZONE) {
  return Model.aggregate([
    { $match: { [dateField]: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: `$${dateField}`,
            timezone: timeZone,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

async function getSuperAdminDashboard({ days: dayCount = 30 } = {}) {
  const timeZone = DEFAULT_TIMEZONE;
  const days = lastNDays(dayCount, timeZone);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (dayCount + 2));
  since.setUTCHours(0, 0, 0, 0);

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
    Clinic.countDocuments({ active: true }),
    Doctor.countDocuments({ active: true }),
    Appointment.countDocuments({}),
    Ticket.countDocuments({ status: "done" }),
    countByDay(Clinic, "createdAt", since, timeZone),
    countByDay(Doctor, "createdAt", since, timeZone),
    Ticket.aggregate([
      {
        $match: {
          status: "done",
          $or: [
            { completedAt: { $gte: since } },
            { completedAt: null, updatedAt: { $gte: since } },
          ],
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: { $ifNull: ["$completedAt", "$updatedAt"] },
              timezone: timeZone,
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Clinic.find({ active: true })
      .select("name slug location createdAt")
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
    totals: {
      clinics: clinicsTotal,
      doctors: doctorsTotal,
      appointments: appointmentsTotal,
      patientsServed,
    },
    trends: {
      days: dayCount,
      clinics: fillSeries(days, clinicTrendRows),
      doctors: fillSeries(days, doctorTrendRows),
      patientsServed: fillSeries(days, servedTrendRows),
    },
    locations,
    clinics: clinics.map((c) => ({
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
    })),
    timeZone,
  };
}

module.exports = { getSuperAdminDashboard };
