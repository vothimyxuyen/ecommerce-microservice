const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { grpc } = require('../../shared/grpc');
const { requireText } = require('../../shared/validation');

const pool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const ROLES = new Set(['member', 'admin', 'shipment_staff']);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters');
}

async function initialize() {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  await pool.query(await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  await seedPrivilegedAccount('SEED_ADMIN_USERNAME', 'SEED_ADMIN_PASSWORD', 'admin');
  await seedPrivilegedAccount('SEED_SHIPMENT_USERNAME', 'SEED_SHIPMENT_PASSWORD', 'shipment_staff');
}

async function seedPrivilegedAccount(usernameKey, passwordKey, role) {
  const username = process.env[usernameKey];
  const password = process.env[passwordKey];
  if (!username && !password) return;
  if (!username || !password || password.length < 12) {
    throw new Error(`${usernameKey} and ${passwordKey} must both be set; password must be at least 12 characters`);
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password, roleid)
     SELECT $1, $2, roleid FROM roles WHERE rolename = $3
     ON CONFLICT (username) DO UPDATE SET roleid = EXCLUDED.roleid`,
    [username.trim(), hash, role]
  );
}

async function register(request) {
  const username = requireText(request.username, 'username', 50);
  const password = requireText(request.password, 'password', 72);
  if (password.length < 8) throw Object.assign(new Error('password must be at least 8 characters'), { status: 400 });
  const email = request.email ? requireText(request.email, 'email', 254).toLowerCase() : null;
  const phone = request.phone ? requireText(request.phone, 'phone', 30) : null;
  const role = request.role || 'member';
  if (role !== 'member') throw Object.assign(new Error('public registration only supports the member role'), { status: 403 });
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await pool.query(
      `INSERT INTO users (username, password, roleid, email, phone)
       SELECT $1, $2, roleid, $3, $4 FROM roles WHERE rolename = $5
       RETURNING uid, username`,
      [username, passwordHash, email, phone, role]
    );
    if (!result.rowCount) throw new Error('member role is not configured');
    return { uid: Number(result.rows[0].uid), username: result.rows[0].username, role };
  } catch (error) {
    if (error.code === '23505') throw Object.assign(new Error('username or email already exists'), { status: 409 });
    throw error;
  }
}

async function login(request) {
  const username = requireText(request.username, 'username', 50);
  const password = requireText(request.password, 'password', 72);
  const result = await pool.query(
    `SELECT u.uid, u.username, u.password, r.rolename AS role
     FROM users u JOIN roles r USING (roleid) WHERE u.username = $1`,
    [username]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw Object.assign(new Error('invalid username or password'), { status: 401 });
  }

  const accessToken = jwt.sign(
    { role: user.role },
    JWT_SECRET,
    { subject: String(user.uid), expiresIn: JWT_EXPIRES_IN, jwtid: require('node:crypto').randomUUID() }
  );
  const claims = jwt.decode(accessToken);
  return {
    uid: Number(user.uid),
    role: user.role,
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: claims.exp - Math.floor(Date.now() / 1000)
  };
}

async function deleteUser({ uid }) {
  await pool.query('DELETE FROM users WHERE uid = $1 AND roleid = (SELECT roleid FROM roles WHERE rolename = $2)', [uid, 'member']);
  return {};
}

function handlers() {
  return {
    Register: register,
    Login: login,
    DeleteUser: deleteUser,
    Health: async () => {
      await pool.query('SELECT 1');
      return { status: 'UP' };
    }
  };
}

module.exports = { handlers, initialize, pool, ROLES };
