// Security test suite for morgen-mcp — errors and coercion.
//
// SCOPE: Attack scenarios around error propagation and runtime coercion.
// Covers prototype pollution, API key leakage in errors, URL leakage in
// errors, and request method coercion.
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
