function discountPercentForScore(score) {
  if (!Number.isSafeInteger(score) || score < 0) {
    throw new TypeError('membership score must be a non-negative integer');
  }
  if (score >= 500) return 10;
  if (score >= 100) return 5;
  return 0;
}

function calculateTotals(items, discountPercent) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('at least one order item is required');
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new TypeError('discount percent must be between 0 and 100');
  }
  const subtotalCents = items.reduce((total, item) => {
    const cents = Math.round(Number(item.price) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0 ||
        !Number.isSafeInteger(item.qty) || item.qty <= 0) {
      throw new TypeError('order prices and quantities must be valid');
    }
    const line = cents * item.qty;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) {
      throw new RangeError('order subtotal exceeds supported amount');
    }
    return total + line;
  }, 0);
  const discountCents = Math.round(subtotalCents * discountPercent / 100);
  return {
    subtotal: subtotalCents / 100,
    discount: discountPercent,
    discountAmount: discountCents / 100,
    totalAmount: (subtotalCents - discountCents) / 100
  };
}

module.exports = { calculateTotals, discountPercentForScore };
