const Clinic = require("../models/Clinic");
const User = require("../models/User");
const Queue = require("../models/Queue");
const Rbac = require("../models/Rbac");
const { generateQueueCode } = require("../models/Queue");
const { defaultRbac } = require("./rbacService");
const { hashPassword } = require("./authService");

function normalizeClinicName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

function clinicNameKey(name) {
  return normalizeClinicName(name).toLowerCase();
}

function slugifyClinicName(name) {
  const base = normalizeClinicName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "clinic";
}

async function uniqueClinicSlug(name) {
  const base = slugifyClinicName(name);
  let slug = base;
  let n = 2;
  while (await Clinic.findOne({ slug })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/**
 * Create a new clinic tenant with admin user, clinic QR, and default RBAC.
 */
async function registerClinicTenant({
  clinicName,
  contactName,
  contactPhone,
  email,
  password,
}) {
  const name = normalizeClinicName(clinicName);
  const nameKey = clinicNameKey(name);
  const adminName = String(contactName || "").trim();
  const phone = String(contactPhone || "").trim();
  const adminEmail = String(email || "").trim().toLowerCase();
  const adminPassword = String(password || "");

  if (!name) {
    const err = new Error("Clinic name is required");
    err.status = 400;
    throw err;
  }
  if (!adminName) {
    const err = new Error("Your name is required");
    err.status = 400;
    throw err;
  }
  if (!phone) {
    const err = new Error("Contact number is required");
    err.status = 400;
    throw err;
  }
  if (!adminEmail || !adminPassword) {
    const err = new Error("Admin email and password are required");
    err.status = 400;
    throw err;
  }
  if (adminPassword.length < 6) {
    const err = new Error("Password must be at least 6 characters");
    err.status = 400;
    throw err;
  }

  const existingClinic = await Clinic.findOne({ nameKey });
  if (existingClinic) {
    const err = new Error("A clinic with this name is already registered");
    err.status = 409;
    err.code = "CLINIC_EXISTS";
    throw err;
  }

  const slug = await uniqueClinicSlug(name);
  const clinic = await Clinic.create({
    slug,
    name,
    nameKey,
    contactName: adminName,
    contactPhone: phone,
    active: true,
  });

  const user = await User.create({
    clinicId: clinic._id,
    email: adminEmail,
    passwordHash: hashPassword(adminPassword),
    name: adminName,
    role: "admin",
    active: true,
  });

  await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    doctorId: null,
    scope: "clinic",
    active: true,
  });

  const defaults = defaultRbac();
  await Rbac.create({
    clinicId: clinic._id,
    roles: defaults.roles,
    pages: defaults.pages,
    pageAccess: defaults.pageAccess,
    actions: defaults.actions,
  });

  return { clinic, user };
}

async function findClinicByName(clinicName) {
  const nameKey = clinicNameKey(clinicName);
  if (!nameKey) return null;
  let clinic = await Clinic.findOne({ nameKey, active: true });
  if (clinic) return clinic;
  // Legacy rows without nameKey
  return Clinic.findOne({
    active: true,
    name: { $regex: new RegExp(`^${nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  });
}

module.exports = {
  normalizeClinicName,
  clinicNameKey,
  registerClinicTenant,
  findClinicByName,
};
