require('dotenv').config();

function getConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const jwtSecret = env.JWT_SECRET;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters');
  }
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }
  const jwtExpiresIn = env.JWT_EXPIRES_IN || '1h';
  if (!/^\d+[smhdw]$/.test(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN must be a number followed by s, m, h, d, or w');
  }
  return {
    port,
    databaseUrl: env.DATABASE_URL,
    jwtSecret,
    jwtExpiresIn
  };
}

module.exports = { getConfig };
