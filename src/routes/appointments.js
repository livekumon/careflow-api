const express = require("express");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const {
  getClinicBySlug,
  maskPhone,
  avgFor,
  serializeDoctor,
  serializeTicket,
} = require("../services/queueService");
const {
  isSlotWithinSchedule,
  listOpenSlots,
  rangesOverlap,
  minutesToTime,
  timeToMinutes,
} = require("../services/appointmentService");
const {
  allocateDisplayToken,
  expireMissedAppointments,
  serializeAppointmentExtra,
  checkInAppointment,
  lateJoinAppointment,
} = require("../services/appointmentQueueService");
const { authRequired, requireRoles } = require("./auth");

const router = express.Router({ mergeParams: true });

function serializeAppointment(appt, doctor = null, now = new Date()) {
  const base = {
    id: String(appt._id),
    doctorId: String(appt.doctorId),
    doctor: doctor
      ? { id: String(doctor._id), name: doctor.name, specialty: doctor.specialty }
      : { id: String(appt.doctorId) },
    patientName: appt.patientName,
    phone: appt.phone,
    date: appt.date,
    startTime: appt.startTime,
    endTime: appt.endTime,
    notes: appt.notes || "",
    status: appt.status,
    createdByRole: appt.createdByRole,
    createdAt: appt.createdAt,
  };
  if (doctor) {
    return { ...base, ...serializeAppointmentExtra(appt, doctor, now) };
  }
  return {
    ...base,
    queueNumber: appt.queueNumber,
    durationMin: appt.durationMin,
    orderKey: appt.orderKey,
    ticketId: appt.ticketId ? String(appt.ticketId) : null,
  };
}

router.use(authRequired, requireRoles("receptionist", "admin", "doctor"));

/** List appointments for a date (default today). Doctors only see their own. */
router.get("/", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const date =
      String(req.query.date || "").trim() ||
      new Date().toISOString().slice(0, 10);
    const filter = { clinicId: clinic._id, date };
    if (req.auth.role === "doctor" && req.auth.doctorId) {
      filter.doctorId = req.auth.doctorId;
    } else if (req.query.doctorId) {
      filter.doctorId = req.query.doctorId;
    }

    const doctors = await Doctor.find({ clinicId: clinic._id });
    const byId = new Map(doctors.map((d) => [String(d._id), d]));

    // Expire missed windows for relevant doctors
    const doctorIds = filter.doctorId
      ? [String(filter.doctorId)]
      : doctors.map((d) => String(d._id));
    for (const id of doctorIds) {
      const doc = byId.get(id);
      if (doc) await expireMissedAppointments(clinic._id, doc._id, date, doc);
    }

    const appts = await Appointment.find(filter).sort({ startTime: 1 }).lean();

    res.json({
      date,
      appointments: appts.map((a) => serializeAppointment(a, byId.get(String(a.doctorId)))),
    });
  } catch (err) {
    next(err);
  }
});

/** Open slots for a doctor on a date. */
router.get("/slots", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctorId = String(req.query.doctorId || req.auth.doctorId || "").trim();
    const date = String(req.query.date || "").trim();
    const duration = Math.min(60, Math.max(10, Number(req.query.duration) || 15));

    if (!doctorId || !date) {
      return res.status(400).json({ error: "doctorId and date are required" });
    }
    if (req.auth.role === "doctor" && req.auth.doctorId !== doctorId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const doctor = await Doctor.findOne({ _id: doctorId, clinicId: clinic._id, active: true });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    if (doctor.available === false) {
      return res.json({
        date,
        doctorId,
        slots: [],
        unavailable: true,
        reason: doctor.unavailableReason || "Doctor is not available",
      });
    }

    const booked = await Appointment.find({
      clinicId: clinic._id,
      doctorId: doctor._id,
      date,
      status: { $in: ["booked", "arrived"] },
    }).lean();

    const open = listOpenSlots(doctor, date, duration).filter((start) => {
      const end = minutesToTime(timeToMinutes(start) + duration);
      return !booked.some((a) => rangesOverlap(start, end, a.startTime, a.endTime));
    });

    res.json({ date, doctorId, duration, slots: open, unavailable: false });
  } catch (err) {
    next(err);
  }
});

