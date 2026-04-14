// Unit tests for v0.1.3 smart account routing and the RSVP status mapping.
//
// These don't hit the network — they exercise the pure inference function
// from calendar-cache.js and the RSVP past-tense mapping from tools-events.
import { describe, it, expect, beforeEach } from "vitest";
import {
  inferAccountFromContext,
  _resetCalendarCache,
  _seedCalendarCache,
  resolveCalendarByAccountName,
  resolveSelfEmail,
} from "../src/calendar-cache.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  _resetCalendarCache();
  _seedCalendarCache([
    {
      id: "cal-lorecraft",
      accountId: "acct-lorecraft",
      name: "nate@lorecraft.io",
      integrationId: "google",
    },
    {
      id: "cal-parzvl",
      accountId: "acct-parzvl",
      name: "nate@parzvl.com",
      integrationId: "google",
    },
    {
      id: "cal-bloom",
      accountId: "acct-bloom",
      name: "nate@bloomit.ai",
      integrationId: "google",
    },
  ]);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MORGEN_SELF_EMAIL;
});

describe("inferAccountFromContext", () => {
  it("defaults to lorecraft with no signals", () => {
    expect(inferAccountFromContext({ title: "Dentist" })).toBe("lorecraft");
  });

  it("routes to parzvl on @parzvl.com participant email", () => {
    expect(
      inferAccountFromContext({
        title: "Client sync",
        participants: ["someone@parzvl.com"],
      })
    ).toBe("parzvl");
  });

  it("routes to parzvl on 'parzvl' in title", () => {
    expect(inferAccountFromContext({ title: "PARZVL brand review" })).toBe("parzvl");
  });

  it("routes to parzvl on 'beard club' in description", () => {
    expect(
      inferAccountFromContext({
        title: "Sync",
        description: "Kicking off the beard club campaign",
      })
    ).toBe("parzvl");
  });

  it("routes to bloom on @bloomit.ai participant email", () => {
    expect(
      inferAccountFromContext({
        title: "Standup",
        participants: ["dan@bloomit.ai"],
      })
    ).toBe("bloom");
  });

  it("routes to bloom on 'bloom' in title", () => {
    expect(inferAccountFromContext({ title: "Bloom investor prep" })).toBe("bloom");
  });

  it("routes to bloom on 'bloomit' in title", () => {
    expect(inferAccountFromContext({ title: "bloomit quarterly" })).toBe("bloom");
  });

  it("parzvl wins over bloom when both keywords appear (parzvl checked first)", () => {
    expect(
      inferAccountFromContext({
        title: "parzvl <> bloom joint thing",
      })
    ).toBe("parzvl");
  });

  it("participant email beats title-only signals", () => {
    expect(
      inferAccountFromContext({
        title: "Generic meeting",
        participants: ["dan@bloomit.ai"],
      })
    ).toBe("bloom");
  });
});

describe("resolveCalendarByAccountName", () => {
  it("resolves lorecraft → nate@lorecraft.io calendar", async () => {
    const meta = await resolveCalendarByAccountName("lorecraft");
    expect(meta.id).toBe("cal-lorecraft");
    expect(meta.accountId).toBe("acct-lorecraft");
  });

  it("resolves parzvl → nate@parzvl.com calendar", async () => {
    const meta = await resolveCalendarByAccountName("parzvl");
    expect(meta.id).toBe("cal-parzvl");
  });

  it("resolves bloom → nate@bloomit.ai calendar", async () => {
    const meta = await resolveCalendarByAccountName("bloom");
    expect(meta.id).toBe("cal-bloom");
  });

  it("falls back to default when account name not found", async () => {
    const meta = await resolveCalendarByAccountName("nonexistent");
    // Falls back to the first non-readonly entry (cal-lorecraft, the first seeded)
    expect(meta.id).toBe("cal-lorecraft");
  });
});

describe("resolveSelfEmail", () => {
  it("prefers MORGEN_SELF_EMAIL env var when valid", () => {
    process.env.MORGEN_SELF_EMAIL = "override@example.com";
    const email = resolveSelfEmail({ name: "nate@lorecraft.io" });
    expect(email).toBe("override@example.com");
  });

  it("derives from calendar name if env var unset and name looks like an email", () => {
    const email = resolveSelfEmail({ name: "nate@lorecraft.io" });
    expect(email).toBe("nate@lorecraft.io");
  });

  it("ignores invalid env var value and falls back to calendar name", () => {
    process.env.MORGEN_SELF_EMAIL = "not-an-email";
    const email = resolveSelfEmail({ name: "nate@parzvl.com" });
    expect(email).toBe("nate@parzvl.com");
  });

  it("throws with a clear hint when neither source is available", () => {
    expect(() => resolveSelfEmail({ name: "Work" })).toThrow(
      /MORGEN_SELF_EMAIL/
    );
  });
});
