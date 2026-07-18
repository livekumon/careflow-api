const express = require("express");
const { getSuperAdminDashboard } = require("../services/superAdminService");
const { authRequired, requireRoles } = require("./auth");

const router = express.Router();

router.use(authRequired, requireRoles("superadmin"));

router.get("/dashboard", async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    const data = await getSuperAdminDashboard({ days });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
