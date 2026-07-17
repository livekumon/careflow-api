const express = require("express");
const Doctor = require("../models/Doctor");
const { serializeDoctor, getClinicBySlug } = require("../services/queueService");
const Clinic = require("../models/Clinic");

const router = express.Router();

router.get("/", async (_req, res, next) => {
  try {
    const clinics = await Clinic.find({ active: true }).sort({ name: 1 }).lean();
    res.json(
      clinics.map((c) => ({
        id: String(c._id),
        slug: c.slug,
        name: c.name,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    res.json({
      id: String(clinic._id),
      slug: clinic.slug,
      name: clinic.name,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:slug/doctors", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctors = await Doctor.find({ clinicId: clinic._id, active: true }).sort({ key: 1 });
    const payload = await Promise.all(doctors.map(serializeDoctor));
    res.json({
      clinic: { id: String(clinic._id), slug: clinic.slug, name: clinic.name },
      doctors: payload,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
