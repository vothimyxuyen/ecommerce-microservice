require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Product = require('../models/product');

const mongoUri = process.env.MONGODB_URI;

test('Product CRUD API with MongoDB', async (t) => {
  assert.ok(mongoUri, 'MONGODB_URI must be set for integration tests');
  await mongoose.connect(mongoUri);
  const pid = `p-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  t.after(async () => {
    await Product.deleteOne({ pid });
    await mongoose.disconnect();
  });

  const created = await request(app)
    .post('/api/products')
    .send({ pid, pname: 'Notebook', price: 4.5, quantity: 8 });
  assert.equal(created.status, 201);
  assert.equal(created.body.pid, pid);

  const listed = await request(app).get('/api/products');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.some((product) => product.pid === pid));

  const fetched = await request(app).get(`/api/products/${pid}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.pname, 'Notebook');

  const updated = await request(app)
    .put(`/api/products/${pid}`)
    .send({ pid, pname: 'Notebook XL', price: 6, quantity: 3 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.pname, 'Notebook XL');

  const deleted = await request(app).delete(`/api/products/${pid}`);
  assert.equal(deleted.status, 204);
  assert.equal((await request(app).get(`/api/products/${pid}`)).status, 404);

  const health = await request(app).get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.database, 'connected');
});
