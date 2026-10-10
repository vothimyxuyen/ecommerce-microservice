const jwt = require('jsonwebtoken');
const { getConfig } = require('../config');

function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'bearer token required' });
  }

  try {
    const payload = jwt.verify(authorization.slice(7), getConfig().jwtSecret);
    if (!payload || typeof payload !== 'object' || typeof payload.sub !== 'string' ||
        typeof payload.role !== 'string') {
      return res.status(401).json({ error: 'invalid token' });
    }
    const uid = Number(payload.sub);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      return res.status(401).json({ error: 'invalid token' });
    }
    req.user = { uid, role: payload.role };
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

function authorize(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'forbidden' });
    return next();
  };
}

module.exports = { authenticate, authorize };
