const crypto = require("crypto");

const AUTH_SECRET = process.env.AUTH_SECRET || "careflow-dev-secret-change-me";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueToken(user) {
  return signToken({
    sub: String(user._id),
    role: user.role,
    clinicId: user.clinicId ? String(user.clinicId) : null,
    doctorId: user.doctorId ? String(user.doctorId) : null,
    exp: Date.now() + TOKEN_TTL_MS,
  });
}

function serializeUser(user, doctor = null) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    clinicId: user.clinicId ? String(user.clinicId) : null,
    doctorId: user.doctorId ? String(user.doctorId) : null,
    doctor: doctor
      ? {
          id: String(doctor._id || doctor.id),
          name: doctor.name,
          specialty: doctor.specialty,
          key: doctor.key,
        }
      : null,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  serializeUser,
};
