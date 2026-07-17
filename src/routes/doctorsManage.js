const express = require("express");
const Doctor = require("../models/Doctor");
const Queue = require("../models/Queue");
const User = require("../models/User");
const { getClinicBySlug, serializeDoctor } = require("../services/queueService");
const { generateQueueCode } = require("../models/Queue");
const { defaultScheduleSets, normalizeScheduleSets } = require("../services/scheduleService");
const { hashPassword } = require("../services/authService");
const { authRequired, requireRoles } = require("./auth");

const router = express.Router({ mergeParams: true });

function serializeManagedDoctor(doctor) {
  const { getDoctorAvailability } = require("../services/availabilityService");
  const availability = getDoctorAvailability(doctor);
  return {
    id: String(doctor._id),
    key: doctor.key,
    name: doctor.name,
    specialty: doctor.specialty,
    active: doctor.active,
    schedule: normalizeScheduleSets(doctor.schedule),
    doneCount: doctor.doneCount || 0,
    available: availability.available,
    unavailableReason: doctor.unavailableReason || "",
    queueExtended: availability.queueExtended,
    withinHours: availability.withinHours,
    canJoin: availability.canJoin,
    availabilityStatus: availability.status,
    availabilityReason: availability.reason,
    checkInBeforeMin: doctor.checkInBeforeMin ?? 10,
    checkInAfterMin: doctor.checkInAfterMin ?? 15,
  };
}

/** List doctors with schedules (receptionist / admin). */
router.get("/", authRequired, requireRoles("receptionist", "admin"), async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctors = await Doctor.find({ clinicId: clinic._id }).sort({ key: 1 }).lean();
    res.json({
      clinic: { id: String(clinic._id), slug: clinic.slug, name: clinic.name },
      doctors: doctors.map(serializeManagedDoctor),
    });
  } catch (err) {
    next(err);
  }
});

/** Create a doctor + optional login + queue QR. */
router.post("/", authRequired, requireRoles("receptionist", "admin"), async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const name = String(req.body?.name || "").trim();
    const specialty = String(req.body?.specialty || "").trim();
    let key = String(req.body?.key || "").trim().toUpperCase();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "doctor123");

    if (!name || !specialty) {
      return res.status(400).json({ error: "Name and specialty are required" });
    }

    if (!key) {
      const count = await Doctor.countDocuments({ clinicId: clinic._id });
      key = String.fromCharCode(65 + (count % 26));
      // ensure unique key
      let n = count;
      while (await Doctor.findOne({ clinicId: clinic._id, key })) {
        n += 1;
        key = `D${n}`;
      }
    }

    const schedule = normalizeScheduleSets(req.body?.schedule || defaultScheduleSets());
    const doctor = await Doctor.create({
      clinicId: clinic._id,
      key,
      name,
      specialty,
      schedule,
      consultHistory: [10, 10, 10, 10, 10],
      active: true,
    });

    await Queue.create({
      code: generateQueueCode(),
      clinicId: clinic._id,
      doctorId: doctor._id,
      scope: "doctor",
      active: true,
    });

    if (email) {
      const existing = await User.findOne({ clinicId: clinic._id, email });
      if (existing) {
        return res.status(400).json({ error: "A user with this email already exists" });
      }
      await User.create({
        clinicId: clinic._id,
        email,
        passwordHash: hashPassword(password),
        name,
        role: "doctor",
        doctorId: doctor._id,
        active: true,
      });
    }

    res.status(201).json({ doctor: serializeManagedDoctor(doctor) });
  } catch (err) {
    next(err);
  }
});

/** Update doctor profile / schedule. */
router.patch("/:doctorId", authRequired, requireRoles("receptionist", "admin"), async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await Doctor.findOne({ _id: req.params.doctorId, clinicId: clinic._id });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    if (req.body?.name != null) doctor.name = String(req.body.name).trim() || doctor.name;
    if (req.body?.specialty != null) {
      doctor.specialty = String(req.body.specialty).trim() || doctor.specialty;
    }
    if (req.body?.active != null) doctor.active = Boolean(req.body.active);
    if (req.body?.schedule != null) doctor.schedule = normalizeScheduleSets(req.body.schedule);

    if (req.body?.available === true) {
      doctor.available = true;
      doctor.unavailableReason = "";
    } else if (req.body?.available === false) {
      const reason = String(req.body?.unavailableReason || "").trim();
      if (!reason) {
        return res.status(400).json({ error: "Please provide a reason why the doctor is unavailable" });
      }
      doctor.available = false;
      doctor.unavailableReason = reason;
    }

    if (req.body?.queueExtended != null) {
      doctor.queueExtended = Boolean(req.body.queueExtended);
    }

    if (req.body?.checkInBeforeMin != null) {
      doctor.checkInBeforeMin = Math.min(120, Math.max(0, Number(req.body.checkInBeforeMin) || 0));
    }
    if (req.body?.checkInAfterMin != null) {
      doctor.checkInAfterMin = Math.min(120, Math.max(0, Number(req.body.checkInAfterMin) || 0));
    }

    await doctor.save();
    res.json({ doctor: serializeManagedDoctor(doctor) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
