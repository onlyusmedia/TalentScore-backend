const IORedis = require('ioredis');

let connection = null;
let connectionFailed = false;

/**
 * Get Redis connection - returns null if Redis is unavailable
 */
const getRedisConnection = () => {
  if (connectionFailed) return null;

  if (!connection) {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null, // Required by BullMQ
        retryStrategy: (times) => {
          if (times > 3) {
            connectionFailed = true;
            console.warn('[Redis] Failed to connect after 3 retries — disabling Redis features');
            return null;
          }
          return Math.min(times * 500, 3000);
        },
        lazyConnect: true,
        tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
        enableReadyCheck: false,
      });

      connection.on('connect', () => console.log('[Redis] Connected'));
      connection.on('error', () => {
        // Suppress repeated error logs
      });
    } catch (err) {
      connectionFailed = true;
      console.warn('[Redis] Failed to create connection:', err.message);
      return null;
    }
  }
  return connection;
};

/**
 * Test if Redis is available
 */
const testRedisConnection = async () => {
  try {
    const conn = getRedisConnection();
    if (!conn) return false;
    await conn.connect();
    const pong = await conn.ping();
    console.log('[Redis] Ping:', pong);
    return pong === 'PONG';
  } catch (err) {
    console.warn('[Redis] Connection test failed:', err.message);
    connectionFailed = true;
    return false;
  }
};

module.exports = { getRedisConnection, testRedisConnection };
