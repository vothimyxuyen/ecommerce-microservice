function requireInteger(value, name, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    const error = new Error(`${name} must be an integer >= ${minimum}`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function requireText(value, name, maximum = 255) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    const error = new Error(`${name} is required and must be at most ${maximum} characters`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

module.exports = { requireInteger, requireText };
