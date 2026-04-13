const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/talentscore';

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[DB] MongoDB connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`[DB] Connection error: ${error.message}`);
    console.warn('[DB] ⚠ Server starting WITHOUT database — API calls that need DB will fail.');
    console.warn('[DB] To fix: start MongoDB locally or set MONGODB_URI to an Atlas connection string in .env');
    return false;
  }
};

module.exports = connectDB;
