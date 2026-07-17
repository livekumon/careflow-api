const express = require("express");
const Rbac = require("../models/Rbac");
const { getClinicBySlug } = require("../services/queueService");
const { defaultRbac, serializeRbac } = require("../services/rbacService");

const router = express.Router({ mergeParams: true });

router.get("/", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    let rbac = await Rbac.findOne({ clinicId: clinic._id });
    if (!rbac) {
      const defaults = defaultRbac();
      rbac = await Rbac.create({
        clinicId: clinic._id,
        roles: defaults.roles,
        pages: defaults.pages,
        pageAccess: defaults.pageAccess,
        actions: defaults.actions,
      });
    }
    res.json({
      clinic: { id: String(clinic._id), slug: clinic.slug, name: clinic.name },
      rbac: serializeRbac(rbac),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const body = req.body || {};
    const update = {};
    if (Array.isArray(body.roles)) update.roles = body.roles;
    if (Array.isArray(body.pages)) update.pages = body.pages;
    if (body.pageAccess && typeof body.pageAccess === "object") update.pageAccess = body.pageAccess;
    if (Array.isArray(body.actions)) update.actions = body.actions;

    const rbac = await Rbac.findOneAndUpdate(
      { clinicId: clinic._id },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({
      clinic: { id: String(clinic._id), slug: clinic.slug, name: clinic.name },
      rbac: serializeRbac(rbac),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/reset", async (req, res, next) => {
  try {
    const clinic = await getClinicBySlug(req.params.slug);
    const defaults = defaultRbac();
    const rbac = await Rbac.findOneAndUpdate(
      { clinicId: clinic._id },
      {
        $set: {
          roles: defaults.roles,
          pages: defaults.pages,
          pageAccess: defaults.pageAccess,
          actions: defaults.actions,
        },
      },
      { new: true, upsert: true }
    );
    res.json({
      clinic: { id: String(clinic._id), slug: clinic.slug, name: clinic.name },
      rbac: serializeRbac(rbac),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
