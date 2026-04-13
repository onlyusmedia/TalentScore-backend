const express = require('express');
const Job = require('../models/Job');
const { addClient } = require('../services/sse');

const router = express.Router();

/**
 * GET /api/jobs/active
 * List active jobs for the user
 */
router.get('/active', async (req, res) => {
  try {
    const jobs = await Job.find({
      userId: req.userId,
      status: { $in: ['queued', 'processing'] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

/**
 * GET /api/jobs/:id
 * Get job status
 */
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).lean();

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ job });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

/**
 * GET /api/jobs/stream/events
 * SSE stream for real-time job status updates
 */
router.get('/stream/events', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Register this client for SSE updates
  addClient(req.userId, res);

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

module.exports = router;
