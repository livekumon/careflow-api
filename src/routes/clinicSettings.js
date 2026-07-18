const express = require("express");
const Clinic = require("../models/Clinic");
const Doctor = require("../models/Doctor");
const { getClinicBySlug } = require("../services/queueService");
const { authRequired, requireRoles } = require("./auth");

const router = express.Router({ mergeParams: true });

const ALLOWED_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Australia/Sydney",
  "UTC",
];

function serializeSettings(clinic) {
  return {
    id: String(clinic._id),
    slug: clinic.slug,
    name: clinic.name,
    timezone: clinic.timezone || "Asia/Kolkata",
    checkInBeforeMin: clinic.checkInBeforeMin ?? 10,
    checkInAfterMin: clinic.checkInAfterMin ?? 15,
    allowedTimezones: ALLOWED_TIMEZONES,
  };
}

router.use(authRequired, requireRoles("admin"));

router.get("/", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    res.json({ clinic: serializeSettings(clinic) });
  } catch (err) {
    next(err);
  }
});

router.patch("/", async (req, res, next) => {
  try {
    const clinic = await Clinic.findOne({ slug: req.params.slug, active: true });
    if (!clinic) return res.status(404).json({ error: "Clinic not found" });

    if (req.body?.timezone != null) {
      const tz = String(req.body.timezone).trim();
      if (!ALLOWED_TIMEZONES.includes(tz)) {
        return res.status(400).json({ error: "Unsupported timezone" });
      }
      clinic.timezone = tz;
    }

    if (req.body?.checkInBeforeMin != null) {
      clinic.checkInBeforeMin = Math.min(120, Math.max(0, Number(req.body.checkInBeforeMin) || 0));
    }
    if (req.body?.checkInAfterMin != null) {
      clinic.checkInAfterMin = Math.min(120, Math.max(0, Number(req.body.checkInAfterMin) || 0));
    }

    await clinic.save();

    // Keep doctor check-in windows aligned with clinic defaults when hours are saved.
    if (req.body?.checkInBeforeMin != null || req.body?.checkInAfterMin != null) {
      await Doctor.updateMany(
        { clinicId: clinic._id },
        {
          $set: {
            checkInBeforeMin: clinic.checkInBeforeMin,
            checkInAfterMin: clinic.checkInAfterMin,
          },
        }
      );
    }

    res.json({ clinic: serializeSettings(clinic) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
