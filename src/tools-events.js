import { morgenFetch } from "./client.js";
import {
  validateId,
  validateISODate,
  validateEnum,
  validateStringArray,
} from "./validation.js";
import {
  isoDurationFromRange,
  isoUtcToLocal,
  mapCalendar,
  mapEvent,
  toParticipantMap,
  unwrapCalendars,
  unwrapEvent,
  unwrapEvents,
  validateParticipantEmails,
  validateRecurrenceRules,
} from "./events-shape.js";
import {
  getAllAccountsWithCalendars,
  groupCalendarIdsByAccount,
  resolveCalendarMeta,
  resolveDefaultCalendarMeta,
  _resetCalendarCache,
} from "./calendar-cache.js";
import {
  EVENT_TOOLS,
  SERIES_UPDATE_MODES,
  RSVP_RESPONSES,
} from "./tools-events-schema.js";

export { EVENT_TOOLS };

const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_LOCATION_LEN = 500;
const MAX_ID_LEN = 500;

// Timezone resolution order:
//   1. MORGEN_TIMEZONE env var (explicit override)
//   2. Node's Intl-reported system timezone (picks up the user's OS setting)
//   3. America/New_York (Nathan's default / sane fallback)
function resolveDefaultTimezone() {
  if (process.env.MORGEN_TIMEZONE) return process.env.MORGEN_TIMEZONE;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch {
    // fall through
  }
  return "America/New_York";
}
const DEFAULT_TIMEZONE = resolveDefaultTimezone();

function validateString(value, field, maxLen) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  if (value.length > maxLen) {
    throw new Error(`${field} must be ${maxLen} characters or fewer`);
  }
}

