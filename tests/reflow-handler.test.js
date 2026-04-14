// Integration tests for handleReflowDay (v0.1.4).
//
// Pure helpers are already covered by tests/reflow.test.js — this file
// exercises the handler end-to-end with mocked fetch + a seeded calendar
// cache. We stub globalThis.fetch and route by URL:
//   - /v3/events/list  → canned raw events payload
//   - /v3/events/update → empty success (used to count write calls)
// The default seeded calendar uses an email-style name so that mapEvent's
// derived organizer can match selfEmail inside isSoloBlock.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleReflowDay } from "../src/tools-reflow.js";
import { _resetRateLimiter } from "../src/client.js";
import {
  _resetCalendarCache,
  _seedCalendarCache,
} from "../src/calendar-cache.js";

const ORIGINAL_FETCH = globalThis.fetch;
const SELF_EMAIL = "nate@test.com";

function okJson(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

// Build a fetch stub that returns canned events for list calls and tracks
// any /v3/events/update POSTs. Returns { fetchSpy, updateCalls }.
function installFetch(rawEvents, { onListCall } = {}) {
  const updateCalls = [];
  const fetchSpy = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/v3/events/list")) {
      if (onListCall) onListCall(u);
      return okJson({ data: { events: rawEvents } });
    }
    if (u.includes("/v3/events/update")) {
      updateCalls.push({ url: u, body: JSON.parse(init.body || "{}") });
      return okJson({ data: { event: {} } });
    }
    throw new Error(`unexpected fetch URL in test: ${u}`);
  });
  globalThis.fetch = fetchSpy;
  return { fetchSpy, updateCalls };
}

// Build a canned event. `participantEmails` becomes the participants map
// with the first email flagged as owner (so mapEvent derives organizer).
function makeEvent({ id, title, start, duration, participants = [SELF_EMAIL] }) {
  const pMap = {};
  participants.forEach((email, idx) => {
    pMap[email] = {
      "@type": "Participant",
      email,
      roles: idx === 0 ? { owner: true } : { attendee: true },
      participationStatus: "accepted",
    };
  });
  return {
    id,
    title,
    start,
    end: start, // handler never reads this, duration is authoritative
    duration,
    calendarId: "cal-rw",
    participants: pMap,
  };
}

beforeEach(() => {
  _resetRateLimiter();
  _resetCalendarCache();
  process.env.MORGEN_API_KEY = "test-key-placeholder";
  // Default writable calendar — name is an email so isSoloBlock matches.
  _seedCalendarCache([
    { id: "cal-rw", accountId: "acct-1", name: SELF_EMAIL, readOnly: false },
  ]);
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  delete process.env.MORGEN_API_KEY;
});

