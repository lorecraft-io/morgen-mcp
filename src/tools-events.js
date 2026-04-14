import { morgenFetch } from "./client.js";
import {
  validateId,
  validateISODate,
  validateEnum,
  validateStringArray,
} from "./validation.js";
import {
  mapCalendar,
  mapEvent,
  toParticipantMap,
  unwrapCalendars,
  unwrapEvent,
  unwrapEvents,
  validateParticipantEmails,
  validateRecurrenceRules,
} from "./events-shape.js";

const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_LOCATION_LEN = 500;
const MAX_ID_LEN = 500;

const SERIES_UPDATE_MODES = ["single", "future", "all"];
const RSVP_RESPONSES = ["accept", "decline", "tentative"];

// Default calendar cache — list_calendars costs 10 rate points per call.
// Caching avoids burning the rate budget when create_event defaults to first calendar.
const DEFAULT_CALENDAR_TTL_MS = 10 * 60 * 1000;
let cachedDefaultCalendarId = null;
let cachedDefaultCalendarExpiry = 0;

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

async function resolveDefaultCalendarId() {
  const now = Date.now();
  if (cachedDefaultCalendarId && cachedDefaultCalendarExpiry > now) {
    return cachedDefaultCalendarId;
  }
  const data = await morgenFetch("/v3/calendars/list", { points: 10 });
  const raw = unwrapCalendars(data);
  const first = raw.find((c) => c && c.id);
  if (!first) {
    throw new Error(
      "No calendars available on this account. Connect a calendar in Morgen first."
    );
  }
  cachedDefaultCalendarId = first.id;
  cachedDefaultCalendarExpiry = now + DEFAULT_CALENDAR_TTL_MS;
  return cachedDefaultCalendarId;
}

export function _resetDefaultCalendarCache() {
  cachedDefaultCalendarId = null;
  cachedDefaultCalendarExpiry = 0;
}

// ---------- tool definitions ----------

export const EVENT_TOOLS = [
  {
    name: "list_calendars",
    description:
      "List all calendars connected to your Morgen account. Returns calendar IDs, names, colors, account associations, and read-only status.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_events",
    description:
      "List events within a date range across one or more calendars. Recurrences are automatically expanded by the server.",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "ISO 8601 start of the range (e.g. 2026-04-13T00:00:00Z)",
        },
        end: {
          type: "string",
          description: "ISO 8601 end of the range (e.g. 2026-04-20T00:00:00Z)",
        },
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter to specific calendar IDs. Use list_calendars to discover IDs.",
        },
      },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "create_event",
    description:
      "Create a calendar event. Defaults to the first calendar if calendar_id is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Calendar ID to create the event in. Defaults to the first available calendar if omitted.",
        },
        title: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description: "Start time in ISO 8601 format",
        },
        end: {
          type: "string",
          description: "End time in ISO 8601 format",
        },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
        participants: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of participant email addresses. Each is sent as an attendee; Morgen assigns roles and participation status server-side.",
        },
        recurrence_rules: {
          type: "array",
          description:
            "Morgen RecurrenceRule objects (not RFC 5545 strings). Example: [{\"@type\":\"RecurrenceRule\",\"frequency\":\"weekly\",\"interval\":1,\"byDay\":[{\"@type\":\"NDay\",\"day\":\"mo\"}]}].",
          items: { type: "object" },
        },
      },
      required: ["title", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "update_event",
    description:
      "Update an existing event. For recurring events, use series_update_mode to control whether a single occurrence, future occurrences, or the entire series is updated.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The event ID to update" },
        calendar_id: {
          type: "string",
          description: "The calendar ID the event belongs to",
        },
        title: { type: "string", description: "New event title" },
        start: {
          type: "string",
          description: "New start time in ISO 8601 format",
        },
        end: {
          type: "string",
          description: "New end time in ISO 8601 format",
        },
        description: { type: "string", description: "New description" },
        location: { type: "string", description: "New location" },
        participants: {
          type: "array",
          items: { type: "string" },
          description: "Replacement participant email list",
        },
        series_update_mode: {
          type: "string",
          enum: SERIES_UPDATE_MODES,
          description:
            "For recurring events: 'single' (this occurrence, default), 'future' (this and future), or 'all' (entire series). Sent as a query parameter.",
        },
      },
      required: ["event_id", "calendar_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_event",
    description:
      "Delete an event by ID. For recurring events, use series_update_mode to control scope.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The event ID to delete" },
        calendar_id: {
          type: "string",
          description: "The calendar ID the event belongs to",
        },
        series_update_mode: {
          type: "string",
          enum: SERIES_UPDATE_MODES,
          description:
            "For recurring events: 'single' (default), 'future', or 'all'. Sent as a query parameter.",
        },
      },
      required: ["event_id", "calendar_id"],
      additionalProperties: false,
    },
  },
  {
    name: "rsvp_event",
    description:
      "Respond to an event invitation. Accepts, declines, or marks tentative.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The event ID to respond to",
        },
        calendar_id: {
          type: "string",
          description: "The calendar ID the event belongs to",
        },
        response: {
          type: "string",
          enum: RSVP_RESPONSES,
          description: "RSVP response: 'accept', 'decline', or 'tentative'",
        },
      },
      required: ["event_id", "calendar_id", "response"],
      additionalProperties: false,
    },
  },
];

