function envString(key, fallback = '') {
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
}

function envNumber(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBigInt(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

module.exports = {
  envString,
  envNumber,
  envBigInt,
};