describe("handleReflowDay — happy paths", () => {
  it("event_ids + dry_run true returns plan without writing", async () => {
    const { updateCalls } = installFetch([
      makeEvent({ id: "e1", title: "Focus", start: "2026-05-01T10:00:00", duration: "PT30M" }),
      makeEvent({ id: "e2", title: "Deep work", start: "2026-05-01T11:00:00", duration: "PT1H" }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      event_ids: ["e1", "e2"],
      dry_run: true,
      timezone: "America/New_York",
    });
    expect(out.dry_run).toBe(true);
    expect(out.applied).toBe(false);
    expect(out.reflow).toHaveLength(2);
    expect(out.reflow[0]).toMatchObject({ event_id: "e1", new_start: "2026-05-01T09:00:00" });
    expect(out.reflow[1]).toMatchObject({ event_id: "e2", new_start: "2026-05-01T09:30:00", new_end: "2026-05-01T10:30:00" });
    expect(updateCalls).toHaveLength(0);
  });

  it("event_ids + dry_run false commits one POST per event", async () => {
    const { fetchSpy, updateCalls } = installFetch([
      makeEvent({ id: "e1", title: "A", start: "2026-05-01T10:00:00", duration: "PT30M" }),
      makeEvent({ id: "e2", title: "B", start: "2026-05-01T11:00:00", duration: "PT15M" }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      event_ids: ["e1", "e2"],
      dry_run: false,
      timezone: "America/New_York",
    });
    expect(out.applied).toBe(true);
    expect(out.dry_run).toBe(false);
    expect(updateCalls).toHaveLength(2);
    // Each update body should carry the new_start + accountId/calendarId
    expect(updateCalls[0].body).toMatchObject({
      id: "e1",
      accountId: "acct-1",
      calendarId: "cal-rw",
      start: "2026-05-01T09:00:00",
      timeZone: "America/New_York",
      duration: "PT30M",
      showWithoutTime: false,
    });
    // 1 list + 2 updates
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("handleReflowDay — auto mode filtering", () => {
  it("excludes events with external participants when protect_fixed is true", async () => {
    installFetch([
      makeEvent({ id: "solo", title: "Focus", start: "2026-05-01T10:00:00", duration: "PT30M" }),
      makeEvent({
        id: "meet",
        title: "External meeting",
        start: "2026-05-01T11:00:00",
        duration: "PT1H",
        participants: [SELF_EMAIL, "other@acme.com"],
      }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      timezone: "America/New_York",
    });
    expect(out.reflow).toHaveLength(1);
    expect(out.reflow[0].event_id).toBe("solo");
  });

  it("includes events with external participants when protect_fixed is false", async () => {
    installFetch([
      makeEvent({ id: "solo", title: "Focus", start: "2026-05-01T10:00:00", duration: "PT30M" }),
      makeEvent({
        id: "meet",
        title: "External",
        start: "2026-05-01T11:00:00",
        duration: "PT1H",
        participants: [SELF_EMAIL, "other@acme.com"],
      }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      protect_fixed: false,
      timezone: "America/New_York",
    });
    expect(out.reflow).toHaveLength(2);
    expect(out.reflow.map((r) => r.event_id).sort()).toEqual(["meet", "solo"]);
  });

  it("event_ids bypass protect_fixed so external-participant events still get reflowed", async () => {
    installFetch([
      makeEvent({
        id: "meet",
        title: "External",
        start: "2026-05-01T11:00:00",
        duration: "PT1H",
        participants: [SELF_EMAIL, "other@acme.com"],
      }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      event_ids: ["meet"],
      dry_run: true,
      timezone: "America/New_York",
    });
    expect(out.reflow).toHaveLength(1);
    expect(out.reflow[0].event_id).toBe("meet");
  });
});

describe("handleReflowDay — sameDay + duration filtering", () => {
  it("excludes events not on the target date", async () => {
    installFetch([
      makeEvent({ id: "onday", title: "A", start: "2026-05-01T10:00:00", duration: "PT30M" }),
      makeEvent({ id: "nextday", title: "B", start: "2026-05-02T10:00:00", duration: "PT30M" }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      timezone: "America/New_York",
    });
    expect(out.reflow).toHaveLength(1);
    expect(out.reflow[0].event_id).toBe("onday");
  });

  it("excludes auto-mode events missing a duration field", async () => {
    installFetch([
      makeEvent({ id: "has", title: "A", start: "2026-05-01T10:00:00", duration: "PT30M" }),
      { id: "nodur", title: "B", start: "2026-05-01T11:00:00", end: "2026-05-01T11:30:00", participants: {} },
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      timezone: "America/New_York",
    });
    expect(out.reflow).toHaveLength(1);
    expect(out.reflow[0].event_id).toBe("has");
  });

  it("returns no-reflowable-events message when nothing matches", async () => {
    installFetch([
      makeEvent({ id: "wrongday", title: "A", start: "2026-04-30T10:00:00", duration: "PT30M" }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      timezone: "America/New_York",
    });
    expect(out.applied).toBe(false);
    expect(out.reflow).toEqual([]);
    expect(out.message).toMatch(/no reflowable events found/i);
  });
});

describe("handleReflowDay — calendar + auth handling", () => {
  it("throws when the resolved calendar is read-only", async () => {
    _resetCalendarCache();
    _seedCalendarCache([
      { id: "cal-ro", accountId: "acct-1", name: SELF_EMAIL, readOnly: true },
    ]);
    installFetch([]);
    await expect(
      handleReflowDay({
        anchor_time: "09:00",
        date: "2026-05-01",
        timezone: "America/New_York",
      })
    ).rejects.toThrow(/read-only/);
  });

  it("uses resolveCalendarMeta when calendar_id is provided", async () => {
    _resetCalendarCache();
    _seedCalendarCache([
      { id: "cal-default", accountId: "acct-d", name: SELF_EMAIL, readOnly: false },
      { id: "cal-other", accountId: "acct-o", name: SELF_EMAIL, readOnly: false },
    ]);
    const { updateCalls } = installFetch([
      makeEvent({ id: "e1", title: "A", start: "2026-05-01T10:00:00", duration: "PT30M" }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      calendar_id: "cal-other",
      event_ids: ["e1"],
      dry_run: false,
      timezone: "America/New_York",
    });
    expect(out.applied).toBe(true);
    expect(updateCalls[0].body.accountId).toBe("acct-o");
    expect(updateCalls[0].body.calendarId).toBe("cal-other");
  });
});

describe("handleReflowDay — argument defaults", () => {
  it("dry_run defaults to true when omitted", async () => {
    const { updateCalls } = installFetch([
      makeEvent({ id: "e1", title: "A", start: "2026-05-01T10:00:00", duration: "PT30M" }),
    ]);
    const out = await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      event_ids: ["e1"],
      timezone: "America/New_York",
    });
    expect(out.dry_run).toBe(true);
    expect(out.applied).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it("args.timezone wins over MORGEN_TIMEZONE env var", async () => {
    process.env.MORGEN_TIMEZONE = "UTC";
    const { updateCalls } = installFetch([
      makeEvent({ id: "e1", title: "A", start: "2026-05-01T10:00:00", duration: "PT30M" }),
    ]);
    await handleReflowDay({
      anchor_time: "09:00",
      date: "2026-05-01",
      event_ids: ["e1"],
      dry_run: false,
      timezone: "Europe/Berlin",
    });
    expect(updateCalls[0].body.timeZone).toBe("Europe/Berlin");
    delete process.env.MORGEN_TIMEZONE;
  });
});