/** Book appointment — assigns avg duration + stable queue number. */
router.post("/", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const patientName = String(req.body?.patientName || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    const date = String(req.body?.date || "").trim();
    const startTime = String(req.body?.startTime || "").trim().slice(0, 5);
    const notes = String(req.body?.notes || "").trim();
    let doctorId = String(req.body?.doctorId || "").trim();

    if (req.auth.role === "doctor") {
      doctorId = req.auth.doctorId;
    }

    if (!patientName || !phoneRaw || !doctorId || !date || !startTime) {
      return res.status(400).json({
        error: "Patient name, phone, doctor, date, and start time are required",
      });
    }

    const doctor = await Doctor.findOne({ _id: doctorId, clinicId: clinic._id, active: true });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    if (doctor.available === false) {
      return res.status(403).json({
        error: doctor.unavailableReason || "Doctor is not available",
        code: "DOCTOR_UNAVAILABLE",
      });
    }

    const duration = Math.min(
      60,
      Math.max(10, Number(req.body?.duration) || avgFor(doctor.consultHistory) || 15)
    );
    const endTime = minutesToTime(timeToMinutes(startTime) + duration);
    if (!isSlotWithinSchedule(doctor, date, startTime, endTime)) {
      return res.status(400).json({
        error: "Selected time is outside this doctor's consultation hours",
        code: "OUTSIDE_SCHEDULE",
      });
    }

    const conflicts = await Appointment.find({
      clinicId: clinic._id,
      doctorId: doctor._id,
      date,
      status: { $in: ["booked", "arrived"] },
    }).lean();

    if (conflicts.some((a) => rangesOverlap(startTime, endTime, a.startTime, a.endTime))) {
      return res.status(409).json({ error: "That time slot is already booked" });
    }

    const queueNumber = await allocateDisplayToken(doctor, date);
    const orderKey = timeToMinutes(startTime);

    const appt = await Appointment.create({
      clinicId: clinic._id,
      doctorId: doctor._id,
      patientName,
      phone: maskPhone(phoneRaw),
      date,
      startTime,
      endTime,
      durationMin: duration,
      queueNumber,
      orderKey,
      notes,
      status: "booked",
      createdByRole: req.auth.role,
      createdByUserId: req.auth.sub,
    });

    res.status(201).json({ appointment: serializeAppointment(appt.toObject(), doctor) });
  } catch (err) {
    next(err);
  }
});

/** Check in within window → join queue with reserved queue number. */
router.post("/:appointmentId/check-in", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const appt = await Appointment.findOne({
      _id: req.params.appointmentId,
      clinicId: clinic._id,
    });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (req.auth.role === "doctor" && String(appt.doctorId) !== req.auth.doctorId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const doctor = await Doctor.findById(appt.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    try {
      const { ticket } = await checkInAppointment(doctor, appt, { clinicId: clinic._id });
      const avg = avgFor(doctor.consultHistory);
      const doctorState = await serializeDoctor(doctor);
      const rank = doctorState.queue.findIndex((t) => t.id === String(ticket._id));
      res.json({
        appointment: serializeAppointment((await Appointment.findById(appt._id)).toObject(), doctor),
        ticket: serializeTicket(ticket.toObject(), rank >= 0 ? rank : null, avg),
        doctor: doctorState,
      });
    } catch (err) {
      if (err.code === "LATE_CHECKIN") {
        return res.status(409).json({
          error: err.message,
          code: err.code,
          appointment: serializeAppointment(
            (await Appointment.findById(appt._id)).toObject(),
            doctor
          ),
        });
      }
      return res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Late join after missed window.
 * body: { placement: 'end' | 'insert', afterTicketId? }
 */
router.post("/:appointmentId/late-join", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const appt = await Appointment.findOne({
      _id: req.params.appointmentId,
      clinicId: clinic._id,
    });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (req.auth.role === "doctor" && String(appt.doctorId) !== req.auth.doctorId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const doctor = await Doctor.findById(appt.doctorId);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const placement = req.body?.placement === "insert" ? "insert" : "end";
    const afterTicketId = req.body?.afterTicketId || null;

    try {
      const { ticket } = await lateJoinAppointment(doctor, appt, {
        placement,
        afterTicketId,
        clinicId: clinic._id,
      });
      const avg = avgFor(doctor.consultHistory);
      const doctorState = await serializeDoctor(doctor);
      const rank = doctorState.queue.findIndex((t) => t.id === String(ticket._id));
      res.json({
        appointment: serializeAppointment((await Appointment.findById(appt._id)).toObject(), doctor),
        ticket: serializeTicket(ticket.toObject(), rank >= 0 ? rank : null, avg),
        doctor: doctorState,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  } catch (err) {
    next(err);
  }
});

/** Cancel / complete / legacy status patch. Arrived → use check-in. */
router.patch("/:appointmentId", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const appt = await Appointment.findOne({
      _id: req.params.appointmentId,
      clinicId: clinic._id,
    });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    if (req.auth.role === "doctor" && String(appt.doctorId) !== req.auth.doctorId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const doctor = await Doctor.findById(appt.doctorId);
    const status = String(req.body?.status || "").trim();

    if (status === "arrived") {
      try {
        await checkInAppointment(doctor, appt, { clinicId: clinic._id });
      } catch (err) {
        return res.status(err.status || 500).json({
          error: err.message,
          code: err.code,
          appointment: serializeAppointment(
            (await Appointment.findById(appt._id)).toObject(),
            doctor
          ),
        });
      }
      return res.json({
        appointment: serializeAppointment((await Appointment.findById(appt._id)).toObject(), doctor),
        doctor: await serializeDoctor(doctor),
      });
    }

    if (status && ["booked", "cancelled", "completed", "noshow"].includes(status)) {
      appt.status = status;
    }
    if (req.body?.notes != null) appt.notes = String(req.body.notes).trim();
    await appt.save();

    res.json({ appointment: serializeAppointment(appt.toObject(), doctor) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
