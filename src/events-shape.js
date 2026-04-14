// Pure helpers for shaping Morgen event/calendar API responses and
// building request bodies. Kept separate from tools-events.js to
// respect the 500-line-per-file project rule.
import { validateStringArray } from "./validation.js";

export const MAX_DESCRIPTION_LEN = 5000;
export const MAX_PARTICIPANTS = 100;
export const MAX_RECURRENCE_RULES = 20;

export function validateParticipantEmails(value, field = "participants") {
  validateStringArray(value, field, MAX_PARTICIPANTS);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const entry of value) {
    if (!emailPattern.test(entry)) {
      throw new Error(`${field} entries must be valid email addresses`);
    }
  }
}

// Morgen expects participants as a keyed map:
// { <id>: { @type, email, roles, participationStatus } }.
// At creation we don't have server IDs yet, so key by email — the server
// assigns real IDs. Default each participant to attendee / needs-action.
export function toParticipantMap(emails = []) {
  const map = {};
  for (const email of emails) {
    map[email] = {
      "@type": "Participant",
      email,
      roles: { attendee: true },
      participationStatus: "needs-action",
    };
  }
  return map;
}

export function validateRecurrenceRules(value, field = "recurrence_rules") {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of recurrence rule objects`);
  }
  if (value.length > MAX_RECURRENCE_RULES) {
    throw new Error(`${field} exceeds maximum of ${MAX_RECURRENCE_RULES} rules`);
  }
  for (const rule of value) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(
        `${field} entries must be objects (e.g. { "@type": "RecurrenceRule", "frequency": "weekly", "interval": 1 })`
      );
    }
    if (!rule.frequency || typeof rule.frequency !== "string") {
      throw new Error(`${field} entries must include a "frequency" string`);
    }
  }
  return value;
}

function deriveOrganizer(participants) {
  if (!participants || typeof participants !== "object") return undefined;
  for (const key of Object.keys(participants)) {
    const p = participants[key];
    if (p && p.roles && p.roles.owner === true) {
      return p.email || p.name || key;
    }
  }
  return undefined;
}

function mapParticipants(participants) {
  if (!participants || typeof participants !== "object") return undefined;
  const entries = Array.isArray(participants)
    ? participants
    : Object.values(participants);
  return entries.map((p) => ({
    email: p?.email,
    name: p?.name,
    participationStatus: p?.participationStatus,
    isOrganizer: p?.roles?.owner === true,
    isAttendee: p?.roles?.attendee === true,
  }));
}

export function mapEvent(e) {
  if (!e || typeof e !== "object") return e;
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    calendarId: e.calendarId,
    description:
      typeof e.description === "string"
        ? e.description.substring(0, MAX_DESCRIPTION_LEN)
        : undefined,
    location: e.location,
    participants: mapParticipants(e.participants),
    organizer: deriveOrganizer(e.participants),
    recurrenceRules: e.recurrenceRules,
    seriesId: e.seriesId,
  };
}

export function mapCalendar(c) {
  if (!c || typeof c !== "object") return c;
  const rights = c.myRights || {};
  const readOnly = rights.mayWriteAll === false && rights.mayReadItems === true;
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    accountId: c.accountId,
    integrationId: c.integrationId,
    sortOrder: c.sortOrder,
    readOnly,
  };
}

// Morgen wraps all responses in { data: { ... } }.
// See https://docs.morgen.so/calendars and https://docs.morgen.so/events
export function unwrapCalendars(data) {
  return data?.data?.calendars ?? data?.calendars ?? [];
}

export function unwrapEvents(data) {
  return data?.data?.events ?? data?.events ?? [];
}

export function unwrapEvent(data) {
  return data?.data?.event ?? data?.event ?? data?.data ?? data;
}

// Morgen /v3/events/create requires LocalDateTime (no offset, no Z) plus a
// separate `timeZone` field. Convert an ISO 8601 UTC instant to the wall-clock
// time in the target IANA timezone using Intl.DateTimeFormat.
export function isoUtcToLocal(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid ISO 8601 datetime: ${iso}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}

// Build an ISO 8601 duration string (e.g. "PT15M", "PT1H30M", "PT2H")
// from two ISO datetimes. Morgen expects this for create_event.
export function isoDurationFromRange(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("invalid start or end in duration calculation");
  }
  if (endMs < startMs) {
    throw new Error("end must be on or after start");
  }
  let totalSeconds = Math.round((endMs - startMs) / 1000);
  if (totalSeconds === 0) totalSeconds = 60;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let out = "PT";
  if (hours) out += `${hours}H`;
  if (minutes) out += `${minutes}M`;
  if (seconds && !hours) out += `${seconds}S`;
  if (out === "PT") out = "PT0S";
  return out;
}