function validateRequiredString(value, field, maxLen) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${field} is required`);
  }
  validateString(value, field, maxLen);
}

export function _resetDefaultCalendarCache() {
  _resetCalendarCache();
}

// ---------- handlers ----------

async function handleListCalendars() {
  const data = await morgenFetch("/v3/calendars/list", { points: 10 });
  const raw = unwrapCalendars(data);
  const calendars = raw.map(mapCalendar);
  return { calendars, total: calendars.length };
}

async function fetchEventsForAccount(accountId, calendarIds, start, end) {
  const params = new URLSearchParams();
  params.set("accountId", accountId);
  params.set("calendarIds", calendarIds.join(","));
  params.set("start", start);
  params.set("end", end);
  const data = await morgenFetch(
    `/v3/events/list?${params.toString()}`,
    { points: 10 }
  );
  return unwrapEvents(data);
}

async function handleListEvents(args = {}) {
  validateISODate(args.start, "start");
  validateISODate(args.end, "end");

  if (Date.parse(args.end) < Date.parse(args.start)) {
    throw new Error("end must be on or after start");
  }

  // Group requested calendars by account. Morgen requires one call per account.
  let accountMap;
  if (args.calendar_ids !== undefined) {
    validateStringArray(args.calendar_ids, "calendar_ids", 100);
    for (const id of args.calendar_ids) {
      validateId(id, "calendar_ids");
    }
    accountMap = await groupCalendarIdsByAccount(args.calendar_ids);
  } else {
    // No filter — query every calendar on every account.
    const byAccount = await getAllAccountsWithCalendars();
    accountMap = new Map();
    for (const [acctId, entries] of byAccount.entries()) {
      accountMap.set(acctId, entries.map((e) => e.id));
    }
  }

  const all = [];
  for (const [accountId, calendarIds] of accountMap.entries()) {
    const events = await fetchEventsForAccount(
      accountId,
      calendarIds,
      args.start,
      args.end
    );
    all.push(...events);
  }

  const events = all.map(mapEvent);
  return { events, total: events.length };
}

async function handleCreateEvent(args = {}) {
  validateRequiredString(args.title, "title", MAX_TITLE_LEN);
  validateISODate(args.start, "start");
  validateISODate(args.end, "end");

  if (Date.parse(args.end) < Date.parse(args.start)) {
    throw new Error("end must be on or after start");
  }

  if (args.description !== undefined) {
    validateString(args.description, "description", MAX_DESCRIPTION_LEN);
  }
  if (args.location !== undefined) {
    validateString(args.location, "location", MAX_LOCATION_LEN);
  }
  if (args.participants !== undefined) {
    validateParticipantEmails(args.participants);
  }
  if (args.recurrence_rules !== undefined) {
    validateRecurrenceRules(args.recurrence_rules);
  }

  let calendarMeta;
  if (args.calendar_id) {
    validateId(args.calendar_id, "calendar_id");
    calendarMeta = await resolveCalendarMeta(args.calendar_id);
  } else {
    calendarMeta = await resolveDefaultCalendarMeta();
  }

  if (calendarMeta.readOnly) {
    throw new Error(
      `calendar ${calendarMeta.name} is read-only — cannot create events on it`
    );
  }

  const timeZone = args.timezone || DEFAULT_TIMEZONE;
  const localStart = isoUtcToLocal(args.start, timeZone);
  const duration = isoDurationFromRange(args.start, args.end);

  const body = {
    accountId: calendarMeta.accountId,
    calendarId: calendarMeta.id,
    title: args.title,
    start: localStart,
    duration,
    timeZone,
    showWithoutTime: false,
  };

  if (args.description !== undefined) body.description = args.description;
  if (args.location !== undefined) body.location = args.location;
  if (args.participants !== undefined) {
    body.participants = toParticipantMap(args.participants);
  }
  if (args.recurrence_rules !== undefined) {
    body.recurrenceRules = args.recurrence_rules;
  }

  const data = await morgenFetch("/v3/events/create", {
    method: "POST",
    body,
    points: 1,
  });

  return { success: true, event: mapEvent(unwrapEvent(data)) };
}

async function handleUpdateEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  validateId(args.calendar_id, "calendar_id");
  const calendarMeta = await resolveCalendarMeta(args.calendar_id);

  if (args.title !== undefined) {
    validateString(args.title, "title", MAX_TITLE_LEN);
  }
  if (args.description !== undefined) {
    validateString(args.description, "description", MAX_DESCRIPTION_LEN);
  }
  if (args.location !== undefined) {
    validateString(args.location, "location", MAX_LOCATION_LEN);
  }
  if (args.start !== undefined) validateISODate(args.start, "start");
  if (args.end !== undefined) validateISODate(args.end, "end");
  if (args.start !== undefined && args.end !== undefined) {
    if (Date.parse(args.end) < Date.parse(args.start)) {
      throw new Error("end must be on or after start");
    }
  }
  if (args.participants !== undefined) {
    validateParticipantEmails(args.participants);
  }
  if (args.series_update_mode !== undefined) {
    validateEnum(
      args.series_update_mode,
      SERIES_UPDATE_MODES,
      "series_update_mode"
    );
  }

  const timeZone = args.timezone || DEFAULT_TIMEZONE;
  const body = {
    id: eventId,
    accountId: calendarMeta.accountId,
    calendarId: calendarMeta.id,
  };
  if (args.title !== undefined) body.title = args.title;
  if (args.start !== undefined) {
    body.start = isoUtcToLocal(args.start, timeZone);
    body.timeZone = timeZone;
  }
  if (args.start !== undefined && args.end !== undefined) {
    body.duration = isoDurationFromRange(args.start, args.end);
  }
  if (args.description !== undefined) body.description = args.description;
  if (args.location !== undefined) body.location = args.location;
  if (args.participants !== undefined) {
    body.participants = toParticipantMap(args.participants);
  }

  const params = new URLSearchParams();
  if (args.series_update_mode !== undefined) {
    params.set("seriesUpdateMode", args.series_update_mode);
  }
  const qs = params.toString();
  const path = qs ? `/v3/events/update?${qs}` : "/v3/events/update";

  const data = await morgenFetch(path, {
    method: "POST",
    body,
    points: 1,
  });

  return { success: true, event: mapEvent(unwrapEvent(data)) };
}

async function handleDeleteEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  validateId(args.calendar_id, "calendar_id");
  const calendarMeta = await resolveCalendarMeta(args.calendar_id);

  if (args.series_update_mode !== undefined) {
    validateEnum(
      args.series_update_mode,
      SERIES_UPDATE_MODES,
      "series_update_mode"
    );
  }

  const params = new URLSearchParams();
  if (args.series_update_mode !== undefined) {
    params.set("seriesUpdateMode", args.series_update_mode);
  }
  const qs = params.toString();
  const path = qs ? `/v3/events/delete?${qs}` : "/v3/events/delete";

  await morgenFetch(path, {
    method: "POST",
    body: {
      id: eventId,
      accountId: calendarMeta.accountId,
      calendarId: calendarMeta.id,
    },
    points: 1,
  });

  return {
    success: true,
    deletedId: eventId,
    calendarId: calendarMeta.id,
    seriesUpdateMode: args.series_update_mode,
  };
}

async function handleRsvpEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  validateId(args.calendar_id, "calendar_id");
  const calendarMeta = await resolveCalendarMeta(args.calendar_id);
  validateEnum(args.response, RSVP_RESPONSES, "response");

  const path = `/v3/events/${args.response}`;
  const data = await morgenFetch(path, {
    method: "POST",
    body: {
      id: eventId,
      accountId: calendarMeta.accountId,
      calendarId: calendarMeta.id,
    },
    points: 1,
  });

  return {
    success: true,
    eventId,
    calendarId: calendarMeta.id,
    response: args.response,
    event: mapEvent(unwrapEvent(data)),
  };
}

export const eventHandlers = {
  list_calendars: handleListCalendars,
  list_events: handleListEvents,
  create_event: handleCreateEvent,
  update_event: handleUpdateEvent,
  delete_event: handleDeleteEvent,
  rsvp_event: handleRsvpEvent,
};
