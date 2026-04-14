// Input validation utilities
export function validateId(value, name) {
  if (!value || typeof value !== "string") throw new Error(`${name} is required and must be a string`);
  if (value.length > 500 || !/^[\w\-.@]+$/.test(value)) throw new Error(`${name} contains invalid characters`);
  return value;
}

export function validateDate(value, name) {
  if (!value || typeof value !== "string") throw new Error(`${name} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be in YYYY-MM-DD format`);
  return value;
}

export function validateISODate(value, name) {
  if (!value || typeof value !== "string") throw new Error(`${name} is required`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 date-time string (e.g. 2026-04-03T14:00:00.000Z)`);
  }
  return value;
}

export function validateEnum(value, allowed, name) {
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

export function validateStringArray(value, name, maxItems = 50) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  if (value.length > maxItems) throw new Error(`${name} exceeds maximum of ${maxItems} items`);
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${name} must contain only strings`);
  }
  return value;
}

export function validateIntegerRange(value, name, min, max) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}
