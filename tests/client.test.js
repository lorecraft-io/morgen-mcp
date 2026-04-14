import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { morgenFetch, _resetRateLimiter, MORGEN_BASE } from "../src/client.js";

const API_KEY = "test-key-12345";

function makeResponse({ ok = true, status = 200, body = {}, contentLength } = {}) {
  const headers = new Map();
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }
  return {
    ok,
    status,
    headers: {
      get: (name) => headers.get(String(name).toLowerCase()) ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  };
}

async function flushRetryBackoff(attempt) {
  // Client backs off 1_000 * attempt ms between retries.
  await vi.advanceTimersByTimeAsync(1_000 * attempt);
}

describe("morgenFetch", () => {
  beforeEach(() => {
    process.env.MORGEN_API_KEY = API_KEY;
    vi.useFakeTimers();
    _resetRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MORGEN_API_KEY;
  });

  describe("auth + request shape", () => {
    it("sends the Authorization header as 'ApiKey <MORGEN_API_KEY>'", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: { ok: true } }));
      vi.stubGlobal("fetch", fetchMock);

      await morgenFetch("/v3/calendars/list", { points: 10 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe(`ApiKey ${API_KEY}`);
    });

    it("calls the correct base URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: { ok: true } }));
      vi.stubGlobal("fetch", fetchMock);

      await morgenFetch("/v3/calendars/list", { points: 1 });

      const [url] = fetchMock.mock.calls[0];
      expect(String(url).startsWith("https://api.morgen.so/v3/")).toBe(true);
      expect(MORGEN_BASE).toBe("https://api.morgen.so");
    });

    it("serializes the body as JSON and sets Content-Type", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: { id: "evt_1" } }));
      vi.stubGlobal("fetch", fetchMock);

      await morgenFetch("/v3/events/create", {
        method: "POST",
        body: { title: "x" },
        points: 1,
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ title: "x" }));
      expect(init.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("response handling", () => {
    it("resolves to null on 204 No Content", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeResponse({ ok: true, status: 204, contentLength: 0 })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await morgenFetch("/v3/events/delete", {
        method: "DELETE",
        points: 1,
      });

      expect(result).toBeNull();
    });

    it("throws a sanitized error on HTTP 500 without leaking the API key", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeResponse({ ok: false, status: 500 })
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        morgenFetch("/v3/calendars/list", { points: 1 })
      ).rejects.toThrow(/Morgen API error/);

      // Second call to inspect the error message string directly.
      _resetRateLimiter();
      let caught;
      try {
        await morgenFetch("/v3/calendars/list", { points: 1 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.message).not.toContain(API_KEY);
    });
  });

  describe("retry behavior", () => {
    it("retries on HTTP 429 and succeeds on the third attempt", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeResponse({ ok: false, status: 429 }))
        .mockResolvedValueOnce(makeResponse({ ok: false, status: 429 }))
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, body: { ok: true } }));
      vi.stubGlobal("fetch", fetchMock);

      const promise = morgenFetch("/v3/calendars/list", { points: 1 });

      // First retry backoff: 1s (attempt=1). Second retry backoff: 2s (attempt=2).
      await flushRetryBackoff(1);
      await flushRetryBackoff(2);

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("throws after exhausting retries on HTTP 503", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeResponse({ ok: false, status: 503 }));
      vi.stubGlobal("fetch", fetchMock);

      const promise = morgenFetch("/v3/calendars/list", { points: 1 });
      // Swallow the rejection on the original promise so Vitest doesn't see
      // an unhandled rejection while we're advancing timers.
      const settled = promise.catch((err) => err);

      await flushRetryBackoff(1);
      await flushRetryBackoff(2);

      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/HTTP 503/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("rate limiter", () => {
    it("blocks once 100 points are consumed in the rolling window", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: { ok: true } }));
      vi.stubGlobal("fetch", fetchMock);

      for (let i = 0; i < 10; i++) {
        await morgenFetch("/v3/calendars/list", { points: 10 });
      }
      expect(fetchMock).toHaveBeenCalledTimes(10);

      await expect(
        morgenFetch("/v3/calendars/list", { points: 1 })
      ).rejects.toThrow(/rate limit/i);

      // The limiter must throw before the 11th fetch is issued.
      expect(fetchMock).toHaveBeenCalledTimes(10);
    });

    it("allows calls again after the 15-minute window expires", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: { ok: true } }));
      vi.stubGlobal("fetch", fetchMock);

      for (let i = 0; i < 10; i++) {
        await morgenFetch("/v3/calendars/list", { points: 10 });
      }

      await expect(
        morgenFetch("/v3/calendars/list", { points: 1 })
      ).rejects.toThrow(/rate limit/i);

      // Advance system time past the 15-minute rolling window.
      vi.setSystemTime(new Date(Date.now() + 15 * 60 * 1000 + 1_000));

      const result = await morgenFetch("/v3/calendars/list", { points: 1 });
      expect(result).toEqual({ ok: true });
    });

    it("rate limit error message mentions '100 points per 15 minutes'", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: { ok: true } }));
      vi.stubGlobal("fetch", fetchMock);

      for (let i = 0; i < 10; i++) {
        await morgenFetch("/v3/calendars/list", { points: 10 });
      }

      let caught;
      try {
        await morgenFetch("/v3/calendars/list", { points: 1 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toContain("100 points per 15 minutes");
    });
  });

  describe("security", () => {
    it("does not leak the API key when the underlying fetch rejects", async () => {
      const leakingMessage = `network exploded with header ApiKey ${API_KEY}`;
      const fetchMock = vi.fn().mockRejectedValue(new Error(leakingMessage));
      vi.stubGlobal("fetch", fetchMock);

      const promise = morgenFetch("/v3/calendars/list", { points: 1 });
      const settled = promise.catch((err) => err);

      // The rejection above does not match any retryable signature, so no
      // backoff is scheduled — but advancing timers is harmless.
      await flushRetryBackoff(1);
      await flushRetryBackoff(2);

      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).not.toContain(API_KEY);
    });
  });
});
