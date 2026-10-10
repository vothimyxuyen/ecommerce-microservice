const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const pid = `smoke-${randomUUID()}`;
let productCreated = false;

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options.headers
    }
  });
  const body = response.status === 204 ? null : await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method || 'GET'} ${path}: expected ${expectedStatus}, received ${response.status}`
  );
  return body;
}

async function main() {
  const health = await request('/health', {}, 200);
  assert.equal(health.database, 'connected');

  const created = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify({ pid, pname: 'Smoke Test Product', price: 1.25, quantity: 2 })
  }, 201);
  productCreated = true;
  assert.equal(created.pid, pid);

  const fetched = await request(`/api/products/${encodeURIComponent(pid)}`, {}, 200);
  assert.equal(fetched.pname, 'Smoke Test Product');

  const updated = await request(`/api/products/${encodeURIComponent(pid)}`, {
    method: 'PUT',
    body: JSON.stringify({ pid, pname: 'Smoke Test Product Updated', price: 2.5, quantity: 1 })
  }, 200);
  assert.equal(updated.pname, 'Smoke Test Product Updated');

  await request(`/api/products/${encodeURIComponent(pid)}`, { method: 'DELETE' }, 204);
  productCreated = false;
  console.log('Product API smoke test passed.');
}

main().catch(async (error) => {
  if (productCreated) {
    try {
      await fetch(`${baseUrl}/api/products/${encodeURIComponent(pid)}`, { method: 'DELETE' });
    } catch (cleanupError) {
      console.error('Failed to clean up smoke-test product:', cleanupError);
    }
  }
  console.error('Product API smoke test failed:', error);
  process.exitCode = 1;
});
