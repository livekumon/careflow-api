const app = require("./app");
const { connectDb } = require("./config/db");

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careflow";
  await connectDb(uri);
  app.listen(PORT, () => {
    console.log(`Careflow API (MongoDB) on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
}

module.exports = app;
