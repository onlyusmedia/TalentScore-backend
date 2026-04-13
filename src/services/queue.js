const { Queue } = require('bullmq');
const { getRedisConnection } = require('../config/redis');

let queues = {};
let redisAvailable = null;

/**
 * Check if Redis/BullMQ is available
 */
const isQueueAvailable = () => {
  if (redisAvailable !== null) return redisAvailable;
  const conn = getRedisConnection();
  redisAvailable = conn !== null;
  return redisAvailable;
};

const getQueue = (name) => {
  if (!isQueueAvailable()) return null;

  if (!queues[name]) {
    queues[name] = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  return queues[name];
};

/**
 * Enqueue a job for async processing.
 * If Redis is unavailable, runs the demo processor inline (synchronous fallback).
 *
 * @param {string} type - Job type
 * @param {Object} data - Job payload
 * @returns {string} Job ID (BullMQ job ID or fake inline job ID)
 */
const enqueueJob = async (type, data) => {
  const queue = getQueue('talentscore');

  if (queue) {
    // Real BullMQ queue
    const job = await queue.add(type, data, {
      jobId: `${type}-${data.entityId || Date.now()}`,
    });
    console.log(`[Queue] Enqueued ${type}: ${job.id}`);
    return job.id;
  }

  // Fallback: process inline using demo data
  console.log(`[Queue] Redis unavailable — processing ${type} inline (demo mode)`);

  // Import and run the demo processor directly
  try {
    const { processDemoJob } = require('../workers/demoProcessor');
    // Run async but don't await — let it process in the background
    processDemoJob(type, data).catch((err) => {
      console.error(`[Queue] Inline demo processing failed for ${type}:`, err.message);
    });
  } catch (err) {
    console.error(`[Queue] Failed to run inline processor:`, err.message);
  }

  return `inline-${type}-${Date.now()}`;
};

module.exports = { getQueue, enqueueJob, isQueueAvailable };
