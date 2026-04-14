// Security test suite for morgen-mcp — content-field attacks.
//
// SCOPE: Attack scenarios against content fields (title, description,
// participants, etc.). Covers XSS payloads, oversized/DoS inputs, and CRLF
// header injection via args.
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
// 3. XSS payloads
// ---------------------------------------------------------------------------
describe("security: XSS payloads", () => {
  const xssPayloads = [
    "<script>alert('x')</script>",
    "javascript:alert(1)",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)>",
  ];

  it.each(xssPayloads)("validateId rejects XSS payload %s in IDs", (payload) => {
    expect(() => validateId(payload, "calendar_id")).toThrow(/invalid characters/);
  });

  it("create_event accepts XSS payload as plain text in title (Morgen escapes server-side)", async () => {
    const spy = installFetchSpy(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ event: { id: "evt-1", title: "<script>alert('x')</script>" } }),
    }));

    const result = await eventHandlers.create_event({
      calendar_id: "cal-ok",
      title: "<script>alert('x')</script>",
      start: "2026-04-13T10:00:00Z",
      end: "2026-04-13T11:00:00Z",
      description: "javascript:alert(1)",
    });

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalled();
    // Confirm the payload was passed through as plain text (not stripped or escaped by us).
    const call = spy.mock.calls[0];
    const bodyStr = call[1].body;
    expect(bodyStr).toContain("<script>");
  });

  it("rejects oversized XSS payload in title that exceeds length limit", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    const huge = "<script>" + "a".repeat(600) + "</script>";
    await expect(
      eventHandlers.create_event({
        calendar_id: "cal-ok",
        title: huge,
        start: "2026-04-13T10:00:00Z",
        end: "2026-04-13T11:00:00Z",
      })
    ).rejects.toThrow(/500 characters or fewer/);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Oversized inputs (DoS prevention)
// ---------------------------------------------------------------------------
describe("security: oversized inputs are rejected before fetch", () => {
  it("rejects 10 MB title string", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    const tenMB = "A".repeat(10 * 1024 * 1024);
    await expect(
      eventHandlers.create_event({
        calendar_id: "cal-ok",
        title: tenMB,
        start: "2026-04-13T10:00:00Z",
        end: "2026-04-13T11:00:00Z",
      })
    ).rejects.toThrow(/title/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects 100k-char description", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    const huge = "d".repeat(100_000);
    await expect(
      eventHandlers.create_event({
        calendar_id: "cal-ok",
        title: "ok",
        start: "2026-04-13T10:00:00Z",
        end: "2026-04-13T11:00:00Z",
        description: huge,
      })
    ).rejects.toThrow(/description/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects oversized ID (> 500 chars)", () => {
    const hugeId = "a".repeat(501);
    expect(() => validateId(hugeId, "event_id")).toThrow(/invalid characters/);
  });

  it("rejects participants array exceeding maxItems", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    const tooMany = Array(500).fill("user@example.com");
    await expect(
      eventHandlers.create_event({
        calendar_id: "cal-ok",
        title: "ok",
        start: "2026-04-13T10:00:00Z",
        end: "2026-04-13T11:00:00Z",
        participants: tooMany,
      })
    ).rejects.toThrow(/participants exceeds maximum/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects recurrence_rules array exceeding maxItems", async () => {
    const spy = installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    const tooMany = Array(100).fill("RRULE:FREQ=DAILY");
    await expect(
      eventHandlers.create_event({
        calendar_id: "cal-ok",
        title: "ok",
        start: "2026-04-13T10:00:00Z",
        end: "2026-04-13T11:00:00Z",
        recurrence_rules: tooMany,
      })
    ).rejects.toThrow(/recurrence_rules exceeds maximum/);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. Header injection via args (CRLF injection)
// ---------------------------------------------------------------------------
describe("security: header injection via args", () => {
  it("CRLF sequences in title are serialized via JSON and cannot inject HTTP headers", async () => {
    const spy = installFetchSpy(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ event: { id: "evt-1" } }),
    }));

    const malicious = "foo\r\nX-Injected: true\r\nAuthorization: ApiKey stolen";

    await eventHandlers.create_event({
      calendar_id: "cal-ok",
      title: malicious,
      start: "2026-04-13T10:00:00Z",
      end: "2026-04-13T11:00:00Z",
    });

    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[0];
    const init = call[1];

    // Headers are an object literal constructed inside morgenHeaders() — the
    // user title NEVER appears as a header key.
    const headerKeys = Object.keys(init.headers || {});
    expect(headerKeys).not.toContain("X-Injected");
    expect(headerKeys.find((k) => /injected/i.test(k))).toBeUndefined();

    // The malicious string appears in the JSON body, where it is safely
    // escaped (\r\n become literal \r \n characters inside a JSON string).
    expect(typeof init.body).toBe("string");
    expect(init.body).toContain("\\r\\n");
    // And it never appears as a raw CRLF sequence in any header value.
    for (const v of Object.values(init.headers || {})) {
      expect(String(v)).not.toMatch(/\r|\n/);
    }
  });

  it("CRLF in description does not leak into request headers", async () => {
    const spy = installFetchSpy(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ event: { id: "evt-1" } }),
    }));

    await eventHandlers.create_event({
      calendar_id: "cal-ok",
      title: "ok",
      start: "2026-04-13T10:00:00Z",
      end: "2026-04-13T11:00:00Z",
      description: "line1\r\nSet-Cookie: evil=1\r\nline2",
    });

    const init = spy.mock.calls[0][1];
    for (const [k, v] of Object.entries(init.headers || {})) {
      expect(k).not.toMatch(/cookie/i);
      expect(String(v)).not.toMatch(/\r|\n/);
    }
  });
});
