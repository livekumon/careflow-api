require("dotenv").config();
const { connectDb } = require("./config/db");
const Clinic = require("./models/Clinic");
const Doctor = require("./models/Doctor");
const Ticket = require("./models/Ticket");
const Queue = require("./models/Queue");
const Rbac = require("./models/Rbac");
const { defaultRbac } = require("./services/rbacService");
const { generateQueueCode } = require("./models/Queue");

async function seed() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careflow";
  await connectDb(uri);

  await Promise.all([
    Ticket.deleteMany({}),
    Queue.deleteMany({}),
    Doctor.deleteMany({}),
    Rbac.deleteMany({}),
    Clinic.deleteMany({}),
  ]);

  // Drop legacy queue indexes (clinic QR made doctorId optional).
  try {
    await Queue.collection.dropIndexes();
  } catch {
    /* empty collection / first run */
  }
  await Queue.syncIndexes();

  const clinic = await Clinic.create({
    slug: "sunrise-clinic",
    name: "Sunrise Multispecialty",
  });

  const mehta = await Doctor.create({
    clinicId: clinic._id,
    key: "A",
    name: "Dr. Mehta",
    specialty: "General Physician",
    consultHistory: [9, 11, 8, 10, 12],
    doneCount: 0,
  });

  const kulkarni = await Doctor.create({
    clinicId: clinic._id,
    key: "B",
    name: "Dr. Kulkarni",
    specialty: "Dermatology",
    consultHistory: [15, 13, 17, 14, 16],
    doneCount: 0,
  });

  const qClinic = await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    scope: "clinic",
    doctorId: null,
  });
  const qMehta = await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    doctorId: mehta._id,
    scope: "doctor",
  });
  const qKulkarni = await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic._id,
    doctorId: kulkarni._id,
    scope: "doctor",
  });

  await Ticket.insertMany([
    { clinicId: clinic._id, doctorId: mehta._id, name: "Rahul Sharma", phone: "98••••210", status: "waiting", source: "manual" },
    { clinicId: clinic._id, doctorId: mehta._id, name: "Priya Nair", phone: "90••••882", status: "waiting", source: "qr" },
    { clinicId: clinic._id, doctorId: mehta._id, name: "Amit Verma", phone: "99••••045", status: "waiting", source: "self" },
    { clinicId: clinic._id, doctorId: kulkarni._id, name: "Sana Iqbal", phone: "91••••330", status: "waiting", source: "manual" },
    { clinicId: clinic._id, doctorId: kulkarni._id, name: "Vikram Rao", phone: "93••••771", status: "waiting", source: "qr" },
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
  console.log("Doctors:", mehta.name, "&", kulkarni.name);
  console.log("Clinic queue code:", qClinic.code);
  console.log("Doctor queue codes:", qMehta.code, qKulkarni.code);
  await require("mongoose").disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  try {
    await require("mongoose").disconnect();
  } catch {}
  process.exit(1);
});
