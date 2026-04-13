require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const { auth } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimiter');
const { creditCheck } = require('./middleware/credit');

const app = express();
const PORT = process.env.PORT || 4000;
const isVercel = process.env.VERCEL === '1';

// ─── For Serverless: Ensure DB is connected lazily ──────────────────
if (isVercel) {
  app.use(async (req, res, next) => {
    await connectDB();
    next();
  });
}

// ─── Core Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(apiLimiter);

// ─── Health check & Root ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'TalentScore API',
    status: 'Running',
    docs: 'This is the backend API. Please use the frontend application to interact.',
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ─── Public Routes ──────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));

// ─── Protected Routes ───────────────────────────────────────────────
app.use('/api/roles', auth, require('./routes/roles'));
app.use('/api', auth, require('./routes/candidates'));
app.use('/api/upload', auth, require('./routes/upload'));
app.use('/api/jobs', auth, require('./routes/jobs'));
app.use('/api/billing', auth, require('./routes/billing'));

// ─── Internal Routes (n8n callbacks) ────────────────────────────────
app.use('/api/internal', require('./routes/internal'));

// ─── 404 Handler ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─── Global Error Handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// ─── Start Server ───────────────────────────────────────────────────
const start = async () => {
  const dbConnected = await connectDB();

  // Start BullMQ worker for async job processing ONLY if NOT on Vercel
  if (!isVercel) {
    try {
      const { testRedisConnection } = require('./config/redis');
      const redisAvailable = await testRedisConnection();
      if (redisAvailable) {
        const { startWorker } = require('./workers/jobProcessor');
        startWorker();
      } else {
        console.warn('[Server] Redis not available — BullMQ worker disabled');
        console.warn('[Server] Async job processing will not work. Start Redis to enable it.');
      }
    } catch (err) {
      console.warn('[Server] Worker failed to start:', err.message);
    }

    app.listen(PORT, () => {
      console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║    TalentScore API Server                            ║
  ║    http://localhost:${PORT}                              ║
  ║    Environment: ${(process.env.NODE_ENV || 'development').padEnd(12)}                    ║
  ║    Database:    ${dbConnected ? 'Connected ✓ ' : 'Disconnected ✗'}                    ║
  ╚══════════════════════════════════════════════════════╝
      `);
    });
  }
};

if (!isVercel) {
  start().catch((err) => {
    console.error('[Server] Failed to start:', err);
  });
}

module.exports = app;
