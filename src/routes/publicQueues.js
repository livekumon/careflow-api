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

async function serializeDoctorPublic(doctor, clinic) {
  const { getDoctorAvailability } = require("../services/availabilityService");
  const waiting = await waitingTickets(doctor._id);
  const availability = getDoctorAvailability(doctor, new Date(), clinic);
  return {
    id: String(doctor._id),
    name: doctor.name,
    specialty: doctor.specialty,
    key: doctor.key,
    waitingCount: waiting.length,
    avgMinutes: avgFor(doctor.consultHistory),
    available: availability.available,
    canJoin: availability.canJoin,
    availabilityStatus: availability.status,
    unavailableReason: availability.status === "unavailable" ? availability.reason : "",
    availabilityReason: availability.reason,
    withinHours: availability.withinHours,
    queueExtended: availability.queueExtended,
    timeZone: availability.timeZone,
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
      const doctorList = await Promise.all(doctors.map((d) => serializeDoctorPublic(d, clinic)));
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
    const publicDoctor = await serializeDoctorPublic(doctor, clinic);
    res.json({
      ...serializeQueue(queue, doctor, clinic),
      waitingCount: waiting.length,
      avgMinutes: avgFor(doctor.consultHistory),
      available: publicDoctor.available,
      canJoin: publicDoctor.canJoin,
      availabilityStatus: publicDoctor.availabilityStatus,
      unavailableReason: publicDoctor.unavailableReason,
      availabilityReason: publicDoctor.availabilityReason,
      withinHours: publicDoctor.withinHours,
      queueExtended: publicDoctor.queueExtended,
    });
  } catch (err) {
    next(err);
  }
});

/** Public: patient check-in via queue code. Clinic QR requires doctorId. */
router.post("/:code/checkin", async (req, res, next) => {
  try {
    const { assertCanJoinQueue } = require("../services/availabilityService");
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

    try {
      assertCanJoinQueue(doctor, { timeZone: clinic });
    } catch (err) {
      return res.status(err.status || 403).json({
        error: err.message,
        code: err.code,
        availability: err.availability,
      });
    }

    const avg = avgFor(doctor.consultHistory);
    const doctorPayload = {
      id: String(doctor._id),
      name: doctor.name,
      specialty: doctor.specialty,
    };

    // Collapse rapid duplicate check-ins (double-tap / flaky network retry)
    const phoneStored = phoneRaw || "—";
    const recentCutoff = new Date(Date.now() - 45_000);
    const existing = await Ticket.findOne({
      doctorId: doctor._id,
      clinicId: clinic._id,
      name,
      phone: phoneStored,
      status: { $in: ["waiting", "serving"] },
      createdAt: { $gte: recentCutoff },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existing) {
      const waiting = await waitingTickets(doctor._id);
      const rankIndex = waiting.findIndex((t) => String(t._id) === String(existing._id));
      return res.status(200).json({
        queue: serializeQueue(queue, doctor, clinic),
        ticket: {
          ...serializeTicket(existing, rankIndex >= 0 ? rankIndex : null, avg),
          phone: maskPhone(existing.phone),
        },
        doctor: doctorPayload,
        reused: true,
      });
    }

    const { createWalkInTicket } = require("../services/appointmentQueueService");
    const { ticket, rankIndex } = await createWalkInTicket(doctor, {
      clinicId: clinic._id,
      name,
      phone: phoneRaw,
      source: "qr",
    });

    const serialized = serializeTicket(ticket.toObject(), rankIndex, avg);
    res.status(201).json({
      queue: serializeQueue(queue, doctor, clinic),
      ticket: { ...serialized, phone: maskPhone(serialized.phone) },
      doctor: doctorPayload,
    });
  } catch (err) {
    next(err);
  }
});

async function nowServingInfo(doctor) {
  if (!doctor?.servingTicketId) return null;
  const serving = await Ticket.findById(doctor.servingTicketId).lean();
  if (!serving) return null;
  const token =
    serving.displayToken != null
      ? serving.displayToken
      : serving.positionAtJoin != null
        ? serving.positionAtJoin
        : null;
  return {
    ticketId: String(serving._id),
    displayToken: token,
    name: serving.name || "",
  };
}

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
    const nowServing = await nowServingInfo(doctor);

    if (ticket.status === "serving" && String(doctor.servingTicketId) === String(ticket._id)) {
      const serialized = serializeTicket(ticket, null, avg);
      return res.json({
        queue: queuePayload,
        ticket: {
          ...serialized,
          waitMinutes: 0,
          beingSeen: true,
          completed: false,
        },
        nowServing,
        doctor: doctorInfo,
      });
    }

    if (ticket.status === "waiting") {
      const waiting = await waitingTickets(doctor._id);
      const idx = waiting.findIndex((t) => String(t._id) === String(ticket._id));
      const serialized = serializeTicket(ticket, idx >= 0 ? idx : null, avg);
      return res.json({
        queue: queuePayload,
        ticket: {
          ...serialized,
          // Keep stable display token as position; ahead/waitMinutes reflect live order.
          beingSeen: false,
          completed: false,
          ahead: idx >= 0 ? idx : serialized.ahead,
        },
        nowServing,
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
        displayToken: ticket.displayToken ?? ticket.positionAtJoin ?? null,
        beingSeen: false,
        completed: ["done", "cancelled", "noshow"].includes(ticket.status),
      },
      nowServing,
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
