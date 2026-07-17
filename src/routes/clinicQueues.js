const express = require("express");
const Queue = require("../models/Queue");
const Doctor = require("../models/Doctor");
const {
  getClinicBySlug,
  getDoctorOrThrow,
  resetDoctorQueue,
  serializeDoctor,
} = require("../services/queueService");
const { generateQueueCode } = require("../models/Queue");
const { serializeQueue } = require("../services/queueLinkService");

const router = express.Router({ mergeParams: true });

async function ensureClinicQueue(clinic) {
  let queue = await Queue.findOne({ clinicId: clinic._id, scope: "clinic" });
  if (!queue) {
    queue = await Queue.create({
      code: generateQueueCode(),
      clinicId: clinic._id,
      scope: "clinic",
      doctorId: null,
      active: true,
    });
  }
  return queue;
}

async function ensureDoctorQueue(clinic, doctor) {
  let queue = await Queue.findOne({ clinicId: clinic._id, doctorId: doctor._id, scope: "doctor" });
  if (!queue) {
    queue = await Queue.create({
      code: generateQueueCode(),
      clinicId: clinic._id,
      doctorId: doctor._id,
      scope: "doctor",
      active: true,
    });
  }
  return queue;
}

/** List clinic + doctor queue links (staff QR screen). */
router.get("/", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctors = await Doctor.find({ clinicId: clinic._id, active: true }).sort({ key: 1 });

    const clinicQueueDoc = await ensureClinicQueue(clinic);
    const clinicQueue = serializeQueue(clinicQueueDoc, null, clinic);

    const items = [];
    for (const doctor of doctors) {
      const queue = await ensureDoctorQueue(clinic, doctor);
      items.push(serializeQueue(queue, doctor, clinic));
    }

    res.json({
      clinic: { id: String(clinic._id), slug: clinic.slug, name: clinic.name },
      clinicQueue,
      queues: items,
    });
  } catch (err) {
    next(err);
  }
});

/** Rotate the public clinic-wide QR code. */
router.post("/clinic/regenerate", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const queue = await ensureClinicQueue(clinic);
    queue.code = generateQueueCode();
    queue.active = true;
    await queue.save();
    res.json(serializeQueue(queue, null, clinic));
  } catch (err) {
    next(err);
  }
});

/** Clear waiting/serving tickets for every doctor in the clinic. */
router.post("/clinic/reset", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctors = await Doctor.find({ clinicId: clinic._id, active: true });
    const results = [];
    for (const doctor of doctors) {
      await resetDoctorQueue(doctor);
      results.push(await serializeDoctor(doctor));
    }
    res.json({ ok: true, doctors: results });
  } catch (err) {
    next(err);
  }
});

/** Rotate the public code for a doctor's queue (invalidates old QR). */
router.post("/:doctorId/regenerate", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    if (req.params.doctorId === "clinic") {
      return res.status(400).json({ error: "Use /queues/clinic/regenerate for clinic QR" });
    }
    let doctor;
    try {
      doctor = await Doctor.findOne({
        _id: req.params.doctorId,
        clinicId: clinic._id,
        active: true,
      });
    } catch {
      return res.status(400).json({ error: "Invalid doctor id" });
    }
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const queue = await ensureDoctorQueue(clinic, doctor);
    queue.code = generateQueueCode();
    queue.active = true;
    await queue.save();
    res.json(serializeQueue(queue, doctor, clinic));
  } catch (err) {
    next(err);
  }
});

/** Clear all waiting/serving tickets for a doctor's queue. */
router.post("/:doctorId/reset", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    await resetDoctorQueue(doctor);
    res.json(await serializeDoctor(doctor));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
