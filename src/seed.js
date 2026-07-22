require("dotenv").config();
const { connectDb } = require("./config/db");
const Clinic = require("./models/Clinic");
const Doctor = require("./models/Doctor");
const Ticket = require("./models/Ticket");
const Queue = require("./models/Queue");
const Rbac = require("./models/Rbac");
const User = require("./models/User");
const Appointment = require("./models/Appointment");
const { defaultRbac } = require("./services/rbacService");
const { generateQueueCode } = require("./models/Queue");
const { defaultScheduleSets } = require("./services/scheduleService");
const { hashPassword } = require("./services/authService");

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function seed() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careflow";
  await connectDb(uri);

  await Promise.all([
    Ticket.deleteMany({}),
    Appointment.deleteMany({}),
    Queue.deleteMany({}),
    Doctor.deleteMany({}),
    User.deleteMany({}),
    Rbac.deleteMany({}),
    Clinic.deleteMany({}),
  ]);

  for (const Model of [Queue, User]) {
    try {
      await Model.collection.dropIndexes();
    } catch {
      /* empty collection / first run */
    }
  }
  await Promise.all([Queue.syncIndexes(), User.syncIndexes(), Clinic.syncIndexes()]);

  const clinic = await Clinic.create({
    slug: "sunrise-clinic",
    name: "Sunrise Multispecialty",
    nameKey: "sunrise multispecialty",
    contactName: "Front Desk",
    contactPhone: "9876543210",
    location: {
      address: "12 MG Road",
      city: "Pune",
      state: "Maharashtra",
      country: "India",
    },
    timezone: "Asia/Kolkata",
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    createdAt: daysAgo(28),
    updatedAt: daysAgo(28),
  });

  const clinic2 = await Clinic.create({
    slug: "green-valley-clinic",
    name: "Green Valley Clinic",
    nameKey: "green valley clinic",
    contactName: "Clinic Admin",
    contactPhone: "9988776655",
    location: {
      address: "45 Residency Road",
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
    },
    timezone: "Asia/Kolkata",
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    createdAt: daysAgo(12),
    updatedAt: daysAgo(12),
  });

  const clinic3 = await Clinic.create({
    slug: "coastal-care",
    name: "Coastal Care",
    nameKey: "coastal care",
    contactName: "Reception",
    contactPhone: "9123456780",
    location: {
      address: "8 Beach Road",
      city: "Chennai",
      state: "Tamil Nadu",
      country: "India",
    },
    timezone: "Asia/Kolkata",
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
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
    createdAt: daysAgo(27),
    updatedAt: daysAgo(27),
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
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
  });

  const doctorGV = await Doctor.create({
    clinicId: clinic2._id,
    key: "A",
    name: "Dr. Iyer",
    specialty: "Pediatrics",
    consultHistory: [10, 12, 11],
    doneCount: 0,
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    schedule: defaultScheduleSets(),
    createdAt: daysAgo(11),
    updatedAt: daysAgo(11),
  });

  const doctorCC = await Doctor.create({
    clinicId: clinic3._id,
    key: "A",
    name: "Dr. Menon",
    specialty: "ENT",
    consultHistory: [8, 9, 10],
    doneCount: 0,
    checkInBeforeMin: 10,
    checkInAfterMin: 15,
    schedule: defaultScheduleSets(),
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
  });

  for (const c of [clinic, clinic2, clinic3]) {
    await Queue.create({
      code: generateQueueCode(),
      clinicId: c._id,
      scope: "clinic",
      doctorId: null,
    });
  }
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
  await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic2._id,
    doctorId: doctorGV._id,
    scope: "doctor",
  });
  await Queue.create({
    code: generateQueueCode(),
    clinicId: clinic3._id,
    doctorId: doctorCC._id,
    scope: "doctor",
  });

  const today = new Date();
  const tokenDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  await Ticket.insertMany([
    { clinicId: clinic._id, doctorId: mehta._id, name: "Rahul Sharma", phone: "9876543210", status: "waiting", source: "manual", displayToken: 1, orderKey: 1, positionAtJoin: 1 },
    { clinicId: clinic._id, doctorId: mehta._id, name: "Priya Nair", phone: "9012345882", status: "waiting", source: "qr", displayToken: 2, orderKey: 2, positionAtJoin: 2 },
    { clinicId: clinic._id, doctorId: mehta._id, name: "Amit Verma", phone: "9988776045", status: "waiting", source: "self", displayToken: 3, orderKey: 3, positionAtJoin: 3 },
    { clinicId: clinic._id, doctorId: kulkarni._id, name: "Sana Iqbal", phone: "9123456330", status: "waiting", source: "manual", displayToken: 1, orderKey: 1, positionAtJoin: 1 },
    { clinicId: clinic._id, doctorId: kulkarni._id, name: "Vikram Rao", phone: "9345678771", status: "waiting", source: "qr", displayToken: 2, orderKey: 2, positionAtJoin: 2 },
    {
      clinicId: clinic._id,
      doctorId: mehta._id,
      name: "Neha Kapoor",
      phone: "9765432111",
      status: "done",
      source: "manual",
      displayToken: 0,
      orderKey: 0,
      positionAtJoin: 0,
      completedAt: daysAgo(3),
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    {
      clinicId: clinic2._id,
      doctorId: doctorGV._id,
      name: "Arjun Desai",
      phone: "9654321222",
      status: "done",
      source: "qr",
      displayToken: 0,
      orderKey: 0,
      positionAtJoin: 0,
      completedAt: daysAgo(8),
      createdAt: daysAgo(8),
      updatedAt: daysAgo(8),
    },
    {
      clinicId: clinic3._id,
      doctorId: doctorCC._id,
      name: "Lakshmi R",
      phone: "9543210333",
      status: "done",
      source: "appointment",
      displayToken: 0,
      orderKey: 0,
      positionAtJoin: 0,
      completedAt: daysAgo(1),
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
  ]);

  mehta.tokenDate = tokenDate;
  mehta.tokenSeq = 3;
  await mehta.save();
  kulkarni.tokenDate = tokenDate;
  kulkarni.tokenSeq = 2;
  await kulkarni.save();

  await Appointment.create({
    clinicId: clinic._id,
    doctorId: mehta._id,
    patientName: "Demo Patient",
    phone: "9000000001",
    date: tokenDate,
    startTime: "10:00",
    endTime: "10:15",
    durationMin: 15,
    status: "booked",
  });

  await User.create([
    {
      clinicId: null,
      email: "superadmin@careflow.app",
      passwordHash: hashPassword("super123"),
      name: "Super Admin",
      role: "superadmin",
    },
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
    {
      clinicId: clinic2._id,
      email: "admin@greenvalley.clinic",
      passwordHash: hashPassword("admin123"),
      name: "GV Admin",
      role: "admin",
    },
    {
      clinicId: clinic3._id,
      email: "admin@coastal.clinic",
      passwordHash: hashPassword("admin123"),
      name: "Coastal Admin",
      role: "admin",
    },
  ]);

  const defaults = defaultRbac();
  for (const c of [clinic, clinic2, clinic3]) {
    await Rbac.create({
      clinicId: c._id,
      roles: defaults.roles,
      pages: defaults.pages,
      pageAccess: defaults.pageAccess,
      actions: defaults.actions,
    });
  }

  console.log("Seeded clinics:", clinic.slug, clinic2.slug, clinic3.slug);
  console.log("Logins:");
  console.log("  superadmin   superadmin@careflow.app / super123  (no clinic name)");
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
