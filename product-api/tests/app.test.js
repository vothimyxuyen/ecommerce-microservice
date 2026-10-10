const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');

test('health check reports the database as disconnected before startup', async () => {
  assert.notEqual(mongoose.connection.readyState, 1);
  const response = await request(app).get('/health');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    status: 'unavailable',
    database: 'disconnected'
  });
});
