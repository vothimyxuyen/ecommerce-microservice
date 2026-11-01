require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { createClient: createRedisClient } = require('redis');
const {
  call,
  createClient,
  grpc,
  loadService
} = require('../../shared/grpc');

const app = express();
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters');
}

const redis = createRedisClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (error) => console.error('API Gateway Redis error:', error.message));

const auth = createClient(
  loadService('auth.proto', 'ecommerce.auth.v1', 'AuthService'),
  process.env.AUTH_GRPC_ADDRESS || 'localhost:50051'
);
const customer = createClient(
  loadService('customer.proto', 'ecommerce.customer.v1', 'CustomerService'),
  process.env.CUSTOMER_GRPC_ADDRESS || 'localhost:50052'
);
const product = createClient(
  loadService('product.proto', 'ecommerce.product.v1', 'ProductService'),
  process.env.PRODUCT_GRPC_ADDRESS || 'localhost:50053'
);
const order = createClient(
  loadService('order.proto', 'ecommerce.order.v1', 'OrderService'),
  process.env.ORDER_GRPC_ADDRESS || 'localhost:50054'
);
const shipment = createClient(
  loadService('shipment.proto', 'ecommerce.shipment.v1', 'ShipmentService'),
  process.env.SHIPMENT_GRPC_ADDRESS || 'localhost:50055'
);
const clients = { auth, customer, product, order, shipment };

const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 100);
const rateWindowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);
const productCacheTtl = Number(process.env.PRODUCT_CACHE_TTL_SECONDS || 30);
if (!Number.isSafeInteger(rateLimitMax) || rateLimitMax < 1 ||
    !Number.isSafeInteger(rateWindowSeconds) || rateWindowSeconds < 1 ||
    !Number.isSafeInteger(productCacheTtl) || productCacheTtl < 1) {
  throw new Error('Rate-limit and product-cache configuration must be positive integers');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  req.requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader('x-request-id', req.requestId);
  res.on('finish', () => {
    console.log(JSON.stringify({
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    }));
  });
  next();
});

