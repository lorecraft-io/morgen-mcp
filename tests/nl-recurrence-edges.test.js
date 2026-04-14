// Edge-case coverage for the v0.1.6 natural-language recurrence parser.
//
// Complements tests/nl-recurrence.test.js (the coder's base coverage) with
// case-insensitivity, multi-day splits, delimiter variations, ordinal
// monthly patterns, array pass-through, and the full error surface for
// unsupported phrases and wrong types.
//
// Contract notes (v0.1.6):
//   - parseRecurrenceString always returns an ARRAY. Strings produce a
//     single-element array; valid array inputs are returned unchanged.
//   - byDay entries are NDay objects: { "@type": "NDay", day: "mo", nthOfPeriod?: n }.
//   - Supported shapes are documented in SUPPORTED_PATTERNS; anything else
//     throws with a hint listing them.

import { describe, it, expect } from "vitest";
import { parseRecurrenceString } from "../src/nl-recurrence.js";

// --- helpers ----------------------------------------------------------------

function asRule(result) {
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBeGreaterThanOrEqual(1);
  return result[0];
}

function byDayCodes(rule) {
  if (!rule?.byDay) return [];
  return rule.byDay.map((entry) => entry.day).sort();
}

function byDayWithNth(rule) {
  if (!rule?.byDay) return [];
  return rule.byDay.map((entry) => ({
    day: entry.day,
    nth: entry.nthOfPeriod,
  }));
}

