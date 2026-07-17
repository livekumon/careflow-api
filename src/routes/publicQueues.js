const express = require("express");
const Queue = require("../models/Queue");
const Doctor = require("../models/Doctor");
const Clinic = require("../models/Clinic");
const Ticket = require("../models/Ticket");
const {
  serializeTicket,
  avgFor,
  maskPhone,
  waitingTickets,
} = require("../services/queueService");
const { serializeQueue } = require("../services/queueLinkService");

const router = express.Router();

async function serializeDoctorPublic(doctor) {
  const waiting = await waitingTickets(doctor._id);
  return {
    id: String(doctor._id),
    name: doctor.name,
    specialty: doctor.specialty,
    key: doctor.key,
    waitingCount: waiting.length,
    avgMinutes: avgFor(doctor.consultHistory),
  };
}

async function resolveQueueOrThrow(code) {
  const queue = await Queue.findOne({ code, active: true });
  if (!queue) {
    const err = new Error("Queue not found or inactive");
    err.status = 404;
    throw err;
  }

  const clinic = await Clinic.findById(queue.clinicId);
  if (!clinic?.active) {
    const err = new Error("Queue clinic is inactive");
    err.status = 404;
    throw err;
  }

  const scope = queue.scope || (queue.doctorId ? "doctor" : "clinic");

  if (scope === "clinic") {
    const doctors = await Doctor.find({ clinicId: clinic._id, active: true }).sort({ key: 1 });
    return { queue, clinic, doctor: null, doctors, scope: "clinic" };
  }

  const doctor = await Doctor.findById(queue.doctorId);
  if (!doctor?.active) {
    const err = new Error("Queue doctor is inactive");
    err.status = 404;
    throw err;
  }
  return { queue, clinic, doctor, doctors: [doctor], scope: "doctor" };
}

async function resolveTicketDoctor(queueCtx, ticket) {
  if (queueCtx.scope === "doctor") {
    if (String(ticket.doctorId) !== String(queueCtx.doctor._id)) return null;
    return queueCtx.doctor;
  }
  const doctor = await Doctor.findOne({
    _id: ticket.doctorId,
    clinicId: queueCtx.clinic._id,
    active: true,
  });
  return doctor;
}

/** Public: resolve QR code → clinic (+ doctor or doctor list). */
router.get("/:code", async (req, res, next) => {
  try {
    const ctx = await resolveQueueOrThrow(req.params.code);
    const { queue, clinic, doctor, doctors, scope } = ctx;

    if (scope === "clinic") {
      const doctorList = await Promise.all(doctors.map(serializeDoctorPublic));
      const waitingCount = doctorList.reduce((sum, d) => sum + d.waitingCount, 0);
      return res.json({
        ...serializeQueue(queue, null, clinic),
        doctors: doctorList,
        waitingCount,
        avgMinutes: doctorList.length
          ? Math.round(doctorList.reduce((s, d) => s + d.avgMinutes, 0) / doctorList.length)
          : 10,
      });
    }

    const waiting = await waitingTickets(doctor._id);
    res.json({
      ...serializeQueue(queue, doctor, clinic),
      waitingCount: waiting.length,
      avgMinutes: avgFor(doctor.consultHistory),
    });
  } catch (err) {
    next(err);
  }
});

/** Public: patient check-in via queue code. Clinic QR requires doctorId. */
router.post("/:code/checkin", async (req, res, next) => {
  try {
    const ctx = await resolveQueueOrThrow(req.params.code);
    const { queue, clinic, scope } = ctx;
    const name = String(req.body?.name || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });

    let doctor = ctx.doctor;
    if (scope === "clinic") {
      const doctorId = String(req.body?.doctorId || "").trim();
      if (!doctorId) return res.status(400).json({ error: "Please select a doctor" });
      doctor = await Doctor.findOne({ _id: doctorId, clinicId: clinic._id, active: true });
      if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    }

    const waiting = await waitingTickets(doctor._id);
    const ticket = await Ticket.create({
      clinicId: clinic._id,
      doctorId: doctor._id,
      name,
      phone: phoneRaw ? maskPhone(phoneRaw) : "—",
      status: "waiting",
      source: "qr",
      positionAtJoin: waiting.length + 1,
    });

    const avg = avgFor(doctor.consultHistory);
    res.status(201).json({
      queue: serializeQueue(queue, doctor, clinic),
      ticket: serializeTicket(ticket.toObject(), waiting.length, avg),
      doctor: {
        id: String(doctor._id),
        name: doctor.name,
        specialty: doctor.specialty,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:code/tickets/:ticketId", async (req, res, next) => {
  try {
    const ctx = await resolveQueueOrThrow(req.params.code);
    const { queue, clinic } = ctx;

    const ticketQuery = { _id: req.params.ticketId, clinicId: clinic._id };
    if (ctx.scope === "doctor") ticketQuery.doctorId = ctx.doctor._id;

    const ticket = await Ticket.findOne(ticketQuery).lean();
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const doctor = await resolveTicketDoctor(ctx, ticket);
    if (!doctor) return res.status(404).json({ error: "Ticket not found" });

    const avg = avgFor(doctor.consultHistory);
    const doctorInfo = { id: String(doctor._id), name: doctor.name, specialty: doctor.specialty };
    const queuePayload = serializeQueue(queue, doctor, clinic);

    if (ticket.status === "serving" && String(doctor.servingTicketId) === String(ticket._id)) {
      return res.json({
        queue: queuePayload,
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
        queue: queuePayload,
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
      queue: queuePayload,
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

router.post("/:code/tickets/:ticketId/cancel", async (req, res, next) => {
  try {
    const ctx = await resolveQueueOrThrow(req.params.code);
    const { clinic } = ctx;

    const ticketQuery = { _id: req.params.ticketId, clinicId: clinic._id };
    if (ctx.scope === "doctor") ticketQuery.doctorId = ctx.doctor._id;

    const ticket = await Ticket.findOne(ticketQuery);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const doctor = await resolveTicketDoctor(ctx, ticket);
    if (!doctor) return res.status(404).json({ error: "Ticket not found" });

    if (ticket.status !== "waiting") {
      return res.status(400).json({ error: "Only waiting tickets can be cancelled" });
    }
    ticket.status = "cancelled";
    await ticket.save();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
