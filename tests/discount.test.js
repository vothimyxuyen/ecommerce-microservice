const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTotals, discountPercentForScore } = require('../services/shared/discount');

test('uses the documented membership score discount tiers', () => {
  assert.equal(discountPercentForScore(0), 0);
  assert.equal(discountPercentForScore(99), 0);
  assert.equal(discountPercentForScore(100), 5);
  assert.equal(discountPercentForScore(499), 5);
  assert.equal(discountPercentForScore(500), 10);
});

test('calculates line totals and discounts in integer cents', () => {
  assert.deepEqual(
    calculateTotals([
      { price: 12.5, qty: 2 },
      { price: 0.1, qty: 1 }
    ], 5),
    { subtotal: 25.1, discount: 5, discountAmount: 1.26, totalAmount: 23.84 }
  );
});

test('rejects invalid scores, quantities, prices, and discount percentages', () => {
  assert.throws(() => discountPercentForScore(-1), /score/);
  assert.throws(() => calculateTotals([{ price: 1, qty: 0 }], 5), /valid/);
  assert.throws(() => calculateTotals([{ price: -1, qty: 1 }], 5), /valid/);
  assert.throws(() => calculateTotals([{ price: 1, qty: 1 }], 101), /between/);
});
