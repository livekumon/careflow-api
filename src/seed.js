require("dotenv").config();
const { connectDb } = require("./config/db");
const Clinic = require("./models/Clinic");
const Doctor = require("./models/Doctor");
const Ticket = require("./models/Ticket");
const Queue = require("./models/Queue");
const Rbac = require("./models/Rbac");
const User = require("./models/User");
const { defaultRbac } = require("./services/rbacService");
const { generateQueueCode } = require("./models/Queue");
const { defaultScheduleSets } = require("./services/scheduleService");
const { hashPassword } = require("./services/authService");

async function seed() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careflow";
  await connectDb(uri);

  await Promise.all([
    Ticket.deleteMany({}),
    Queue.deleteMany({}),
    Doctor.deleteMany({}),
    User.deleteMany({}),
    Rbac.deleteMany({}),
    Clinic.deleteMany({}),
  ]);

  try {
    await Queue.collection.dropIndexes();
  } catch {
    /* empty collection / first run */
  }
  await Queue.syncIndexes();

  const clinic = await Clinic.create({
    slug: "sunrise-clinic",
    name: "Sunrise Multispecialty",
    nameKey: "sunrise multispecialty",
    contactName: "Front Desk",
    contactPhone: "9876543210",
  });

  const mehta = await Doctor.create({
    clinicId: clinic._id,
    key: "A",
    name: "Dr. Mehta",
    specialty: "General Physician",
    consultHistory: [9, 11, 8, 10, 12],
    doneCount: 0,
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    schedule: defaultScheduleSets(),
  });

  const kulkarni = await Doctor.create({
    clinicId: clinic._id,
    key: "B",
    name: "Dr. Kulkarni",
    specialty: "Dermatology",
    consultHistory: [15, 13, 17, 14, 16],
    doneCount: 0,
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    schedule: [
      {
        days: ["mon", "tue", "wed", "thu", "fri"],
        slots: [
          { start: "09:00", end: "13:00" },
          { start: "16:00", end: "19:00" },
        ],
      },
      {
        days: ["sat"],
        slots: [{ start: "10:00", end: "14:00" }],
      },
    ],
  });

  await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    scope: "clinic",
    doctorId: null,
  });
  await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    doctorId: mehta._id,
    scope: "doctor",
  });
  await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    doctorId: kulkarni._id,
    scope: "doctor",
  });

  const today = new Date();
  const tokenDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  await Ticket.insertMany([
    { clinicId: clinic._id, doctorId: mehta._id, name: "Rahul Sharma", phone: "98••••210", status: "waiting", source: "manual", displayToken: 1, orderKey: 1, positionAtJoin: 1 },
    { clinicId: clinic._id, doctorId: mehta._id, name: "Priya Nair", phone: "90••••882", status: "waiting", source: "qr", displayToken: 2, orderKey: 2, positionAtJoin: 2 },
    { clinicId: clinic._id, doctorId: mehta._id, name: "Amit Verma", phone: "99••••045", status: "waiting", source: "self", displayToken: 3, orderKey: 3, positionAtJoin: 3 },
    { clinicId: clinic._id, doctorId: kulkarni._id, name: "Sana Iqbal", phone: "91••••330", status: "waiting", source: "manual", displayToken: 1, orderKey: 1, positionAtJoin: 1 },
    { clinicId: clinic._id, doctorId: kulkarni._id, name: "Vikram Rao", phone: "93••••771", status: "waiting", source: "qr", displayToken: 2, orderKey: 2, positionAtJoin: 2 },
  ]);

  mehta.tokenDate = tokenDate;
  mehta.tokenSeq = 3;
  await mehta.save();
  kulkarni.tokenDate = tokenDate;
  kulkarni.tokenSeq = 2;
  await kulkarni.save();

  await User.create([
    {
      clinicId: clinic._id,
      email: "desk@sunrise.clinic",
      passwordHash: hashPassword("desk123"),
      name: "Front Desk",
      role: "receptionist",
    },
    {
      clinicId: clinic._id,
      email: "mehta@sunrise.clinic",
      passwordHash: hashPassword("doctor123"),
      name: "Dr. Mehta",
      role: "doctor",
      doctorId: mehta._id,
    },
    {
      clinicId: clinic._id,
      email: "kulkarni@sunrise.clinic",
      passwordHash: hashPassword("doctor123"),
      name: "Dr. Kulkarni",
      role: "doctor",
      doctorId: kulkarni._id,
    },
    {
      clinicId: clinic._id,
      email: "admin@sunrise.clinic",
      passwordHash: hashPassword("admin123"),
      name: "Clinic Admin",
      role: "admin",
    },
  ]);

  const defaults = defaultRbac();
  await Rbac.create({
    clinicId: clinic._id,
    roles: defaults.roles,
    pages: defaults.pages,
    pageAccess: defaults.pageAccess,
    actions: defaults.actions,
  });

  console.log("Seeded clinic:", clinic.slug);
  console.log("Logins:");
  console.log("  receptionist  desk@sunrise.clinic / desk123");
  console.log("  doctor        mehta@sunrise.clinic / doctor123");
  console.log("  doctor        kulkarni@sunrise.clinic / doctor123");
  console.log("  admin         admin@sunrise.clinic / admin123");
  await require("mongoose").disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  try {
    await require("mongoose").disconnect();
  } catch {}
  process.exit(1);
});
