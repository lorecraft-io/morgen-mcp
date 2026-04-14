// Unit tests for the natural-language date/time parser (v0.1.6).
//
// The parser has to handle three distinct shapes — full datetimes, date-only,
// and time-only — while keeping ISO/strict inputs as pass-through so existing
// MCP callers don't regress. Tests pin down pass-through, chrono-backed
// parses, timezone correctness, and error messaging.

import { describe, it, expect, vi } from "vitest";
import {
  resolveDateTimeInput,
  resolveDateInput,
  resolveTimeInput,
} from "../src/nl-date-parser.js";

// Helper: pull HH:MM wall-clock out of an ISO 8601 string with offset
function wallClock(iso) {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function datePart(iso) {
  return iso.slice(0, 10);
}

describe("resolveDateTimeInput — ISO pass-through", () => {
  it("returns full ISO 8601 with offset unchanged", () => {
    const iso = "2026-04-15T10:00:00-04:00";
    expect(resolveDateTimeInput(iso, "America/New_York")).toBe(iso);
  });

  it("returns ISO 8601 with Z unchanged", () => {
    const iso = "2026-04-15T14:00:00Z";
    expect(resolveDateTimeInput(iso, "America/New_York")).toBe(iso);
  });

  it("returns ISO 8601 with milliseconds unchanged", () => {
    const iso = "2026-04-15T14:00:00.000Z";
    expect(resolveDateTimeInput(iso, "America/New_York")).toBe(iso);
  });
});

describe("resolveDateTimeInput — natural-language parsing", () => {
  it("parses 'tomorrow at 3pm' into tomorrow's 15:00 in the target tz", () => {
    // Freeze the date so "tomorrow" is deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));
    const iso = resolveDateTimeInput("tomorrow at 3pm", "America/New_York");
    expect(wallClock(iso)).toBe("15:00");
    expect(datePart(iso)).toBe("2026-04-15");
    vi.useRealTimers();
  });

  it("parses 'next friday' into some Friday after the ref date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00")); // Tue
    const iso = resolveDateTimeInput("next friday", "America/New_York");
    const d = new Date(iso);
    expect(d.getUTCDay()).toBe(5);
    expect(d.getTime()).toBeGreaterThan(new Date("2026-04-14T00:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("parses 'in 2 hours' as ref + 2h", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));
    const iso = resolveDateTimeInput("in 2 hours", "America/New_York");
    const d = new Date(iso);
    // 12:00 local + 2h = 14:00 local = 18:00 UTC on 2026-04-14
    expect(d.toISOString()).toBe("2026-04-14T18:00:00.000Z");
    vi.useRealTimers();
  });

  it("parses '3pm' as today 15:00 in the target tz", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T09:00:00-04:00"));
    const iso = resolveDateTimeInput("3pm", "America/New_York");
    expect(wallClock(iso)).toBe("15:00");
    expect(datePart(iso)).toBe("2026-04-14");
    vi.useRealTimers();
  });

  it("produces different UTC instants for 'tomorrow at 9am' in NY vs London", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));
    const ny = resolveDateTimeInput("tomorrow at 9am", "America/New_York");
    const london = resolveDateTimeInput("tomorrow at 9am", "Europe/London");
    // NY 9am EDT = 13:00 UTC; London 9am BST = 08:00 UTC. Five hours apart.
    const delta =
      new Date(ny).getTime() - new Date(london).getTime();
    expect(delta).toBe(5 * 3600 * 1000);
    vi.useRealTimers();
  });
});

describe("resolveDateTimeInput — error handling", () => {
  it("throws on gibberish input", () => {
    expect(() => resolveDateTimeInput("potato", "America/New_York")).toThrow(
      /could not parse/i
    );
  });

  it("throws on empty string", () => {
    expect(() => resolveDateTimeInput("", "America/New_York")).toThrow(
      /required/i
    );
  });

  it("throws on null", () => {
    expect(() => resolveDateTimeInput(null, "America/New_York")).toThrow(
      /required/i
    );
  });

  it("throws on non-string input", () => {
    expect(() => resolveDateTimeInput(1234, "America/New_York")).toThrow(
      /string/i
    );
  });
});

describe("resolveDateInput — YYYY-MM-DD", () => {
  it("passes through YYYY-MM-DD unchanged", () => {
    expect(resolveDateInput("2026-04-15", "America/New_York")).toBe(
      "2026-04-15"
    );
  });

  it("parses 'today' to the wall-clock date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));
    const d = resolveDateInput("today", "America/New_York");
    expect(d).toBe("2026-04-14");
    vi.useRealTimers();
  });

  it("parses 'tomorrow' correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));
    expect(resolveDateInput("tomorrow", "America/New_York")).toBe("2026-04-15");
    vi.useRealTimers();
  });

  it("parses 'next monday' and returns a Monday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00")); // Tue
    const d = resolveDateInput("next monday", "America/New_York");
    // Use UTC date constructor to avoid local tz off-by-one
    expect(/^\d{4}-\d{2}-\d{2}$/.test(d)).toBe(true);
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    expect(weekday).toBe(1);
    vi.useRealTimers();
  });

  it("throws on gibberish", () => {
    expect(() => resolveDateInput("potato", "America/New_York")).toThrow(
      /could not parse/i
    );
  });

  it("throws on empty", () => {
    expect(() => resolveDateInput("", "America/New_York")).toThrow(/required/i);
  });
});

describe("resolveTimeInput — HH:MM pass-through + chrono fallback", () => {
  it("passes through HH:MM", () => {
    expect(resolveTimeInput("13:00")).toBe("13:00:00");
  });

  it("passes through HH:MM:SS", () => {
    expect(resolveTimeInput("13:30:45")).toBe("13:30:45");
  });

  it("normalizes single-digit hour", () => {
    expect(resolveTimeInput("9:00")).toBe("09:00:00");
  });

  it("parses '1pm' as 13:00:00", () => {
    expect(resolveTimeInput("1pm")).toBe("13:00:00");
  });

  it("parses '1:30pm' as 13:30:00", () => {
    expect(resolveTimeInput("1:30pm")).toBe("13:30:00");
  });

  it("parses '9am' as 09:00:00", () => {
    expect(resolveTimeInput("9am")).toBe("09:00:00");
  });

  it("throws on empty", () => {
    expect(() => resolveTimeInput("")).toThrow(/required/i);
  });

  it("throws on out-of-range HH:MM", () => {
    expect(() => resolveTimeInput("25:00")).toThrow(/valid 24-hour/i);
  });

  it("throws on gibberish", () => {
    expect(() => resolveTimeInput("not a time")).toThrow();
  });
});
