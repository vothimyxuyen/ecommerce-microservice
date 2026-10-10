const express = require('express');
const { Prisma } = require('@prisma/client');
const prisma = require('./prisma');
const { authenticate, authorize } = require('./middleware/auth');
const { asyncHandler } = require('./utils/async-handler');
const { hashPassword, signToken, verifyPassword } = require('./utils/auth');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
  next();
});

function validateId(req, res, next) {
  const id = Number(req.params.pid || req.params.oid);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  req.resourceId = id;
  return next();
}

function isValidPrice(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 99999999.99) {
    return false;
  }
  const scaled = price * 100;
  return Math.abs(scaled - Math.round(scaled)) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
}

app.get('/health', asyncHandler(async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check database query failed:', error);
    return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { username, fullname, password } = req.body;
  if (![username, fullname, password].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'username, fullname, and password are required' });
  }
  if (username.trim().length > 50 || fullname.trim().length > 100) {
    return res.status(400).json({ error: 'username must be at most 50 characters and fullname at most 100' });
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'password must be between 8 and 72 UTF-8 bytes' });
  }

  const [role, membership] = await Promise.all([
    prisma.role.findUnique({ where: { rolename: 'CUSTOMER' } }),
    prisma.membership.findUnique({ where: { mname: 'Basic' } })
  ]);
  if (!role || !membership) {
    return res.status(503).json({ error: 'account defaults are not configured' });
  }

  const user = await prisma.user.create({
    data: {
      username: username.trim(),
      fullname: fullname.trim(),
      password: await hashPassword(password),
      roleId: role.roleId,
      membershipId: membership.membershipId
    },
    select: { uid: true, username: true, fullname: true, roleId: true, membershipId: true }
  });
  res.status(201).json({ user, token: signToken(user) });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { username: username.trim() },
    include: { role: true }
  });
  if (!user || !(await verifyPassword(password, user.password))) {
    return res.status(401).json({ error: 'invalid username or password' });
  }
  res.json({
    token: signToken(user),
    user: { uid: user.uid, username: user.username, fullname: user.fullname, role: user.role.rolename }
  });
}));

app.use('/api', authenticate);

app.post('/api/products', authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { pname, price, quantity } = req.body;
  if (typeof pname !== 'string' || !pname.trim() || pname.trim().length > 100 || !isValidPrice(price) ||
      !Number.isSafeInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: 'pname, non-negative price, and non-negative integer quantity are required' });
  }
  const product = await prisma.product.create({
    data: { pname: pname.trim(), price, quantity }
  });
  res.status(201).json(product);
}));

app.get('/api/products', asyncHandler(async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: { pid: 'asc' } }));
}));

app.get('/api/products/:pid', validateId, asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { pid: req.resourceId } });
  if (!product) return res.status(404).json({ error: 'product not found' });
  res.json(product);
}));

app.put('/api/products/:pid', validateId, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { pname, price, quantity } = req.body;
  if (typeof pname !== 'string' || !pname.trim() || pname.trim().length > 100 || !isValidPrice(price) ||
      !Number.isSafeInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: 'pname, non-negative price, and non-negative integer quantity are required' });
  }
  const product = await prisma.product.update({
    where: { pid: req.resourceId },
    data: { pname: pname.trim(), price, quantity }
  });
  res.json(product);
}));

app.delete('/api/products/:pid', validateId, authorize('ADMIN'), asyncHandler(async (req, res) => {
  await prisma.product.delete({ where: { pid: req.resourceId } });
  res.status(204).end();
}));

app.post('/api/orders', asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0 ||
      items.some((item) => !item || !Number.isSafeInteger(item.pid) || item.pid < 1 ||
        !Number.isSafeInteger(item.qty) || item.qty <= 0)) {
    return res.status(400).json({ error: 'items must contain product pid and positive integer qty' });
  }

  const quantities = new Map();
  for (const item of items) {
    quantities.set(item.pid, (quantities.get(item.pid) || 0) + item.qty);
  }
  if ([...quantities.values()].some((qty) => !Number.isSafeInteger(qty))) {
    return res.status(400).json({ error: 'total quantity for a product is too large' });
  }

  const order = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { pid: { in: [...quantities.keys()] } }
    });
    if (products.length !== quantities.size) {
      const error = new Error('one or more products were not found');
      error.status = 404;
      throw error;
    }

    for (const product of products) {
      const qty = quantities.get(product.pid);
      const stock = await tx.product.updateMany({
        where: { pid: product.pid, quantity: { gte: qty } },
        data: { quantity: { decrement: qty } }
      });
      if (stock.count !== 1) {
        const error = new Error(`insufficient stock for product ${product.pid}`);
        error.status = 409;
        throw error;
      }
    }

    return tx.order.create({
      data: {
        uid: req.user.uid,
        details: {
          create: products.map((product) => ({
            pid: product.pid,
            qty: quantities.get(product.pid),
            unitPrice: product.price
          }))
        }
      },
      include: { details: { include: { product: true } } }
    });
  });
  res.status(201).json(order);
}));

app.get('/api/orders', asyncHandler(async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { uid: req.user.uid };
  res.json(await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { details: true, shipments: true }
  }));
}));

app.get('/api/orders/:oid', validateId, asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { oid: req.resourceId },
    include: { details: { include: { product: true } }, shipments: true }
  });
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.uid !== req.user.uid && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(order);
}));

app.post('/api/orders/:oid/shipments', validateId, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (typeof status !== 'string' || !status.trim() || status.trim().length > 50) {
    return res.status(400).json({ error: 'status is required and must be at most 50 characters' });
  }
  const shipment = await prisma.shipment.create({
    data: { oid: req.resourceId, status: status.trim() }
  });
  res.status(201).json(shipment);
}));

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'resource not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'resource already exists' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'related resource does not exist' });
  }
  if (Number.isInteger(error.status)) return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
