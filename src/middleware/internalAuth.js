/**
 * Internal API key authentication for n8n callbacks
 * Only n8n should access these endpoints
 */
const internalAuth = (req, res, next) => {
  const apiKey = req.headers['x-internal-key'];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden — invalid internal key' });
  }
  next();
};

module.exports = { internalAuth };
