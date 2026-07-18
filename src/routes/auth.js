const express = require("express");
const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Clinic = require("../models/Clinic");
const {
  verifyPassword,
  issueToken,
  verifyToken,
  serializeUser,
} = require("../services/authService");
const { registerClinicTenant, findClinicByName } = require("../services/tenantService");

const router = express.Router();

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Please sign in" });
  req.auth = payload;
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Not allowed for this role" });
    }
    next();
  };
}

function serializeClinic(clinic) {
  if (!clinic) return null;
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
  };
}

/** Register a new clinic tenant + admin account. */
router.post("/register", async (req, res, next) => {
  try {
    const { clinic, user } = await registerClinicTenant({
      clinicName: req.body?.clinicName,
      contactName: req.body?.name || req.body?.contactName,
      contactPhone: req.body?.contactNumber || req.body?.contactPhone || req.body?.phone,
      email: req.body?.email,
      password: req.body?.password,
      location: req.body?.location,
      address: req.body?.address,
      city: req.body?.city,
      state: req.body?.state,
      country: req.body?.country,
    });

    const token = issueToken(user);
    res.status(201).json({
      token,
      user: serializeUser(user),
      clinic: serializeClinic(clinic),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Clinic or email already registered" });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const clinicName = String(req.body?.clinicName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const asSuperAdmin = Boolean(req.body?.superAdmin);

    if (!email || !password) {
      return res.status(400).json({
        error: asSuperAdmin
          ? "Email and password are required"
          : "Clinic name, email, and password are required",
      });
    }

    if (asSuperAdmin) {
      const user = await User.findOne({
        email,
        role: "superadmin",
        active: true,
      });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "Invalid super admin credentials" });
      }
      const token = issueToken(user);
      return res.json({
        token,
        user: serializeUser(user),
        clinic: null,
      });
    }

    if (!clinicName) {
      return res.status(400).json({
        error: "Clinic name, email, and password are required",
      });
    }

    const clinic = await findClinicByName(clinicName);
    if (!clinic) {
      return res.status(401).json({ error: "Clinic not found. Check the clinic name." });
    }

    const user = await User.findOne({
      clinicId: clinic._id,
      email,
      active: true,
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password for this clinic" });
    }

    let doctor = null;
    if (user.doctorId) {
      doctor = await Doctor.findById(user.doctorId).lean();
    }

    const token = issueToken(user);
    res.json({
      token,
      user: serializeUser(user, doctor),
      clinic: serializeClinic(clinic),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authRequired, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.sub);
    if (!user?.active) return res.status(401).json({ error: "Session expired" });

    if (user.role === "superadmin") {
      return res.json({
        user: serializeUser(user),
        clinic: null,
      });
    }

    const clinic = await Clinic.findById(user.clinicId).lean();
    let doctor = null;
    if (user.doctorId) doctor = await Doctor.findById(user.doctorId).lean();
    res.json({
      user: serializeUser(user, doctor),
      clinic: serializeClinic(clinic),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.authRequired = authRequired;
module.exports.requireRoles = requireRoles;
