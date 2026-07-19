const express = require("express");
const {
  getSuperAdminDashboard,
  setClinicAccess,
} = require("../services/superAdminService");
const { authRequired, requireRoles } = require("./auth");

const router = express.Router();

router.use(authRequired, requireRoles("superadmin"));

router.get("/dashboard", async (req, res, next) => {
  try {
    const range = String(req.query.range || "month").toLowerCase();
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const data = await getSuperAdminDashboard({ range, from, to });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/** Soft stop / restore clinic access (admin archive or payment expiry). */
router.patch("/clinics/:clinicId/access", async (req, res, next) => {
  try {
    const clinic = await setClinicAccess({
      clinicId: req.params.clinicId,
      accessStopped: req.body?.accessStopped,
      reason: req.body?.reason,
    });
    res.json({ clinic });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

module.exports = router;
