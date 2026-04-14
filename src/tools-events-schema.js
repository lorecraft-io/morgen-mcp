// MCP tool definitions for Morgen event tools. Pulled into a separate file
// to keep tools-events.js under the 500-line project limit.

const SERIES_UPDATE_MODES = ["single", "future", "all"];
const RSVP_RESPONSES = ["accept", "decline", "tentative"];

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
      "List events within a date range across one or more calendars. If calendar_ids is omitted, queries every calendar on every account. Recurrences are expanded server-side.",
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
      "Create a calendar event. Defaults to the first writable calendar if calendar_id is omitted. Converts start/end from ISO 8601 UTC to Morgen's LocalDateTime + duration form using the configured timezone.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Calendar ID to create the event in. Defaults to the first writable calendar if omitted.",
        },
        title: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description: "Start time in ISO 8601 format (UTC or with offset)",
        },
        end: {
          type: "string",
          description:
            "End time in ISO 8601 format. Used to compute duration; the Morgen API itself stores duration, not end time.",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone for the event (e.g. 'America/New_York'). Defaults to MORGEN_TIMEZONE env var or America/New_York.",
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
          description: "New end time in ISO 8601 format. Used to recompute duration.",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone. Defaults to MORGEN_TIMEZONE env var or America/New_York.",
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
        event_id: { type: "string", description: "The event ID to respond to" },
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

export { SERIES_UPDATE_MODES, RSVP_RESPONSES };
