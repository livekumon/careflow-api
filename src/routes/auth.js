const express = require("express");
const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Clinic = require("../models/Clinic");
const {
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  serializeUser,
} = require("../services/authService");

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

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email, active: true });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const clinic = await Clinic.findById(user.clinicId).lean();
    let doctor = null;
    if (user.doctorId) {
      doctor = await Doctor.findById(user.doctorId).lean();
    }

    const token = issueToken(user);
    res.json({
      token,
      user: serializeUser(user, doctor),
      clinic: clinic
        ? { id: String(clinic._id), slug: clinic.slug, name: clinic.name }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authRequired, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.sub);
    if (!user?.active) return res.status(401).json({ error: "Session expired" });
    const clinic = await Clinic.findById(user.clinicId).lean();
    let doctor = null;
    if (user.doctorId) doctor = await Doctor.findById(user.doctorId).lean();
    res.json({
      user: serializeUser(user, doctor),
      clinic: clinic
        ? { id: String(clinic._id), slug: clinic.slug, name: clinic.name }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.authRequired = authRequired;
module.exports.requireRoles = requireRoles;
