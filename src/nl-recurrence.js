// Natural-language recurrence parser — v0.1.6
//
// Turns casual phrases like "every monday", "biweekly", "first monday of
// every month" into Morgen's RecurrenceRule shape (an array of objects with
// @type, frequency, interval, and optional byDay). Accepts pre-built arrays
// as pass-through so existing callers that hand-author RecurrenceRule
// objects keep working untouched.
//
// Supported patterns:
//   "daily" / "every day"
//   "weekly" / "every week"
//   "monthly" / "every month"
//   "yearly" / "annually" / "every year"
//   "every 2 weeks" / "biweekly" / "every other week"
//   "every monday" / "every mon"
//   "every tuesday and thursday"
//   "weekdays" / "every weekday"
//   "weekends" / "every weekend"
//   "first monday of every month"
//   "last friday of every month"
//
// Everything unrecognized throws a clear error listing the supported shapes.

const DAY_SHORT = {
  sunday: "su", sun: "su",
  monday: "mo", mon: "mo",
  tuesday: "tu", tues: "tu", tue: "tu",
  wednesday: "we", weds: "we", wed: "we",
  thursday: "th", thurs: "th", thur: "th", thu: "th",
  friday: "fr", fri: "fr",
  saturday: "sa", sat: "sa",
};

const ORDINAL_WORDS = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
};

const WEEKDAY_TOKENS = ["mo", "tu", "we", "th", "fr"];
const WEEKEND_TOKENS = ["sa", "su"];

const SUPPORTED_PATTERNS = [
  '"daily" / "every day"',
  '"weekly" / "every week"',
  '"monthly" / "every month"',
  '"yearly" / "annually"',
  '"every 2 weeks" / "biweekly" / "every other week"',
  '"every monday" (or any weekday)',
  '"every tuesday and thursday"',
  '"weekdays" / "weekends"',
  '"first monday of every month"',
  '"last friday of every month"',
];

function rule(extra = {}) {
  return { "@type": "RecurrenceRule", interval: 1, ...extra };
}

function nDay(day, nthOfPeriod) {
  const entry = { "@type": "NDay", day };
  if (nthOfPeriod !== undefined) entry.nthOfPeriod = nthOfPeriod;
  return entry;
}

function extractWeekdayTokens(text) {
  const tokens = [];
  // Split on "and", commas, ampersand to catch "mon and wed and fri"
  const parts = text.split(/\s*(?:,|&|\band\b|\+)\s*/).filter(Boolean);
  for (const part of parts) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    const short = DAY_SHORT[key];
    if (short) tokens.push(short);
  }
  return tokens;
}

function parseStringPattern(input) {
  const raw = input.trim();
  if (!raw) {
    throw new Error(
      "recurrence: empty string is not a valid recurrence pattern. " +
      `Supported patterns: ${SUPPORTED_PATTERNS.join(", ")}`
    );
  }
  const s = raw.toLowerCase();

  // Simple base frequencies
  if (/^every\s+day$/.test(s) || s === "daily") {
    return [rule({ frequency: "daily" })];
  }
  if (/^every\s+week$/.test(s) || s === "weekly") {
    return [rule({ frequency: "weekly" })];
  }
  if (/^every\s+month$/.test(s) || s === "monthly") {
    return [rule({ frequency: "monthly" })];
  }
  if (/^every\s+year$/.test(s) || s === "yearly" || s === "annually") {
    return [rule({ frequency: "yearly" })];
  }

  // Biweekly variants
  if (
    s === "biweekly" ||
    s === "bi-weekly" ||
    s === "fortnightly" ||
    /^every\s+other\s+week$/.test(s) ||
    /^every\s+2\s+weeks?$/.test(s)
  ) {
    return [rule({ frequency: "weekly", interval: 2 })];
  }

  // "every N {days|weeks|months|years}"
  const everyN = s.match(/^every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)$/);
  if (everyN) {
    const interval = Number(everyN[1]);
    if (!Number.isFinite(interval) || interval < 1) {
      throw new Error(`recurrence: invalid interval "${everyN[1]}"`);
    }
    const unit = everyN[2].replace(/s$/, "");
    const freqMap = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
    return [rule({ frequency: freqMap[unit], interval })];
  }

  // Weekdays / weekends aliases
  if (s === "weekdays" || s === "every weekday" || s === "every weekdays") {
    return [
      rule({
        frequency: "weekly",
        byDay: WEEKDAY_TOKENS.map((d) => nDay(d)),
      }),
    ];
  }
  if (s === "weekends" || s === "every weekend") {
    return [
      rule({
        frequency: "weekly",
        byDay: WEEKEND_TOKENS.map((d) => nDay(d)),
      }),
    ];
  }

  // "first monday of every month" / "last friday of every month"
  const ordinal = s.match(
    /^(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)\s+of\s+(?:every|the)\s+month$/
  );
  if (ordinal) {
    const nth = ORDINAL_WORDS[ordinal[1]];
    const day = DAY_SHORT[ordinal[2]];
    if (nth === undefined || !day) {
      throw new Error(`recurrence: unrecognized ordinal "${ordinal[1]} ${ordinal[2]}"`);
    }
    return [
      rule({
        frequency: "monthly",
        byDay: [nDay(day, nth)],
      }),
    ];
  }

  // "every monday" / "every tuesday and thursday"
  const everyDay = s.match(/^every\s+(.+)$/);
  if (everyDay) {
    const tokens = extractWeekdayTokens(everyDay[1]);
    if (tokens.length > 0) {
      return [
        rule({
          frequency: "weekly",
          byDay: tokens.map((d) => nDay(d)),
        }),
      ];
    }
  }

  throw new Error(
    `recurrence: could not parse "${input}" as a recurrence pattern. ` +
    `Supported patterns: ${SUPPORTED_PATTERNS.join(", ")}`
  );
}

// Public entry point. Accepts:
//   - An array → returned unchanged (downstream validateRecurrenceRules
//     handles shape + maxItems checks; this lets existing error messages
//     and rate-limit caps keep firing with the same text.)
//   - A string → parsed into a single-rule array
// Anything else throws.
export function parseRecurrenceString(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === "string") {
    return parseStringPattern(input);
  }
  throw new Error(
    "recurrence_rules must be a natural-language string or an array of RecurrenceRule objects"
  );
}

export const __test__ = {
  SUPPORTED_PATTERNS,
  DAY_SHORT,
  ORDINAL_WORDS,
};
