const express = require("express");
const Ticket = require("../models/Ticket");
const {
  serializeDoctor,
  serializeTicket,
  advanceQueue,
  getDoctorOrThrow,
  getClinicBySlug,
  avgFor,
  maskPhone,
  waitingTickets,
} = require("../services/queueService");

const router = express.Router({ mergeParams: true });

router.get("/:doctorId", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    res.json(await serializeDoctor(doctor));
  } catch (err) {
    next(err);
  }
});

router.post("/:doctorId/advance", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    await advanceQueue(doctor);
    res.json(await serializeDoctor(doctor));
  } catch (err) {
    next(err);
  }
});

router.post("/:doctorId/tickets", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    const name = String(req.body?.name || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    const source = ["manual", "qr", "self"].includes(req.body?.source) ? req.body.source : "manual";
    if (!name) return res.status(400).json({ error: "Name is required" });

    const waiting = await waitingTickets(doctor._id);
    const ticket = await Ticket.create({
      clinicId: clinic._id,
      doctorId: doctor._id,
      name,
      phone: phoneRaw ? maskPhone(phoneRaw) : "—",
      status: "waiting",
      source,
      positionAtJoin: waiting.length + 1,
    });

    const avg = avgFor(doctor.consultHistory);
    res.status(201).json({
      ticket: serializeTicket(ticket.toObject(), waiting.length, avg),
      doctor: await serializeDoctor(doctor),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:doctorId/noshow", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    const nextWaiting = await Ticket.findOne({ doctorId: doctor._id, status: "waiting" }).sort({
      createdAt: 1,
    });
    if (!nextWaiting) return res.status(400).json({ error: "Queue is empty" });
    nextWaiting.status = "noshow";
    await nextWaiting.save();
    res.json(await serializeDoctor(doctor));
  } catch (err) {
    next(err);
  }
});

router.get("/:doctorId/tickets/:ticketId", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    const ticket = await Ticket.findOne({
      _id: req.params.ticketId,
      doctorId: doctor._id,
      clinicId: clinic._id,
    }).lean();
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const avg = avgFor(doctor.consultHistory);
    const doctorInfo = { id: String(doctor._id), name: doctor.name, specialty: doctor.specialty };

    if (ticket.status === "serving" && String(doctor.servingTicketId) === String(ticket._id)) {
      return res.json({
        ticket: {
          ...serializeTicket(ticket, null, avg),
          position: 0,
          waitMinutes: 0,
          beingSeen: true,
          completed: false,
        },
        doctor: doctorInfo,
      });
    }

    if (ticket.status === "waiting") {
      const waiting = await waitingTickets(doctor._id);
      const idx = waiting.findIndex((t) => String(t._id) === String(ticket._id));
      return res.json({
        ticket: {
          ...serializeTicket(ticket, idx, avg),
          beingSeen: false,
          completed: false,
          ahead: idx,
        },
        doctor: doctorInfo,
        queueDots: waiting.map((t) => String(t._id)),
      });
    }

    res.json({
      ticket: {
        id: String(ticket._id),
        name: ticket.name,
        status: ticket.status,
        beingSeen: false,
        completed: ["done", "cancelled", "noshow"].includes(ticket.status),
      },
      doctor: doctorInfo,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:doctorId/tickets/:ticketId/cancel", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const doctor = await getDoctorOrThrow(clinic._id, req.params.doctorId);
    const ticket = await Ticket.findOne({
      _id: req.params.ticketId,
      doctorId: doctor._id,
      clinicId: clinic._id,
    });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status !== "waiting") {
      return res.status(400).json({ error: "Only waiting tickets can be cancelled" });
    }
    ticket.status = "cancelled";
    await ticket.save();
    res.json({ ok: true, doctor: await serializeDoctor(doctor) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
