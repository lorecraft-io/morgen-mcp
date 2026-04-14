// Unit tests for the natural-language recurrence parser (v0.1.6).
//
// Every pattern the parser claims to support has a test here. Array
// pass-through and error messaging are also covered so regressions in
// parseRecurrenceString don't silently reshape existing event payloads.

import { describe, it, expect } from "vitest";
import { parseRecurrenceString } from "../src/nl-recurrence.js";

function single(rules) {
  expect(Array.isArray(rules)).toBe(true);
  expect(rules).toHaveLength(1);
  return rules[0];
}

describe("parseRecurrenceString — basic frequencies", () => {
  it('"daily" → frequency:daily interval:1', () => {
    const rule = single(parseRecurrenceString("daily"));
    expect(rule).toMatchObject({
      "@type": "RecurrenceRule",
      frequency: "daily",
      interval: 1,
    });
  });

  it('"every day" → frequency:daily', () => {
    expect(single(parseRecurrenceString("every day")).frequency).toBe("daily");
  });

  it('"weekly" / "every week" → frequency:weekly', () => {
    expect(single(parseRecurrenceString("weekly")).frequency).toBe("weekly");
    expect(single(parseRecurrenceString("every week")).frequency).toBe("weekly");
  });

  it('"monthly" / "every month" → frequency:monthly', () => {
    expect(single(parseRecurrenceString("monthly")).frequency).toBe("monthly");
    expect(single(parseRecurrenceString("every month")).frequency).toBe("monthly");
  });

  it('"yearly" / "annually" / "every year" → frequency:yearly', () => {
    expect(single(parseRecurrenceString("yearly")).frequency).toBe("yearly");
    expect(single(parseRecurrenceString("annually")).frequency).toBe("yearly");
    expect(single(parseRecurrenceString("every year")).frequency).toBe("yearly");
  });
});

describe("parseRecurrenceString — intervals", () => {
  it('"every 2 weeks" → weekly interval:2', () => {
    const rule = single(parseRecurrenceString("every 2 weeks"));
    expect(rule).toMatchObject({ frequency: "weekly", interval: 2 });
  });

  it('"biweekly" → weekly interval:2', () => {
    const rule = single(parseRecurrenceString("biweekly"));
    expect(rule).toMatchObject({ frequency: "weekly", interval: 2 });
  });

  it('"every other week" → weekly interval:2', () => {
    const rule = single(parseRecurrenceString("every other week"));
    expect(rule).toMatchObject({ frequency: "weekly", interval: 2 });
  });

  it('"every 3 days" → daily interval:3', () => {
    const rule = single(parseRecurrenceString("every 3 days"));
    expect(rule).toMatchObject({ frequency: "daily", interval: 3 });
  });

  it('"every 6 months" → monthly interval:6', () => {
    const rule = single(parseRecurrenceString("every 6 months"));
    expect(rule).toMatchObject({ frequency: "monthly", interval: 6 });
  });
});

describe("parseRecurrenceString — single weekday", () => {
  it('"every monday" → weekly byDay:mo', () => {
    const rule = single(parseRecurrenceString("every monday"));
    expect(rule.frequency).toBe("weekly");
    expect(rule.byDay).toEqual([{ "@type": "NDay", day: "mo" }]);
  });

  it('"every mon" → weekly byDay:mo', () => {
    const rule = single(parseRecurrenceString("every mon"));
    expect(rule.byDay).toEqual([{ "@type": "NDay", day: "mo" }]);
  });

  it('"every tuesday" → weekly byDay:tu', () => {
    const rule = single(parseRecurrenceString("every tuesday"));
    expect(rule.byDay).toEqual([{ "@type": "NDay", day: "tu" }]);
  });

  it('"every friday" → weekly byDay:fr', () => {
    const rule = single(parseRecurrenceString("every friday"));
    expect(rule.byDay).toEqual([{ "@type": "NDay", day: "fr" }]);
  });
});

describe("parseRecurrenceString — multiple weekdays", () => {
  it('"every tuesday and thursday" → weekly byDay:tu,th', () => {
    const rule = single(parseRecurrenceString("every tuesday and thursday"));
    expect(rule.frequency).toBe("weekly");
    expect(rule.byDay).toEqual([
      { "@type": "NDay", day: "tu" },
      { "@type": "NDay", day: "th" },
    ]);
  });

  it('"every mon, wed, fri" → weekly byDay:mo,we,fr', () => {
    const rule = single(parseRecurrenceString("every mon, wed, fri"));
    expect(rule.byDay).toEqual([
      { "@type": "NDay", day: "mo" },
      { "@type": "NDay", day: "we" },
      { "@type": "NDay", day: "fr" },
    ]);
  });
});

