// Security test suite for morgen-mcp — input traversal/injection/unicode.
//
// SCOPE: Attack scenarios where IDs must be rejected by validateId before any
// fetch is issued. Covers path traversal, SQL injection patterns, and unicode
// normalization tricks.
//
// The handlers under test live in src/tools-events.js and src/tools-tasks.js
// and call morgenFetch in src/client.js. Where we need to observe fetch
// behavior we stub globalThis.fetch directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateId,
  validateStringArray,
} from "../src/validation.js";
import { morgenFetch, _resetRateLimiter } from "../src/client.js";
import { eventHandlers } from "../src/tools-events.js";
import { taskHandlers } from "../src/tools-tasks.js";
import {
  _resetCalendarCache,
  _seedCalendarCache,
} from "../src/calendar-cache.js";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

function installFetchSpy(impl) {
  const spy = vi.fn(impl);
  globalThis.fetch = spy;
  return spy;
}

function restoreEnvAndFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
}

beforeEach(() => {
  _resetRateLimiter();
  _resetCalendarCache();
  // Seed a known calendar so handlers that look up accountId via the cache
  // don't attempt a real fetch during security tests that install a fetch
  // spy expecting no calls.
  _seedCalendarCache([
    { id: "cal-ok", accountId: "acct-ok", name: "Test Calendar" },
  ]);
  process.env.MORGEN_API_KEY = "test-key-placeholder";
});

afterEach(() => {
  restoreEnvAndFetch();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Path traversal in IDs
// ---------------------------------------------------------------------------
describe("security: path traversal in IDs", () => {
  const traversalPayloads = [
    "../../etc/passwd",
    "../secret",
    "..%2F..%2Fetc%2Fpasswd",
    "..\\..\\windows\\system32",
    "/etc/passwd",
    "%2e%2e%2f",
  ];

  it.each(traversalPayloads)(
    "validateId rejects path-traversal payload %s",
    (payload) => {
      expect(() => validateId(payload, "calendar_id")).toThrow(/invalid characters/);
    }
  );

  it("update_event handler rejects traversal in event_id before any fetch is issued", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    await expect(
      eventHandlers.update_event({
        event_id: "../../etc/passwd",
        calendar_id: "cal-ok",
        title: "noop",
      })
    ).rejects.toThrow(/invalid characters/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("delete_event handler rejects traversal in calendar_id before any fetch is issued", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    await expect(
      eventHandlers.delete_event({
        event_id: "evt-ok",
        calendar_id: "..%2F..%2Fetc%2Fpasswd",
      })
    ).rejects.toThrow(/invalid characters/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("update_task rejects traversal in task id", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    await expect(
      taskHandlers.update_task({ task_id: "../secret", title: "noop" })
    ).rejects.toThrow(/invalid characters/);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. SQL injection patterns in IDs
// ---------------------------------------------------------------------------
describe("security: SQL injection patterns in IDs", () => {
  const sqlPayloads = [
    "'; DROP TABLE users; --",
    "1 OR 1=1",
    "1' UNION SELECT * FROM secrets--",
    "admin'--",
    "\" OR \"\"=\"",
  ];

  it.each(sqlPayloads)("validateId rejects SQL payload %s", (payload) => {
    expect(() => validateId(payload, "event_id")).toThrow(/invalid characters/);
  });

  it("rsvp_event rejects SQL payload in event_id before any fetch", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    await expect(
      eventHandlers.rsvp_event({
        event_id: "'; DROP TABLE users; --",
        calendar_id: "cal-ok",
        response: "accept",
      })
    ).rejects.toThrow(/invalid characters/);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. Unicode normalization attacks
// ---------------------------------------------------------------------------
describe("security: unicode normalization in IDs", () => {
  // JavaScript's \w in a non-u regex is ASCII-only: [A-Za-z0-9_]. These
  // payloads contain non-ASCII characters and must be rejected.
  const unicodePayloads = {
    "zero-width space": "abc\u200Bdef",
    "zero-width joiner": "abc\u200Ddef",
    "RTL override": "abc\u202Edef",
    "LTR override": "abc\u202Ddef",
    "BOM": "\uFEFFabc",
    "fullwidth digits": "\uFF11\uFF12\uFF13",
    "cyrillic lookalike 'a'": "\u0430bc",
    "combining acute": "a\u0301bc",
    "null byte": "abc\u0000def",
  };

  for (const [label, payload] of Object.entries(unicodePayloads)) {
    it(`rejects ID containing ${label}`, () => {
      expect(() => validateId(payload, "calendar_id")).toThrow(/invalid characters/);
    });
  }

  it("rejects unicode trick IDs when passed through handlers before fetch", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });

    await expect(
      eventHandlers.rsvp_event({
        event_id: "evt\u202Edrowssap",
        calendar_id: "cal-ok",
        response: "accept",
      })
    ).rejects.toThrow(/invalid characters/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("validateStringArray of calendar_ids rejects the batch when any entry contains a zero-width character", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    await expect(
      eventHandlers.list_events({
        start: "2026-04-13T00:00:00Z",
        end: "2026-04-14T00:00:00Z",
        calendar_ids: ["cal-ok", "cal\u200Bevil"],
      })
    ).rejects.toThrow(/invalid characters/);
    expect(spy).not.toHaveBeenCalled();
  });
});
