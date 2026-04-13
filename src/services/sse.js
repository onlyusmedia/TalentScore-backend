/**
 * Server-Sent Events (SSE) manager
 * Allows the server to push real-time job status updates to connected clients
 */
const clients = new Map(); // userId -> Set of response objects

/**
 * Register an SSE client connection
 */
const addClient = (userId, res) => {
  const id = userId.toString();
  if (!clients.has(id)) {
    clients.set(id, new Set());
  }
  clients.get(id).add(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

  // Remove client on disconnect
  res.on('close', () => {
    const userClients = clients.get(id);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        clients.delete(id);
      }
    }
  });
};

/**
 * Send an event to all SSE clients of a specific user
 */
const sendEvent = (userId, event) => {
  const id = userId.toString();
  const userClients = clients.get(id);
  if (userClients) {
    const data = JSON.stringify(event);
    userClients.forEach((res) => {
      res.write(`data: ${data}\n\n`);
    });
  }
};

/**
 * Send a job status update
 */
const sendJobUpdate = (userId, jobId, status, progress, result = null) => {
  sendEvent(userId, {
    type: 'job-update',
    jobId,
    status,
    progress,
    result,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { addClient, sendEvent, sendJobUpdate };