async function rateLimit(req, res, next) {
  if (req.path === '/api/health') return next();
  try {
    const key = `rate:${req.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, rateWindowSeconds);
    res.setHeader('x-ratelimit-limit', rateLimitMax);
    res.setHeader('x-ratelimit-remaining', Math.max(0, rateLimitMax - count));
    if (count > rateLimitMax) return res.status(429).json({ error: 'rate limit exceeded', requestId: req.requestId });
    return next();
  } catch (error) {
    return next(Object.assign(new Error('rate limiter is unavailable'), { status: 503, cause: error }));
  }
}

function authenticate(req, res, next) {
  const value = req.get('authorization');
  if (!value || !value.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'bearer token required', requestId: req.requestId });
  }
  let claims;
  try {
    claims = jwt.verify(value.slice(7), jwtSecret, { algorithms: ['HS256'] });
  } catch (_error) {
    return res.status(401).json({ error: 'invalid or expired token', requestId: req.requestId });
  }
  if (!claims || typeof claims !== 'object' || !/^\d+$/.test(claims.sub || '') ||
      !['member', 'admin', 'shipment_staff'].includes(claims.role) ||
      typeof claims.jti !== 'string' || !Number.isSafeInteger(claims.exp)) {
    return res.status(401).json({ error: 'invalid token claims', requestId: req.requestId });
  }
  redis.get(`revoked:${claims.jti}`)
    .then((revoked) => {
      if (revoked) return res.status(401).json({ error: 'token has been revoked', requestId: req.requestId });
      req.user = {
        uid: Number(claims.sub),
        role: claims.role,
        jti: claims.jti,
        exp: claims.exp,
        token: value.slice(7)
      };
      return next();
    })
    .catch((error) => next(Object.assign(new Error('authentication store is unavailable'), { status: 503, cause: error })));
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', requestId: req.requestId });
    }
    return next();
  };
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

function rpcError(error) {
  const status = ({
    [grpc.status.INVALID_ARGUMENT]: 400,
    [grpc.status.UNAUTHENTICATED]: 401,
    [grpc.status.PERMISSION_DENIED]: 403,
    [grpc.status.NOT_FOUND]: 404,
    [grpc.status.ALREADY_EXISTS]: 409,
    [grpc.status.FAILED_PRECONDITION]: 409,
    [grpc.status.RESOURCE_EXHAUSTED]: 429,
    [grpc.status.UNAVAILABLE]: 503,
    [grpc.status.DEADLINE_EXCEEDED]: 504
  })[error.code] || 502;
  return Object.assign(new Error(error.details || 'downstream service request failed'), { status });
}

async function rpc(client, method, request) {
  try {
    return await call(client, method, request);
  } catch (error) {
    throw rpcError(error);
  }
}

function validId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw Object.assign(new Error(`${name} must be a positive integer`), { status: 400 });
  }
  return id;
}

function requiredText(value, name, maximum = 255) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw Object.assign(new Error(`${name} is required and must be at most ${maximum} characters`), { status: 400 });
  }
  return value.trim();
}

function optionalText(value, name, maximum = 255) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw Object.assign(new Error(`${name} must be a string no longer than ${maximum} characters`), { status: 400 });
  }
  return value.trim();
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw Object.assign(new Error(`${name} must be a non-negative integer`), { status: 400 });
  }
  return value;
}

function nonNegativePrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw Object.assign(new Error('price must be a non-negative number'), { status: 400 });
  }
  return value;
}

app.use(rateLimit);
app.get('/api/health', route(async (_req, res) => {
  const results = await Promise.allSettled([
    redis.ping(),
    ...Object.entries(clients).map(([name, client]) => rpc(client, 'Health', {}).then(() => name))
  ]);
  const dependencies = Object.fromEntries(results.map((result, index) => {
    const name = index === 0 ? 'redis' : Object.keys(clients)[index - 1];
    return [name, result.status === 'fulfilled' ? 'UP' : 'DOWN'];
  }));
  const healthy = Object.values(dependencies).every((status) => status === 'UP');
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'UP' : 'DEGRADED',
    dependencies,
    requestId: _req.requestId
  });
}));

app.post('/api/auth/register', route(async (req, res) => {
  const username = requiredText(req.body?.username, 'username', 50);
  const password = requiredText(req.body?.password, 'password', 72);
  const fullname = req.body?.fullname === undefined ? username : requiredText(req.body.fullname, 'fullname', 100);
  const email = req.body?.email === undefined ? '' : requiredText(req.body.email, 'email', 254);
  const phone = req.body?.phone === undefined ? '' : requiredText(req.body.phone, 'phone', 30);
  const age = req.body?.age === undefined ? 0 : nonNegativeInteger(req.body.age, 'age');
  const address = optionalText(req.body?.address, 'address', 255);
  const account = await rpc(auth, 'Register', {
    username,
    password,
    email,
    phone,
    role: 'member'
  });
  try {
    await rpc(customer, 'EnsureCustomer', {
      uid: account.uid,
      fullname,
      age,
      address
    });
  } catch (error) {
    await rpc(auth, 'DeleteUser', { uid: account.uid }).catch((compensationError) => {
      console.error('Registration compensation failed:', compensationError.message);
    });
    throw error;
  }
  return res.status(201).json({
    message: 'User registered successfully',
    uid: account.uid,
    role: account.role
  });
}));

app.post('/api/auth/login', route(async (req, res) => {
  const result = await rpc(auth, 'Login', {
    username: requiredText(req.body?.username, 'username', 50),
    password: requiredText(req.body?.password, 'password', 72)
  });
  return res.status(200).json({
    accessToken: result.access_token,
    tokenType: result.token_type,
    expiresIn: result.expires_in,
    uid: result.uid,
    role: result.role
  });
}));

app.post('/api/auth/logout', authenticate, route(async (req, res) => {
  const ttl = Math.max(1, req.user.exp - Math.floor(Date.now() / 1000));
  await redis.set(`revoked:${req.user.jti}`, '1', { EX: ttl });
  return res.status(200).json({ message: 'Logged out successfully' });
}));

app.get('/api/customers', authenticate, requireRole('member', 'admin'), route(async (_req, res) => {
  return res.json(await rpc(customer, 'ListCustomers', {}));
}));

app.get('/api/customers/:uid/membership', authenticate, requireRole('member', 'admin'), route(async (req, res) => {
  return res.json(await rpc(customer, 'GetMembership', { uid: validId(req.params.uid, 'uid') }));
}));

app.patch('/api/customers/:uid/membership', authenticate, requireRole('admin'), route(async (req, res) => {
  const mid = validId(req.body?.mid, 'mid');
  return res.json(await rpc(customer, 'UpdateMembership', {
    uid: validId(req.params.uid, 'uid'),
    mid,
    mname: requiredText(req.body?.mname, 'mname', 50),
    score: nonNegativeInteger(req.body?.score, 'score')
  }));
}));

app.get('/api/customers/:uid', authenticate, requireRole('member', 'admin'), route(async (req, res) => {
  return res.json(await rpc(customer, 'GetCustomer', { uid: validId(req.params.uid, 'uid') }));
}));

app.post('/api/customers', authenticate, requireRole('admin'), route(async (req, res) => {
  const customerRecord = await rpc(customer, 'CreateCustomer', {
    uid: validId(req.body?.uid, 'uid'),
    fullname: requiredText(req.body?.fullname, 'fullname', 100),
    age: nonNegativeInteger(req.body?.age, 'age'),
    address: typeof req.body?.address === 'string' ? req.body.address : '',
    mid: req.body?.mid === undefined ? 1 : validId(req.body.mid, 'mid')
  });
  return res.status(201).json(customerRecord);
}));

app.put('/api/customers/:uid', authenticate, requireRole('admin'), route(async (req, res) => {
  const update = { uid: validId(req.params.uid, 'uid') };
  if (Object.hasOwn(req.body || {}, 'fullname')) update.fullname = requiredText(req.body.fullname, 'fullname', 100);
  if (Object.hasOwn(req.body || {}, 'age')) update.age = nonNegativeInteger(req.body.age, 'age');
  if (Object.hasOwn(req.body || {}, 'address')) {
    update.address = optionalText(req.body.address, 'address', 255);
  }
  if (Object.hasOwn(req.body || {}, 'mid')) update.mid = validId(req.body.mid, 'mid');
  if (Object.keys(update).length === 1) {
    throw Object.assign(new Error('at least one customer field is required'), { status: 400 });
  }
  return res.json(await rpc(customer, 'UpdateCustomer', update));
}));

app.delete('/api/customers/:uid', authenticate, requireRole('admin'), route(async (req, res) => {
  await rpc(customer, 'DeleteCustomer', { uid: validId(req.params.uid, 'uid') });
  return res.status(200).json({ message: 'Customer deleted successfully', uid: Number(req.params.uid) });
}));

app.get('/api/products', authenticate, requireRole('member', 'admin', 'shipment_staff'), route(async (_req, res) => {
  const key = 'cache:products:list';
  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));
  const result = await rpc(product, 'ListProducts', {});
  await redis.set(key, JSON.stringify(result), { EX: productCacheTtl });
  return res.json(result);
}));

app.get('/api/products/:pid', authenticate, requireRole('member', 'admin', 'shipment_staff'), route(async (req, res) => {
  return res.json(await rpc(product, 'GetProduct', { pid: validId(req.params.pid, 'pid') }));
}));

app.post('/api/products', authenticate, requireRole('admin'), route(async (req, res) => {
  const result = await rpc(product, 'CreateProduct', {
    pname: requiredText(req.body?.pname, 'pname', 100),
    price: nonNegativePrice(req.body?.price),
    quantity: nonNegativeInteger(req.body?.quantity, 'quantity')
  });
  await redis.del('cache:products:list');
  return res.status(201).json(result);
}));

app.put('/api/products/:pid', authenticate, requireRole('admin'), route(async (req, res) => {
  const result = await rpc(product, 'UpdateProduct', {
    pid: validId(req.params.pid, 'pid'),
    pname: requiredText(req.body?.pname, 'pname', 100),
    price: nonNegativePrice(req.body?.price),
    quantity: nonNegativeInteger(req.body?.quantity, 'quantity')
  });
  await redis.del('cache:products:list');
  return res.json(result);
}));

app.delete('/api/products/:pid', authenticate, requireRole('admin'), route(async (req, res) => {
  await rpc(product, 'DeleteProduct', { pid: validId(req.params.pid, 'pid') });
  await redis.del('cache:products:list');
  return res.status(200).json({ message: 'Product deleted successfully', pid: Number(req.params.pid) });
}));

app.post('/api/orders', authenticate, requireRole('member'), route(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50 ||
      items.some((item) => !item || !Number.isSafeInteger(item.pid) || item.pid < 1 ||
        !Number.isSafeInteger(item.qty) || item.qty < 1)) {
    throw Object.assign(new Error('items must contain 1 to 50 entries with positive integer pid and qty'), { status: 400 });
  }
  const requestId = req.get('idempotency-key') || req.get('x-request-id') || '';
  if (requestId && (requestId.length > 100 || !/^[\w.-]+$/.test(requestId))) {
    throw Object.assign(new Error('idempotency key must be at most 100 letters, numbers, dots, underscores, or hyphens'), { status: 400 });
  }
  const result = await rpc(order, 'CreateOrder', {
    uid: req.user.uid,
    role: req.user.role,
    request_id: requestId,
    items: items.map((item) => ({
      pid: Number(item?.pid),
      qty: Number(item?.qty)
    }))
  });
  return res.status(201).json(result);
}));

app.get('/api/orders', authenticate, requireRole('member', 'admin'), route(async (req, res) => {
  return res.json(await rpc(order, 'ListOrders', { uid: req.user.uid, role: req.user.role }));
}));

app.get('/api/orders/:oid', authenticate, requireRole('member', 'admin'), route(async (req, res) => {
  return res.json(await rpc(order, 'GetOrder', {
    oid: validId(req.params.oid, 'oid'),
    uid: req.user.uid,
    role: req.user.role
  }));
}));

app.get('/api/shipments/order/:oid', authenticate, requireRole('member', 'admin', 'shipment_staff'), route(async (req, res) => {
  return res.json(await rpc(shipment, 'GetShipmentByOrder', {
    oid: validId(req.params.oid, 'oid'),
    uid: req.user.uid,
    role: req.user.role
  }));
}));

app.get('/api/shipments/:shipid', authenticate, requireRole('member', 'admin', 'shipment_staff'), route(async (req, res) => {
  return res.json(await rpc(shipment, 'GetShipment', {
    shipid: validId(req.params.shipid, 'shipid'),
    uid: req.user.uid,
    role: req.user.role
  }));
}));

app.patch('/api/shipments/:shipid/status', authenticate, requireRole('admin', 'shipment_staff'), route(async (req, res) => {
  return res.json(await rpc(shipment, 'UpdateShipmentStatus', {
    shipid: validId(req.params.shipid, 'shipid'),
    status: requiredText(req.body?.status, 'status', 50)
  }));
}));

app.use((_req, res) => res.status(404).json({ error: 'route not found' }));
app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error(JSON.stringify({
      requestId: req.requestId,
      error: error.message
    }));
  }
  return res.status(status).json({
    error: status === 500 ? 'internal server error' : error.message,
    requestId: req.requestId
  });
});

async function start() {
  await redis.connect();
  const port = Number(process.env.GATEWAY_PORT || 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`API Gateway listening on port ${port}`);
  });
  const shutdown = () => {
    server.close(() => {
      redis.quit().catch((error) => console.error('Failed to close Redis connection:', error));
      Object.values(clients).forEach((client) => client.close());
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('API Gateway failed to start:', error);
    process.exit(1);
  });
}

module.exports = { app, authenticate, rateLimit };
