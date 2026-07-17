const mongoose = require("mongoose");

let cached = global.__careflowMongoose;
if (!cached) {
  cached = global.__careflowMongoose = { conn: null, promise: null };
}

async function connectDb(uri) {
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  mongoose.set("strictQuery", true);

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
      })
      .then((m) => m.connection);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDb };
