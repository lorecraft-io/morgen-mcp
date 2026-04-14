import { describe, it, expect } from "vitest";
import {
  validateId,
  validateDate,
  validateISODate,
  validateEnum,
  validateStringArray,
  toFloatingDateTime,
} from "../src/validation.js";

// ---------------------------------------------------------------------------
// validateId
// ---------------------------------------------------------------------------
describe("validateId", () => {
  it("accepts valid alphanumeric IDs", () => {
    expect(validateId("abc123", "id")).toBe("abc123");
  });

  it("accepts IDs with hyphens and underscores", () => {
    expect(validateId("my-task_01", "id")).toBe("my-task_01");
  });

  it("accepts IDs with dots (Morgen allows)", () => {
    expect(validateId("some.thing", "id")).toBe("some.thing");
  });

  it("accepts email-style IDs with @ (Morgen allows)", () => {
    expect(validateId("user@example.com", "id")).toBe("user@example.com");
  });

  it("rejects empty string", () => {
    expect(() => validateId("", "id")).toThrow("id is required and must be a string");
  });

  it("rejects null", () => {
    expect(() => validateId(null, "id")).toThrow("id is required and must be a string");
  });

  it("rejects undefined", () => {
    expect(() => validateId(undefined, "id")).toThrow("id is required and must be a string");
  });

  it("rejects strings with slashes (path traversal)", () => {
    expect(() => validateId("../../etc/passwd", "id")).toThrow("id contains invalid characters");
  });

  it("rejects strings with spaces", () => {
    expect(() => validateId("has spaces", "id")).toThrow("id contains invalid characters");
  });

  it("rejects strings over 500 chars", () => {
    const longId = "a".repeat(501);
    expect(() => validateId(longId, "id")).toThrow("id contains invalid characters");
  });

  it("accepts strings exactly 500 chars", () => {
    const maxId = "a".repeat(500);
    expect(validateId(maxId, "id")).toBe(maxId);
  });

  it("rejects non-string types (number)", () => {
    expect(() => validateId(12345, "id")).toThrow("id is required and must be a string");
  });

  it("rejects SQL injection attempts", () => {
    expect(() => validateId("'; DROP TABLE users; --", "id")).toThrow("id contains invalid characters");
  });

  it("rejects XSS payloads", () => {
    expect(() => validateId('<script>alert("x")</script>', "id")).toThrow("id contains invalid characters");
  });
});

// ---------------------------------------------------------------------------
// validateDate
// ---------------------------------------------------------------------------
describe("validateDate", () => {
  it("accepts valid YYYY-MM-DD", () => {
    expect(validateDate("2024-01-15", "date")).toBe("2024-01-15");
  });

  it("accepts boundary dates", () => {
    expect(validateDate("2000-01-01", "date")).toBe("2000-01-01");
    expect(validateDate("9999-12-31", "date")).toBe("9999-12-31");
  });

  it("rejects DD-MM-YYYY", () => {
    expect(() => validateDate("15-01-2024", "date")).toThrow("date must be in YYYY-MM-DD format");
  });

  it("rejects MM/DD/YYYY", () => {
    expect(() => validateDate("01/15/2024", "date")).toThrow("date must be in YYYY-MM-DD format");
  });

  it("rejects empty string", () => {
    expect(() => validateDate("", "date")).toThrow("date is required");
  });

  it("rejects non-string input (number)", () => {
    expect(() => validateDate(20240115, "date")).toThrow("date is required");
  });

  it("rejects non-string input (null)", () => {
    expect(() => validateDate(null, "date")).toThrow("date is required");
  });

  it("rejects non-string input (undefined)", () => {
    expect(() => validateDate(undefined, "date")).toThrow("date is required");
  });

  it("rejects date with extra text appended", () => {
    expect(() => validateDate("2024-01-15T00:00:00Z", "date")).toThrow("date must be in YYYY-MM-DD format");
  });

  it("rejects date with extra text prepended", () => {
    expect(() => validateDate("date:2024-01-15", "date")).toThrow("date must be in YYYY-MM-DD format");
  });
});

// ---------------------------------------------------------------------------
// validateISODate
// ---------------------------------------------------------------------------
describe("validateISODate", () => {
  it("accepts valid ISO 8601 timestamps", () => {
    expect(validateISODate("2024-01-15T10:30:00Z", "start")).toBe("2024-01-15T10:30:00Z");
  });

  it("accepts ISO 8601 with timezone offset", () => {
    expect(validateISODate("2024-01-15T10:30:00+05:00", "start")).toBe("2024-01-15T10:30:00+05:00");
  });

  it("rejects plain date strings without time component", () => {
    expect(() => validateISODate("2024-01-15", "start")).toThrow("start must be a valid ISO 8601 date-time string");
  });

  it('rejects "not-a-date"', () => {
    expect(() => validateISODate("not-a-date", "start")).toThrow("start must be a valid ISO 8601 date-time string");
  });

  it("rejects empty string", () => {
    expect(() => validateISODate("", "start")).toThrow("start is required");
  });

  it("rejects null", () => {
    expect(() => validateISODate(null, "start")).toThrow("start is required");
  });

  it("rejects undefined", () => {
    expect(() => validateISODate(undefined, "start")).toThrow("start is required");
  });

  it("rejects random garbage strings", () => {
    expect(() => validateISODate("abc123xyz", "start")).toThrow("start must be a valid ISO 8601 date-time string");
  });
});

// ---------------------------------------------------------------------------
// validateEnum
// ---------------------------------------------------------------------------
describe("validateEnum", () => {
  const statuses = ["active", "pending", "completed"];

  it("accepts valid enum values", () => {
    expect(validateEnum("active", statuses, "status")).toBe("active");
    expect(validateEnum("pending", statuses, "status")).toBe("pending");
    expect(validateEnum("completed", statuses, "status")).toBe("completed");
  });

  it("rejects invalid enum values", () => {
    expect(() => validateEnum("deleted", statuses, "status")).toThrow(
      "status must be one of: active, pending, completed"
    );
  });

  it("passes through undefined (optional fields)", () => {
    expect(validateEnum(undefined, statuses, "status")).toBeUndefined();
  });

  it("passes through null (optional fields)", () => {
    expect(validateEnum(null, statuses, "status")).toBeNull();
  });

  it("rejects empty string when not in allowed list", () => {
    expect(() => validateEnum("", statuses, "status")).toThrow("status must be one of:");
  });

  it("is case-sensitive", () => {
    expect(() => validateEnum("Active", statuses, "status")).toThrow("status must be one of:");
  });
});

// ---------------------------------------------------------------------------
// validateStringArray
// ---------------------------------------------------------------------------
describe("validateStringArray", () => {
  it("accepts valid string arrays", () => {
    const arr = ["one", "two", "three"];
    expect(validateStringArray(arr, "tags")).toEqual(arr);
  });

  it("accepts empty arrays", () => {
    expect(validateStringArray([], "tags")).toEqual([]);
  });

  it("rejects non-arrays (string)", () => {
    expect(() => validateStringArray("not-an-array", "tags")).toThrow("tags must be an array");
  });

  it("rejects non-arrays (number)", () => {
    expect(() => validateStringArray(123, "tags")).toThrow("tags must be an array");
  });

  it("rejects non-arrays (null)", () => {
    expect(() => validateStringArray(null, "tags")).toThrow("tags must be an array");
  });

  it("rejects non-arrays (object)", () => {
    expect(() => validateStringArray({ a: 1 }, "tags")).toThrow("tags must be an array");
  });

  it("rejects arrays with non-string items (numbers)", () => {
    expect(() => validateStringArray(["valid", 42], "tags")).toThrow("tags must contain only strings");
  });

  it("rejects arrays with non-string items (null)", () => {
    expect(() => validateStringArray(["valid", null], "tags")).toThrow("tags must contain only strings");
  });

  it("rejects arrays with non-string items (objects)", () => {
    expect(() => validateStringArray(["valid", {}], "tags")).toThrow("tags must contain only strings");
  });

  it("rejects arrays exceeding maxItems (default 50)", () => {
    const arr = Array(51).fill("item");
    expect(() => validateStringArray(arr, "tags")).toThrow("tags exceeds maximum of 50 items");
  });

  it("accepts arrays at exactly maxItems", () => {
    const arr = Array(50).fill("item");
    expect(validateStringArray(arr, "tags")).toHaveLength(50);
  });

  it("rejects arrays exceeding custom maxItems", () => {
    const arr = Array(6).fill("item");
    expect(() => validateStringArray(arr, "tags", 5)).toThrow("tags exceeds maximum of 5 items");
  });

  it("accepts arrays at exactly custom maxItems", () => {
    const arr = Array(5).fill("item");
    expect(validateStringArray(arr, "tags", 5)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// toFloatingDateTime
// ---------------------------------------------------------------------------
describe("toFloatingDateTime", () => {
  it("strips -HH:MM offset", () => {
    expect(toFloatingDateTime("2026-04-14T00:00:00-04:00")).toBe("2026-04-14T00:00:00");
  });

  it("strips +HH:MM offset", () => {
    expect(toFloatingDateTime("2026-04-20T17:00:00+05:30")).toBe("2026-04-20T17:00:00");
  });

  it("strips Z suffix with milliseconds", () => {
    expect(toFloatingDateTime("2026-04-14T23:59:00.000Z")).toBe("2026-04-14T23:59:00");
  });

  it("strips Z suffix without milliseconds", () => {
    expect(toFloatingDateTime("2026-04-14T23:59:00Z")).toBe("2026-04-14T23:59:00");
  });

  it("passes through already-floating datetime (no offset)", () => {
    expect(toFloatingDateTime("2026-04-14T14:00:00")).toBe("2026-04-14T14:00:00");
  });

  it("passes through date-only string unchanged", () => {
    expect(toFloatingDateTime("2026-04-14")).toBe("2026-04-14");
  });

  it("passes through non-string values unchanged", () => {
    expect(toFloatingDateTime(null)).toBeNull();
    expect(toFloatingDateTime(undefined)).toBeUndefined();
  });
});

// The rolling point-based rate limiter lives in src/client.js and is
// exercised by tests/client.test.js. No limiter is exported from validation.