// ---------------------------------------------------------------------------
// Group A — Case insensitivity
// ---------------------------------------------------------------------------
describe("parseRecurrenceString — case insensitivity", () => {
  it("treats 'EVERY MONDAY' / 'every Monday' / 'Every monday' as identical weekly byDay:mo", () => {
    const variants = ["EVERY MONDAY", "every Monday", "Every monday"];
    for (const v of variants) {
      const rule = asRule(parseRecurrenceString(v));
      expect(rule["@type"]).toBe("RecurrenceRule");
      expect(rule.frequency).toBe("weekly");
      expect(rule.interval).toBe(1);
      expect(byDayCodes(rule)).toEqual(["mo"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Group B — Multi-day patterns + delimiter variants
// ---------------------------------------------------------------------------
describe("parseRecurrenceString — multi-day patterns", () => {
  it("'every monday, wednesday, and friday' → weekly byDay [mo, we, fr]", () => {
    const rule = asRule(
      parseRecurrenceString("every monday, wednesday, and friday")
    );
    expect(rule.frequency).toBe("weekly");
    expect(rule.interval).toBe(1);
    expect(byDayCodes(rule)).toEqual(["fr", "mo", "we"]);
  });

  it("'every tue/thu' is NOT supported (slash is not a splitter) and throws with a hint", () => {
    // extractWeekdayTokens splits on ',', '&', 'and', '+' — slash is absent,
    // so "tue/thu" is looked up as one token and missed. Expected behavior:
    // fall through to the supported-patterns error, not silently succeed.
    expect(() => parseRecurrenceString("every tue/thu")).toThrow(
      /could not parse/i
    );
    expect(() => parseRecurrenceString("every tue/thu")).toThrow(/Supported patterns/);
  });

  it("'weekdays' / 'every weekday' / 'weekends' resolve to the expected byDay sets", () => {
    const weekdayCodes = ["fr", "mo", "th", "tu", "we"]; // sorted
    const weekendCodes = ["sa", "su"]; // sorted

    expect(byDayCodes(asRule(parseRecurrenceString("weekdays")))).toEqual(
      weekdayCodes
    );
    expect(byDayCodes(asRule(parseRecurrenceString("every weekday")))).toEqual(
      weekdayCodes
    );
    expect(byDayCodes(asRule(parseRecurrenceString("weekends")))).toEqual(
      weekendCodes
    );
  });
});

// ---------------------------------------------------------------------------
// Group C — Intervals
// ---------------------------------------------------------------------------
describe("parseRecurrenceString — intervals", () => {
  it("'every other week' → weekly interval 2, no byDay", () => {
    const rule = asRule(parseRecurrenceString("every other week"));
    expect(rule.frequency).toBe("weekly");
    expect(rule.interval).toBe(2);
    expect(rule.byDay).toBeUndefined();
  });

  it("'every other monday' is NOT a supported shape and throws (v0.1.6 gap)", () => {
    // The parser recognizes 'every other week' explicitly but has no branch
    // for 'every other <weekday>'. extractWeekdayTokens sees "other monday"
    // as one unrecognized token → zero tokens → falls through to the
    // supported-patterns error. Pinning this behavior so a future upgrade
    // that adds the branch will intentionally break this test.
    expect(() => parseRecurrenceString("every other monday")).toThrow(
      /could not parse/i
    );
  });

  it("'every 3 days' → daily interval 3", () => {
    const rule = asRule(parseRecurrenceString("every 3 days"));
    expect(rule.frequency).toBe("daily");
    expect(rule.interval).toBe(3);
    expect(rule.byDay).toBeUndefined();
  });

  it("'biweekly' and 'bi-weekly' both → weekly interval 2", () => {
    for (const v of ["biweekly", "bi-weekly"]) {
      const rule = asRule(parseRecurrenceString(v));
      expect(rule.frequency).toBe("weekly");
      expect(rule.interval).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Group D — Ordinal monthly patterns
// ---------------------------------------------------------------------------
describe("parseRecurrenceString — ordinal monthly patterns", () => {
  it("'2nd tuesday of the month' → monthly byDay [{tu, nth:2}]", () => {
    const rule = asRule(parseRecurrenceString("2nd tuesday of the month"));
    expect(rule.frequency).toBe("monthly");
    expect(rule.interval).toBe(1);
    expect(byDayWithNth(rule)).toEqual([{ day: "tu", nth: 2 }]);
  });

  it("'third friday of every month' → monthly byDay [{fr, nth:3}]", () => {
    const rule = asRule(parseRecurrenceString("third friday of every month"));
    expect(rule.frequency).toBe("monthly");
    expect(byDayWithNth(rule)).toEqual([{ day: "fr", nth: 3 }]);
  });

  it("'last wednesday of every month' → monthly byDay [{we, nth:-1}]", () => {
    const rule = asRule(parseRecurrenceString("last wednesday of every month"));
    expect(rule.frequency).toBe("monthly");
    expect(byDayWithNth(rule)).toEqual([{ day: "we", nth: -1 }]);
  });
});

// ---------------------------------------------------------------------------
// Group E — Pre-built array pass-through
// ---------------------------------------------------------------------------
describe("parseRecurrenceString — array pass-through", () => {
  it("returns a single pre-built rule array unchanged", () => {
    const input = [
      { "@type": "RecurrenceRule", frequency: "weekly", interval: 1 },
    ];
    const out = parseRecurrenceString(input);
    expect(out).toBe(input); // identity — parser does not clone
    expect(out).toEqual(input);
  });

  it("returns a mixed two-rule array unchanged", () => {
    const input = [
      { "@type": "RecurrenceRule", frequency: "weekly", interval: 1 },
      {
        "@type": "RecurrenceRule",
        frequency: "monthly",
        interval: 1,
        byDay: [{ "@type": "NDay", day: "fr", nthOfPeriod: -1 }],
      },
    ];
    const out = parseRecurrenceString(input);
    expect(out).toEqual(input);
  });

  it("returns an empty array unchanged", () => {
    expect(parseRecurrenceString([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group F — Error surface
// ---------------------------------------------------------------------------
describe("parseRecurrenceString — error handling", () => {
  it("unknown pattern 'every purple elephant' throws with a supported-patterns hint", () => {
    expect(() => parseRecurrenceString("every purple elephant")).toThrow(
      /could not parse/i
    );
    expect(() => parseRecurrenceString("every purple elephant")).toThrow(
      /Supported patterns/
    );
    // Hint should name at least one concrete shape.
    expect(() => parseRecurrenceString("every purple elephant")).toThrow(
      /daily|weekly|monthly/
    );
  });

  it("v0.1.6 delegates entry shape validation downstream — arrays pass through untouched", () => {
    // The committed v0.1.6 entry point returns arrays unchanged and lets
    // validateRecurrenceRules (called by each tool) handle per-entry shape
    // checks. This keeps existing error messages and maxItems caps stable.
    // We pin that contract here so a future change that re-introduces
    // per-entry validation in parseRecurrenceString breaks this test
    // intentionally.
    const bad = [
      { "@type": "RecurrenceRule", frequency: "weekly", interval: 1 },
      "weekly", // garbage entry — rejected later, not here
    ];
    expect(parseRecurrenceString(bad)).toBe(bad);

    const withNull = [null];
    expect(parseRecurrenceString(withNull)).toBe(withNull);

    const withNumber = [42];
    expect(parseRecurrenceString(withNumber)).toBe(withNumber);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number 42", 42],
    ["boolean true", true],
  ])("rejects %s with a 'string or array' type error", (_label, value) => {
    expect(() => parseRecurrenceString(value)).toThrow(
      /natural-language string or an array/i
    );
  });

  it("empty string throws with the supported-patterns hint", () => {
    expect(() => parseRecurrenceString("")).toThrow(/empty string/i);
    expect(() => parseRecurrenceString("")).toThrow(/Supported patterns/);
  });
});