// ---------- handlers ----------

async function handleListCalendars() {
  const data = await morgenFetch("/v3/calendars/list", { points: 10 });
  const raw = unwrapCalendars(data);
  const calendars = raw.map(mapCalendar);
  return { calendars, total: calendars.length };
}

async function handleListEvents(args = {}) {
  validateISODate(args.start, "start");
  validateISODate(args.end, "end");

  const startMs = Date.parse(args.start);
  const endMs = Date.parse(args.end);
  if (endMs < startMs) {
    throw new Error("end must be on or after start");
  }

  let calendarIds = [];
  if (args.calendar_ids !== undefined) {
    validateStringArray(args.calendar_ids, "calendar_ids", 100);
    calendarIds = args.calendar_ids.map((id) => {
      if (!id || typeof id !== "string" || id.length > MAX_ID_LEN) {
        throw new Error("calendar_ids entries must be valid calendar IDs");
      }
      return validateId(id, "calendar_ids");
    });
  }

  const params = new URLSearchParams();
  params.set("start", args.start);
  params.set("end", args.end);
  if (calendarIds.length > 0) {
    params.set("calendarIds", calendarIds.join(","));
  }

  const data = await morgenFetch(`/v3/events/list?${params.toString()}`, {
    points: 10,
  });

  const raw = unwrapEvents(data);
  const events = raw.map(mapEvent);
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

  let calendarId = args.calendar_id;
  if (calendarId) {
    calendarId = validateId(calendarId, "calendar_id");
  } else {
    calendarId = await resolveDefaultCalendarId();
  }

  const body = {
    calendarId,
    title: args.title,
    start: args.start,
    end: args.end,
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
  const calendarId = validateId(args.calendar_id, "calendar_id");

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

  const body = { id: eventId, calendarId };
  if (args.title !== undefined) body.title = args.title;
  if (args.start !== undefined) body.start = args.start;
  if (args.end !== undefined) body.end = args.end;
  if (args.description !== undefined) body.description = args.description;
  if (args.location !== undefined) body.location = args.location;
  if (args.participants !== undefined) {
    body.participants = toParticipantMap(args.participants);
  }

  // seriesUpdateMode is a query parameter per docs.morgen.so/events, NOT a body field.
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
  const calendarId = validateId(args.calendar_id, "calendar_id");

  if (args.series_update_mode !== undefined) {
    validateEnum(
      args.series_update_mode,
      SERIES_UPDATE_MODES,
      "series_update_mode"
    );
  }

  // seriesUpdateMode is a query parameter, not a body field.
  const params = new URLSearchParams();
  if (args.series_update_mode !== undefined) {
    params.set("seriesUpdateMode", args.series_update_mode);
  }
  const qs = params.toString();
  const path = qs ? `/v3/events/delete?${qs}` : "/v3/events/delete";

  await morgenFetch(path, {
    method: "POST",
    body: { id: eventId, calendarId },
    points: 1,
  });

  return {
    success: true,
    deletedId: eventId,
    calendarId,
    seriesUpdateMode: args.series_update_mode,
  };
}

async function handleRsvpEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  const calendarId = validateId(args.calendar_id, "calendar_id");
  validateEnum(args.response, RSVP_RESPONSES, "response");

  const path = `/v3/events/${args.response}`;
  const data = await morgenFetch(path, {
    method: "POST",
    body: { id: eventId, calendarId },
    points: 1,
  });

  return {
    success: true,
    eventId,
    calendarId,
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