describe("parseRecurrenceString — aliases", () => {
  it('"weekdays" → weekly byDay:mo,tu,we,th,fr', () => {
    const rule = single(parseRecurrenceString("weekdays"));
    expect(rule.frequency).toBe("weekly");
    expect(rule.byDay.map((d) => d.day)).toEqual(["mo", "tu", "we", "th", "fr"]);
  });

  it('"every weekday" → same as weekdays', () => {
    const rule = single(parseRecurrenceString("every weekday"));
    expect(rule.byDay.map((d) => d.day)).toEqual(["mo", "tu", "we", "th", "fr"]);
  });

  it('"weekends" → weekly byDay:sa,su', () => {
    const rule = single(parseRecurrenceString("weekends"));
    expect(rule.byDay.map((d) => d.day)).toEqual(["sa", "su"]);
  });

  it('"every weekend" → same as weekends', () => {
    const rule = single(parseRecurrenceString("every weekend"));
    expect(rule.byDay.map((d) => d.day)).toEqual(["sa", "su"]);
  });
});

describe("parseRecurrenceString — ordinal monthly", () => {
  it('"first monday of every month" → monthly byDay:mo nth:1', () => {
    const rule = single(parseRecurrenceString("first monday of every month"));
    expect(rule.frequency).toBe("monthly");
    expect(rule.byDay).toEqual([
      { "@type": "NDay", day: "mo", nthOfPeriod: 1 },
    ]);
  });

  it('"last friday of every month" → monthly byDay:fr nth:-1', () => {
    const rule = single(parseRecurrenceString("last friday of every month"));
    expect(rule.frequency).toBe("monthly");
    expect(rule.byDay).toEqual([
      { "@type": "NDay", day: "fr", nthOfPeriod: -1 },
    ]);
  });

  it('"third wednesday of every month" → monthly nth:3', () => {
    const rule = single(parseRecurrenceString("third wednesday of every month"));
    expect(rule.byDay).toEqual([
      { "@type": "NDay", day: "we", nthOfPeriod: 3 },
    ]);
  });

  it('"2nd tuesday of every month" → monthly nth:2', () => {
    const rule = single(parseRecurrenceString("2nd tuesday of every month"));
    expect(rule.byDay).toEqual([
      { "@type": "NDay", day: "tu", nthOfPeriod: 2 },
    ]);
  });
});

describe("parseRecurrenceString — case insensitivity", () => {
  it("handles SHOUT CASE", () => {
    const rule = single(parseRecurrenceString("WEEKLY"));
    expect(rule.frequency).toBe("weekly");
  });

  it("handles mixed case", () => {
    const rule = single(parseRecurrenceString("Every Monday"));
    expect(rule.byDay).toEqual([{ "@type": "NDay", day: "mo" }]);
  });
});

describe("parseRecurrenceString — array pass-through", () => {
  it("returns pre-built RecurrenceRule arrays unchanged", () => {
    const input = [
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        interval: 1,
        byDay: [{ "@type": "NDay", day: "mo" }],
      },
    ];
    expect(parseRecurrenceString(input)).toBe(input);
  });

  it("preserves array references so downstream validators (validateRecurrenceRules) get to see the original shape and error messaging", () => {
    const input = [{ frequency: "weekly" }, { frequency: "daily" }];
    const out = parseRecurrenceString(input);
    expect(out).toBe(input);
    expect(out).toHaveLength(2);
  });
});

describe("parseRecurrenceString — error handling", () => {
  it("throws on unrecognized string", () => {
    expect(() => parseRecurrenceString("sometimes maybe")).toThrow(
      /could not parse/i
    );
  });

  it("throws on empty string", () => {
    expect(() => parseRecurrenceString("")).toThrow(/empty/i);
  });

  it("throws on null", () => {
    expect(() => parseRecurrenceString(null)).toThrow();
  });

  it("throws on number", () => {
    expect(() => parseRecurrenceString(42)).toThrow();
  });

  it("error message lists supported patterns", () => {
    try {
      parseRecurrenceString("sometimes maybe");
    } catch (err) {
      expect(err.message).toMatch(/biweekly/i);
      expect(err.message).toMatch(/weekdays/i);
    }
  });
});
