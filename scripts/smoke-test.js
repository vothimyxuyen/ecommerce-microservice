require('dotenv').config();

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3003').replace(/\/$/, '');

async function request(path, { token, method = 'GET', body, headers = {} } = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let responseBody = {};
  if (response.status !== 204) {
    responseBody = await response.json();
  }
  assert.equal(
    response.status,
    expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, got ${response.status}: ${responseBody.error || ''}`
  );
  return responseBody;
}

async function login(username, password) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password }
  }, 200);
  assert.ok(result.accessToken);
  return result.accessToken;
}

async function main() {
  const health = await request('/api/health', {}, 200);
  assert.equal(health.status, 'UP');

  await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'missing-password-smoke-test' }
  }, 400);
  await request('/api/auth/login', {
    method: 'POST',
    body: { username: process.env.SEED_ADMIN_USERNAME || 'admin', password: 'incorrect-password' }
  }, 401);

  const adminToken = await login(
    process.env.SEED_ADMIN_USERNAME || 'admin',
    process.env.SEED_ADMIN_PASSWORD
  );
  const shipmentToken = await login(
    process.env.SEED_SHIPMENT_USERNAME || 'shipment',
    process.env.SEED_SHIPMENT_PASSWORD
  );
  const suffix = randomUUID();
  const username = `smoke-${suffix.slice(0, 12)}`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      password: `Smoke-${suffix}-Pass`,
      email: `${username}@example.test`,
      fullname: 'Microservice Smoke Test',
      age: 25,
      address: 'Test address'
    }
  }, 201);
  assert.equal(registration.role, 'member');
  await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      password: `Smoke-${suffix}-Pass`,
      email: `${username}@example.test`,
      fullname: 'Microservice Smoke Test',
      age: 25,
      address: 'Test address'
    }
  }, 409);
  const memberToken = await login(username, `Smoke-${suffix}-Pass`);

  await request(`/api/customers/${registration.uid}`, {}, 401);
  const customer = await request(`/api/customers/${registration.uid}`, { token: memberToken }, 200);
  assert.equal(customer.fullname, 'Microservice Smoke Test');
  await request('/api/customers/2147483647', { token: memberToken }, 404);
  await request('/api/customers', { token: memberToken, method: 'POST', body: {} }, 403);
  const updatedCustomer = await request(`/api/customers/${registration.uid}`, {
    token: adminToken,
    method: 'PUT',
    body: { fullname: 'Updated Smoke Member' }
  }, 200);
  assert.equal(updatedCustomer.fullname, 'Updated Smoke Member');

  const membership = await request(`/api/customers/${registration.uid}/membership`, {
    token: memberToken
  }, 200);
  assert.equal(membership.score, 10);
  await request(`/api/customers/${registration.uid}/membership`, {
    token: adminToken,
    method: 'PATCH',
    body: { mid: 2, mname: `Smoke-${suffix.slice(0, 8)}`, score: 150 }
  }, 200);

  const createdProduct = await request('/api/products', {
    token: adminToken,
    method: 'POST',
    body: { pname: `Smoke ${suffix.slice(0, 8)}`, price: 12.5, quantity: 10 }
  }, 201);
  const rollbackProduct = await request('/api/products', {
    token: adminToken,
    method: 'POST',
    body: { pname: `Rollback ${suffix.slice(0, 8)}`, price: 0.5, quantity: 3 }
  }, 201);
  const productBeforeOrder = await request(`/api/products/${createdProduct.pid}`, { token: memberToken }, 200);
  assert.equal(productBeforeOrder.quantity, 10);
  await request('/api/products/2147483647', { token: memberToken }, 404);
  await request('/api/products', { token: memberToken, method: 'POST', body: {} }, 403);
  const updatedProduct = await request(`/api/products/${createdProduct.pid}`, {
    token: adminToken,
    method: 'PUT',
    body: { pname: createdProduct.pname, price: createdProduct.price, quantity: 10 }
  }, 200);
  assert.equal(updatedProduct.quantity, 10);
  const listedProducts = await request('/api/products', { token: memberToken }, 200);
  assert.ok(listedProducts.items.some((item) => item.pid === createdProduct.pid));

  const items = [{ pid: createdProduct.pid, qty: 2 }];
  await request('/api/orders', { method: 'POST', body: { items } }, 401);
  const idempotencyKey = `smoke-${suffix}`;
  const order = await request('/api/orders', {
    token: memberToken,
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: { items }
  }, 201);
  assert.equal(order.discount, 5);
  assert.equal(order.subtotal, 25);
  assert.equal(order.discount_amount, 1.25);
  assert.equal(order.total_amount, 23.75);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].qty, 2);
  const retriedOrder = await request('/api/orders', {
    token: memberToken,
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: { items }
  }, 201);
  assert.equal(retriedOrder.oid, order.oid);

  const orderDetails = await request(`/api/orders/${order.oid}`, { token: memberToken }, 200);
  assert.equal(orderDetails.items[0].unit_price, 12.5);
  const productAfterOrder = await request(`/api/products/${createdProduct.pid}`, { token: memberToken }, 200);
  assert.equal(productAfterOrder.quantity, 8);

  await request('/api/orders', {
    token: memberToken,
    method: 'POST',
    body: { items: [{ pid: createdProduct.pid, qty: 1 }, { pid: rollbackProduct.pid, qty: 100 }] }
  }, 409);
  const productAfterRejectedOrder = await request(`/api/products/${createdProduct.pid}`, { token: memberToken }, 200);
  assert.equal(productAfterRejectedOrder.quantity, 8);
  const rollbackProductAfterRejectedOrder = await request(`/api/products/${rollbackProduct.pid}`, { token: memberToken }, 200);
  assert.equal(rollbackProductAfterRejectedOrder.quantity, 3);

  await request('/api/shipments/order/2147483647', { token: memberToken }, 404);
  let shipment;
  const deadline = Date.now() + 15000;
  while (!shipment && Date.now() < deadline) {
    try {
      shipment = await request(`/api/shipments/order/${order.oid}`, { token: memberToken }, 200);
    } catch (error) {
      if (!String(error.message).includes('expected 200, got 404')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(shipment, 'OrderCreated event did not result in a shipment within 15 seconds');
  assert.equal(shipment.status, 'PENDING');
  await request(`/api/shipments/${shipment.shipid}/status`, {
    token: memberToken,
    method: 'PATCH',
    body: { status: 'SHIPPING' }
  }, 403);
  await request(`/api/shipments/${shipment.shipid}/status`, {
    token: shipmentToken,
    method: 'PATCH',
    body: { status: 'INVALID' }
  }, 400);
  const shipping = await request(`/api/shipments/${shipment.shipid}/status`, {
    token: shipmentToken,
    method: 'PATCH',
    body: { status: 'SHIPPING' }
  }, 200);
  assert.equal(shipping.status, 'SHIPPING');
  const delivered = await request(`/api/shipments/${shipment.shipid}/status`, {
    token: shipmentToken,
    method: 'PATCH',
    body: { status: 'DELIVERED' }
  }, 200);
  assert.equal(delivered.status, 'DELIVERED');
  await request(`/api/shipments/${shipment.shipid}/status`, {
    token: shipmentToken,
    method: 'PATCH',
    body: { status: 'SHIPPING' }
  }, 409);
  const unchanged = await request(`/api/shipments/${shipment.shipid}/status`, {
    token: shipmentToken,
    method: 'PATCH',
    body: { status: 'DELIVERED' }
  }, 200);
  assert.equal(unchanged.status, 'DELIVERED');

  await request('/api/auth/logout', { token: memberToken, method: 'POST' }, 200);
  await request('/api/orders', { token: memberToken }, 401);
  console.log(`PASS auth validation/RBAC, customer and product CRUD, membership discount, idempotent order, inventory rollback, Kafka shipment lifecycle and logout (order ${order.oid}).`);
}

main().catch((error) => {
  console.error('E-commerce microservice smoke test failed:', error);
  process.exitCode = 1;
});
