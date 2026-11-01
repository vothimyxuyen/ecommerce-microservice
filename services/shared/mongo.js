const mongoose = require('mongoose');

async function connectMongo(uri) {
  if (!uri) throw new Error('MongoDB URI is required');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

module.exports = { connectMongo };
