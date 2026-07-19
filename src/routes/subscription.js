const express = require("express");
const Clinic = require("../models/Clinic");
const { authRequired, requireRoles } = require("./auth");
const {
  listPlans,
  getBillingState,
  activateSubscription,
} = require("../services/subscriptionService");

const router = express.Router();

function serializeClinic(clinic) {
  if (!clinic) return null;
  const billing = getBillingState(clinic);
  return {
    id: String(clinic._id),
    slug: clinic.slug,
    name: clinic.name,
    contactName: clinic.contactName || "",
    contactPhone: clinic.contactPhone || "",
    location: {
      address: clinic.location?.address || "",
      city: clinic.location?.city || "",
      state: clinic.location?.state || "",
      country: clinic.location?.country || "India",
    },
    timezone: clinic.timezone || "Asia/Kolkata",
    checkInBeforeMin: clinic.checkInBeforeMin ?? 10,
    checkInAfterMin: clinic.checkInAfterMin ?? 15,
    billing,
  };
}

router.get("/plans", (_req, res) => {
  res.json(listPlans());
});

router.get("/billing", authRequired, async (req, res, next) => {
  try {
    if (req.auth.role === "superadmin") {
      return res.json({ billing: { status: "active", needsPayment: false }, clinic: null });
    }
    const clinic = await Clinic.findById(req.auth.clinicId);
    if (!clinic?.active) {
      return res.status(404).json({ error: "Clinic not found" });
    }
    res.json({
      clinic: serializeClinic(clinic),
      billing: getBillingState(clinic),
      ...listPlans(),
    });
  } catch (err) {
    next(err);
  }
});

/** POC checkout — activates the selected plan without a payment processor. */
router.post(
  "/subscribe",
  authRequired,
  requireRoles("admin", "receptionist", "doctor"),
  async (req, res, next) => {
    try {
      if (req.auth.role === "superadmin") {
        return res.status(400).json({ error: "Super admin has no clinic subscription" });
      }
      const result = await activateSubscription(req.auth.clinicId, {
        planId: req.body?.planId,
        billing: req.body?.billing,
      });
      res.json({
        ok: true,
        clinic: serializeClinic(result.clinic),
        billing: result.billing,
        plan: result.plan,
        period: result.period,
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

module.exports = router;
module.exports.serializeClinicWithBilling = serializeClinic;
