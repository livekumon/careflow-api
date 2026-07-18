require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { connectDb } = require("./config/db");
const clinicsRouter = require("./routes/clinics");
const queueRouter = require("./routes/queue");
const rbacRouter = require("./routes/rbac");
const clinicQueuesRouter = require("./routes/clinicQueues");
const publicQueuesRouter = require("./routes/publicQueues");
const authRouter = require("./routes/auth");
const doctorsManageRouter = require("./routes/doctorsManage");
const appointmentsRouter = require("./routes/appointments");
const clinicSettingsRouter = require("./routes/clinicSettings");
const superAdminRouter = require("./routes/superAdmin");

const app = express();

app.use(morgan("dev"));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN || true,
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "careflow-api", db: "mongodb" });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "careflow-api",
    health: "/api/health",
  });
});

async function ensureDb(req, res, next) {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return res.status(503).json({
        error: "MONGODB_URI is not configured on this deployment",
      });
    }
    await connectDb(uri);
    next();
  } catch (err) {
    console.error("DB connect failed:", err);
    res.status(503).json({ error: "Database unavailable", detail: err.message });
  }
}

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return ensureDb(req, res, next);
});

app.use("/api/auth", authRouter);
app.use("/api/superadmin", superAdminRouter);
app.use("/api/clinics", clinicsRouter);
app.use("/api/clinics/:slug/settings", clinicSettingsRouter);
app.use("/api/clinics/:slug/manage/doctors", doctorsManageRouter);
app.use("/api/clinics/:slug/appointments", appointmentsRouter);
app.use("/api/clinics/:slug/doctors", queueRouter);
app.use("/api/clinics/:slug/queues", clinicQueuesRouter);
app.use("/api/clinics/:slug/rbac", rbacRouter);
app.use("/api/q", publicQueuesRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Server error" });
});

module.exports = app;
