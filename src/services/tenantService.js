const Clinic = require("../models/Clinic");
const User = require("../models/User");
const Queue = require("../models/Queue");
const Rbac = require("../models/Rbac");
const { generateQueueCode } = require("../models/Queue");
const { defaultRbac } = require("./rbacService");
const { hashPassword } = require("./authService");

/** Hostnames reserved for platform apps — cannot be clinic slugs. */
const RESERVED_SLUGS = new Set([
  "www",
  "staff",
  "patient",
  "api",
  "app",
  "admin",
  "mail",
  "smtp",
  "ftp",
  "cdn",
  "static",
  "assets",
  "support",
  "help",
  "status",
  "billing",
  "pay",
  "payments",
  "login",
  "register",
  "auth",
  "docs",
  "blog",
  "test",
  "staging",
  "dev",
  "root",
  "pammi",
  "careflow",
  "null",
  "undefined",
]);

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

/** Normalize a user-provided slug (letters, numbers, hyphens). */
function normalizeSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function validateSlug(slug) {
  if (!slug) {
    return { ok: false, error: "Choose a clinic URL slug" };
  }
  if (slug.length < 2) {
    return { ok: false, error: "Slug must be at least 2 characters" };
  }
  if (slug.length > 48) {
    return { ok: false, error: "Slug must be 48 characters or fewer" };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return {
      ok: false,
      error: "Use lowercase letters, numbers, and hyphens only (e.g. any-homeo)",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: "That slug is reserved for Pammi.app" };
  }
  return { ok: true };
}

async function isSlugTaken(slug) {
  const existing = await Clinic.findOne({ slug }).select("_id").lean();
  return Boolean(existing);
}

async function suggestSlugs(baseInput, { limit = 4 } = {}) {
  const base = normalizeSlug(baseInput) || "clinic";
  const candidates = [
    base,
    `${base}-clinic`,
    `${base}-care`,
    `${base}-health`,
    `${base}-2`,
    `${base}-3`,
    `${base}-4`,
    `my-${base}`,
    `${base}-app`,
  ];
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    const slug = normalizeSlug(c);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const v = validateSlug(slug);
    if (!v.ok) continue;
    if (await isSlugTaken(slug)) continue;
    out.push(slug);
    if (out.length >= limit) break;
  }
  // Numeric fallbacks if still short
  let n = 5;
  while (out.length < limit && n < 50) {
    const slug = normalizeSlug(`${base}-${n}`);
    n += 1;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    if (!validateSlug(slug).ok) continue;
    if (await isSlugTaken(slug)) continue;
    out.push(slug);
  }
  return out;
}

async function checkSlugAvailability(rawSlug, { clinicName } = {}) {
  const fromName = clinicName ? slugifyClinicName(clinicName) : "";
  const slug = normalizeSlug(rawSlug) || fromName;
  const validation = validateSlug(slug);
  if (!validation.ok) {
    const suggestions = await suggestSlugs(fromName || slug || "clinic");
    return {
      available: false,
      slug,
      reason: validation.error,
      suggestions,
    };
  }
  if (await isSlugTaken(slug)) {
    const suggestions = await suggestSlugs(slug);
    return {
      available: false,
      slug,
      reason: "This URL is already taken",
      suggestions,
    };
  }
  return {
    available: true,
    slug,
    reason: null,
    suggestions: [],
  };
}

async function uniqueClinicSlug(name) {
  const base = slugifyClinicName(name);
  let slug = base;
  let n = 2;
  while ((await isSlugTaken(slug)) || RESERVED_SLUGS.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/**
 * Create a new clinic tenant with admin user, clinic QR, and default RBAC.
 */
function normalizeLocation(input = {}) {
  const src = input.location && typeof input.location === "object" ? input.location : input;
  const city = String(src.city || "").trim();
  const state = String(src.state || "").trim();
  const country = String(src.country || "India").trim() || "India";
  const address = String(src.address || "").trim();
  return { address, city, state, country };
}

async function registerClinicTenant({
  clinicName,
  slug: requestedSlug,
  contactName,
  contactPhone,
  email,
  password,
  location,
  address,
  city,
  state,
  country,
}) {
  const name = normalizeClinicName(clinicName);
  const nameKey = clinicNameKey(name);
  const adminName = String(contactName || "").trim();
  const phone = String(contactPhone || "").trim();
  const adminEmail = String(email || "").trim().toLowerCase();
  const adminPassword = String(password || "");
  const loc = normalizeLocation({ location, address, city, state, country });

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
  if (!loc.city) {
    const err = new Error("Clinic city is required");
    err.status = 400;
    throw err;
  }
  if (!loc.state) {
    const err = new Error("Clinic state is required");
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

  let slug;
  if (requestedSlug != null && String(requestedSlug).trim()) {
    const check = await checkSlugAvailability(requestedSlug, { clinicName: name });
    if (!check.available) {
      const err = new Error(check.reason || "Slug is not available");
      err.status = 409;
      err.code = "SLUG_TAKEN";
      err.suggestions = check.suggestions;
      throw err;
    }
    slug = check.slug;
  } else {
    slug = await uniqueClinicSlug(name);
  }

  const { trialEndsFrom } = require("./subscriptionService");
  const clinic = await Clinic.create({
    slug,
    name,
    nameKey,
    contactName: adminName,
    contactPhone: phone,
    location: loc,
    timezone: "Asia/Kolkata",
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    active: true,
    trialEndsAt: trialEndsFrom(new Date()),
    subscriptionStatus: "trial",
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
    name: { $regex: new RegExp(`^${nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
  });
}

async function findClinicBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized || RESERVED_SLUGS.has(normalized)) return null;
  return Clinic.findOne({ slug: normalized, active: true });
}

module.exports = {
  RESERVED_SLUGS,
  normalizeClinicName,
  clinicNameKey,
  slugifyClinicName,
  normalizeSlug,
  validateSlug,
  checkSlugAvailability,
  suggestSlugs,
  registerClinicTenant,
  findClinicByName,
  findClinicBySlug,
};
