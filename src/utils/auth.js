const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConfig } = require('../config');

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  const { jwtSecret, jwtExpiresIn } = getConfig();
  return jwt.sign(
    { role: user.role?.rolename || user.role || 'CUSTOMER' },
    jwtSecret,
    { subject: String(user.uid), expiresIn: jwtExpiresIn }
  );
}

module.exports = { hashPassword, signToken, verifyPassword };
