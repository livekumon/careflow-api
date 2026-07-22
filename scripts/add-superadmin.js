/**
 * Upsert a platform super-admin login.
 *
 * Usage:
 *   node scripts/add-superadmin.js
 *   node scripts/add-superadmin.js --email you@example.com --password 'secret' --name 'Super Admin'
 *
 * Reads MONGODB_URI from .env (same as seed / server).
 */
require("dotenv").config();

const { connectDb } = require("../src/config/db");
const User = require("../src/models/User");
const { hashPassword, verifyPassword } = require("../src/services/authService");

const DEFAULTS = {
  email: "kcramkishore1@gmail.com",
  password: "May@2025",
  name: "Super Admin",
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") out.email = String(argv[++i] || "").trim().toLowerCase();
    else if (arg === "--password") out.password = String(argv[++i] || "");
    else if (arg === "--name") out.name = String(argv[++i] || "").trim();
  }
  out.email = String(out.email || "").trim().toLowerCase();
  return out;
}

async function main() {
  const { email, password, name } = parseArgs(process.argv.slice(2));
  if (!email || !password) {
    console.error("Email and password are required.");
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careflow";
  await connectDb(uri);

  let user = await User.findOne({ email, role: "superadmin" });
  if (user) {
    const samePassword = verifyPassword(password, user.passwordHash);
    user.name = name || user.name;
    user.active = true;
    user.clinicId = null;
    if (!samePassword) user.passwordHash = hashPassword(password);
    await user.save();
    console.log(`Updated super admin: ${email}${samePassword ? " (password unchanged)" : " (password reset)"}`);
  } else {
    user = await User.create({
      clinicId: null,
      email,
      passwordHash: hashPassword(password),
      name: name || "Super Admin",
      role: "superadmin",
      active: true,
    });
    console.log(`Created super admin: ${email}`);
  }

  console.log(`  id:   ${user._id}`);
  console.log(`  name: ${user.name}`);
  console.log(`  role: ${user.role}`);
  console.log("Sign in with Super Admin checked — no clinic name needed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
