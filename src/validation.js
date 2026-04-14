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

// Morgen's task `due` field uses JSCalendar floating local datetimes
// (RFC 8984 §3.3) — no timezone offset, no Z suffix. The IANA timezone
// is stored separately in the `timeZone` field. Strip any trailing offset
// (+HH:MM / -HH:MM / Z) and optional milliseconds before POSTing to
// Morgen's /v3/tasks/create and /v3/tasks/update endpoints, which reject
// offset-aware strings with HTTP 400.
//
// Pass-through for date-only strings (YYYY-MM-DD) and already-floating
// strings (YYYY-MM-DDTHH:MM:SS) — they have no offset to strip.
// Pass-through for non-string values (null/undefined) — callers guard
// before calling this, but safe to be defensive here.
export function toFloatingDateTime(value) {
  if (typeof value !== "string") return value;
  return value.replace(/(\.\d+)?([+-]\d{2}:\d{2}|Z)$/, "");
}
