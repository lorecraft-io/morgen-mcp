// Security test suite for morgen-mcp.
//
// SCOPE: Attack scenarios only. Basic validator behavior is covered in
// tests/validation.test.js. This file tests the SECURITY PROPERTIES of the
// server under adversarial input — path traversal, injection, oversized
// payloads, prototype pollution, secret leakage in errors, header injection,
// and unicode normalization.
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
// 5. Prototype pollution
// ---------------------------------------------------------------------------
describe("security: prototype pollution", () => {
  it("does not pollute Object.prototype via __proto__ in event args", async () => {
    installFetchSpy(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ event: { id: "evt-1" } }),
    }));

    const polluted = JSON.parse(
      '{"calendar_id":"cal-ok","title":"ok","start":"2026-04-13T10:00:00Z","end":"2026-04-13T11:00:00Z","__proto__":{"isAdmin":true}}'
    );

    // Handler may succeed or silently ignore the key; either way no pollution.
    await eventHandlers.create_event(polluted).catch(() => {});

    const probe = {};
    expect(probe.isAdmin).toBeUndefined();
    expect(Object.prototype.isAdmin).toBeUndefined();
  });

  it("does not pollute via constructor.prototype in task args", async () => {
    installFetchSpy(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ task: { id: "t-1" } }),
    }));

    const polluted = JSON.parse(
      '{"title":"ok","constructor":{"prototype":{"polluted":true}}}'
    );

    await taskHandlers.create_task(polluted).catch(() => {});

    const probe = {};
    expect(probe.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it("does not leak implementation details in the error message on prototype pollution attempt", async () => {
    installFetchSpy(() => {
      throw new Error("fetch should not have been called");
    });
    const polluted = JSON.parse('{"__proto__":{"isAdmin":true}}');

    let caught;
    try {
      await eventHandlers.update_event(polluted);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Error should be a validation error, not a stack trace or internal file path.
    expect(caught.message).not.toMatch(/node:internal/);
    expect(caught.message).not.toMatch(/at [A-Z]:\\/); // windows abs path
    expect(caught.message).not.toMatch(/\/src\/tools-events\.js/);
  });
});

// ---------------------------------------------------------------------------
// 6. API key leakage in errors
// ---------------------------------------------------------------------------
describe("security: API key leakage in errors", () => {
  const SECRET_KEY = "sk-morgen-super-secret-abcdef123456";

  it("errors surfaced from fetch failures must not contain the API key", async () => {
    process.env.MORGEN_API_KEY = SECRET_KEY;

    // Simulate a fetch failure where the underlying error message inadvertently
    // contains the key (e.g. from a verbose debug proxy).
    installFetchSpy(async () => {
      throw new Error(
        `connect ECONNREFUSED with auth header ApiKey ${SECRET_KEY}`
      );
    });

    let caught;
    try {
      await morgenFetch("/v3/calendars/list", { points: 1 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // This assertion documents the SECURITY INVARIANT: the key must never
    // reach callers via error messages. If this test fails, morgenFetch is
    // re-throwing raw fetch errors unredacted — that is a real vulnerability
    // and the client must sanitize before rethrowing.
    expect(caught.message).not.toContain(SECRET_KEY);
    expect(caught.message).not.toContain("ApiKey sk-");
  });

  it("errors from HTTP 4xx responses must not contain the API key", async () => {
    process.env.MORGEN_API_KEY = SECRET_KEY;

    installFetchSpy(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ error: `Unauthorized key ${SECRET_KEY}` }),
    }));

    let caught;
    try {
      await morgenFetch("/v3/calendars/list", { points: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).not.toContain(SECRET_KEY);
  });

  it("does not log or echo MORGEN_API_KEY into error payloads passed up from handlers", async () => {
    process.env.MORGEN_API_KEY = SECRET_KEY;
    installFetchSpy(async () => {
      throw new Error(`something bad ${SECRET_KEY}`);
    });

    let caught;
    try {
      await eventHandlers.list_events({
        start: "2026-04-13T00:00:00Z",
        end: "2026-04-14T00:00:00Z",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(String(caught.message || caught)).not.toContain(SECRET_KEY);
  });
});

// ---------------------------------------------------------------------------
// 7. URL leakage in errors
// ---------------------------------------------------------------------------
describe("security: URL leakage in errors", () => {
  it("HTTP error messages must not contain full Morgen base URL with query strings", async () => {
    installFetchSpy(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
    }));

    let caught;
    try {
      await morgenFetch("/v3/events/list?calendarIds=cal1&start=2026-04-13T00:00:00Z", {
        points: 1,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // The path may appear, but the full URL plus query string should not leak
    // into unsanitized user-facing messages. At minimum the host+query combo
    // must not appear verbatim with secrets.
    expect(caught.message).not.toMatch(/https:\/\/sync\.morgen\.so.*apiKey=/i);
    expect(caught.message).not.toMatch(/https:\/\/sync\.morgen\.so.*token=/i);
  });

  it("fetch rejection messages containing the full URL do not leak unsanitized to handler callers", async () => {
    const LEAKY_URL =
      "https://sync.morgen.so/v3/events/list?apiKey=sk-leak-123&calendarIds=cal1";

    installFetchSpy(async () => {
      throw new Error(`request failed: ${LEAKY_URL}`);
    });

    let caught;
    try {
      await eventHandlers.list_events({
        start: "2026-04-13T00:00:00Z",
        end: "2026-04-14T00:00:00Z",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // This is a SECURITY INVARIANT assertion: even if the upstream error
    // contains the URL+key, the client must strip it before bubbling up.
    expect(caught.message).not.toContain("apiKey=sk-leak-123");
  });
});

// ---------------------------------------------------------------------------
// 8. Request method coercion
// ---------------------------------------------------------------------------
describe("security: request method coercion", () => {
  it("passes only whitelisted methods to fetch when called from handlers", async () => {
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
    });

    const seenMethods = spy.mock.calls.map((c) => (c[1] && c[1].method) || "GET");
    for (const m of seenMethods) {
      expect(["GET", "POST", "PUT", "DELETE", "PATCH"]).toContain(m);
    }
  });

  it("arbitrary method values injected into args do not change the outbound HTTP method", async () => {
    const spy = installFetchSpy(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ event: { id: "evt-1" } }),
    }));

    // Handler callers should never be able to influence HTTP method via args.
    // tools-events.js selects the method internally per tool.
    await eventHandlers.create_event({
      calendar_id: "cal-ok",
      title: "ok",
      start: "2026-04-13T10:00:00Z",
      end: "2026-04-13T11:00:00Z",
      method: "CONNECT",
      __method: "../GET",
    });

    const call = spy.mock.calls[0];
    const actualMethod = (call[1] && call[1].method) || "GET";
    expect(actualMethod).toBe("POST");
    expect(actualMethod).not.toBe("CONNECT");
    expect(actualMethod).not.toContain("..");
  });

  // NOTE: morgenFetch itself exposes `method` as a caller option. That is
  // internal API (caller-only, not user-reachable). This is an accepted risk
  // provided handlers never forward user input into the method field.
  it("morgenFetch.method parameter is internal-only (documented accepted risk)", () => {
    expect(typeof morgenFetch).toBe("function");
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
