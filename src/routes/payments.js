const express = require("express");
const Clinic = require("../models/Clinic");
const { authRequired, requireRoles } = require("./auth");
const { getBillingState } = require("../services/subscriptionService");
const {
  paymentConfig,
  createPaypalOrder,
  capturePaypalOrder,
  createRazorpayOrder,
  verifyRazorpayPayment,
  listPayments,
} = require("../services/paymentService");

const router = express.Router();

function serializeClinic(clinic) {
  if (!clinic) return null;
  return {
    id: String(clinic._id),
    slug: clinic.slug,
    name: clinic.name,
    billing: getBillingState(clinic),
  };
}

router.get("/config", authRequired, (_req, res) => {
  res.json(paymentConfig());
});

router.get(
  "/",
  authRequired,
  requireRoles("admin", "receptionist", "doctor"),
  async (req, res, next) => {
    try {
      if (!req.auth.clinicId) {
        return res.status(400).json({ error: "No clinic on this account" });
      }
      const payments = await listPayments({
        clinicId: req.auth.clinicId,
        limit: req.query?.limit,
      });
      res.json({ payments });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);
router.post(
  "/paypal/create-order",
  authRequired,
  requireRoles("admin", "receptionist", "doctor"),
  async (req, res, next) => {
    try {
      if (!req.auth.clinicId) {
        return res.status(400).json({ error: "No clinic on this account" });
      }
      const data = await createPaypalOrder({
        clinicId: req.auth.clinicId,
        userId: req.auth.sub,
        planId: req.body?.planId,
        billing: req.body?.billing,
      });
      res.status(201).json(data);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.post(
  "/paypal/capture-order",
  authRequired,
  requireRoles("admin", "receptionist", "doctor"),
  async (req, res, next) => {
    try {
      const result = await capturePaypalOrder({
        clinicId: req.auth.clinicId,
        userId: req.auth.sub,
        orderId: req.body?.orderId,
      });
      res.json({
        ok: true,
        ...result,
        clinic: serializeClinic(result.clinic),
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.post(
  "/razorpay/create-order",
  authRequired,
  requireRoles("admin", "receptionist", "doctor"),
  async (req, res, next) => {
    try {
      if (!req.auth.clinicId) {
        return res.status(400).json({ error: "No clinic on this account" });
      }
      const data = await createRazorpayOrder({
        clinicId: req.auth.clinicId,
        userId: req.auth.sub,
        planId: req.body?.planId,
        billing: req.body?.billing,
      });
      res.status(201).json(data);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.post(
  "/razorpay/verify",
  authRequired,
  requireRoles("admin", "receptionist", "doctor"),
  async (req, res, next) => {
    try {
      const result = await verifyRazorpayPayment({
        clinicId: req.auth.clinicId,
        userId: req.auth.sub,
        paymentId: req.body?.paymentId,
        razorpay_order_id: req.body?.razorpay_order_id,
        razorpay_payment_id: req.body?.razorpay_payment_id,
        razorpay_signature: req.body?.razorpay_signature,
      });
      // Ensure clinic still exists
      await Clinic.findById(req.auth.clinicId);
      res.json({
        ok: true,
        ...result,
        clinic: serializeClinic(result.clinic),
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

module.exports = router;
