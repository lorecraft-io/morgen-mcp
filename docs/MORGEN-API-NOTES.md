# Morgen API Reference Notes

Authoritative facts verified against docs.morgen.so on 2026-04-13. Every claim cites its source URL.

## Base URL

- **`https://api.morgen.so`** (NOT `sync.morgen.so`)
- All endpoints live under `/v3/...`
- Source: https://docs.morgen.so/events and https://docs.morgen.so/calendars
- Verbatim example: `fetch("https://api.morgen.so/v3/calendars/list", ...)`

## Authentication

- Header: **`Authorization: ApiKey <API_KEY>`** (literal word "ApiKey", space, key — not "Bearer", not "X-API-Key")
- Source: https://docs.morgen.so/events
- Verbatim: `Authorization: "ApiKey <API_KEY>"`
- Obtain key at platform.morgen.so → Developers API page.
- Source: https://docs.morgen.so/authentication

## Tasks (`/v3/tasks/...`)

Source: https://docs.morgen.so/tasks

### Priority — INTEGER, not enum
- Type: `Number`
- Range: `0–9`
- Semantics: `0 = undefined, 1 = highest, 9 = lowest`
- NOT `low | normal | high | urgent`.

### Task list field — `taskListId` (NOT `listId`)
- Example value: `"taskListId": "default"`

### Full task object fields
`@type`, `id`, `accountId`, `integrationId`, `taskListId`, `created`, `updated`, `title`, `description`, `descriptionContentType`, `due`, `timeZone`, `estimatedDuration`, `priority` (Number), `progress` (String), `position` (Number), `relatedTo` (Object), `tags` (Array).

Note: `created`/`updated` timestamps (not `createdAt`/`updatedAt`). No `completed` boolean — status is represented via `progress` (String).

### Task-to-calendar scheduling — NOT exposed by the public API
Confirmed 2026-04-14. Morgen's web app has a drag-task-to-calendar feature that produces events with `morgen.so:metadata.taskId` set (and the checkbox render in the UI). **This mechanism is NOT exposed by the public v3 API.** Specifically verified:

- `/v3/tasks/update` whitelist-rejects `start`, `scheduledStart`, `calendarId`, `accountId`. Error: `"property <field> should not exist"`.
- `/v3/events/create` with `morgen.so:metadata.taskId` in the body rejects with either `"An event with canBeCompleted cannot have a taskId"` (when `canBeCompleted: true`) or `"Invalid event id"` (when `canBeCompleted: false`).
- `/v3/events/update` with top-level `taskId` rejects: `"property taskId should not exist"`.
- No endpoint exists at `/v3/tasks/schedule`, `/v3/tasks/plan`, `/v3/tasks/block`, `/v3/tasks/timeblock`, `/v3/events/fromTask`, `/v3/events/createFromTask`, `/v3/events/linkTask`, `/v3/tasks/scheduleOn`, `/v3/tasks/planAt`, `/v3/calendars/block-task`, or `/v3/tasks/scheduleInCalendar`. All return 404.
- The `morgen.so:metadata` field on an event is documented as **read-only** at https://docs.morgen.so/events.

**Workaround:** create the task via `/v3/tasks/create`, then have the user drag it to a time slot in the Morgen web app. The drag triggers Morgen's private linking endpoint which is not in the public API. File a feature request with Morgen support to expose it.

### /v3/tasks/create response shape — echoes ONLY the ID
Verified live 2026-04-14 against the published API. The `POST /v3/tasks/create` endpoint returns:
```json
{ "data": { "id": "<uuid>" } }
```
It does **not** echo the full task object. To read back the created task with Morgen's server-side defaults applied (priority, progress, position, created/updated), call `/v3/tasks/list` and filter by the returned ID. The same applies to `/v3/tasks/update`.

### `tags` field — array of tag ID strings (UUIDs), NOT labels
Confirmed against https://docs.morgen.so/tasks and https://docs.morgen.so/tags on 2026-04-14.

On the Task object, `tags` is an array of **tag ID strings** (UUIDs referencing Tag resources), not an array of human-readable label strings and not an array of typed objects. Verbatim doc example:

```json
"tags": ["550e8400-e29b-41d4-a716-446655440000"]
```

Tags are a first-class resource. Each Tag has its own schema and CRUD endpoints:

```ts
interface Tag {
  id: string;       // UUID
  name?: string;    // display label
  color?: string;   // "#RRGGBB"
  updated?: string; // ISO 8601
  deleted?: boolean;
}
```

- `GET  /v3/tags/list`          — list tags (optional `limit`, `updatedAfter`)
- `GET  /v3/tags?id=<TAG_ID>`   — fetch single tag
- `POST /v3/tags/create`        — body: `{ name: string, color?: string }` → `{ data: { id } }`
- `POST /v3/tags/update`        — body: `{ id, name?, color? }` (name/color cannot be unset once set)
- `POST /v3/tags/delete`        — body: `{ id }`

### Why v0.1.4 tags broke (HTTP 400)
morgen-mcp ≤ v0.1.3 forwarded user-supplied label strings directly (`tags: ["urgent","admin"]`) into the `/v3/tasks/create` body. Morgen expected UUID references to pre-existing Tag resources, so the label strings failed validation and the whole create call 400'd. Removing the param in v0.1.4 was the correct temporary fix.

### v0.1.5 plan — label-to-ID resolution layer
Restore a *user-friendly* tags param at the MCP surface (array of label strings) and do the label→ID resolution inside the handler:

1. At create_task / update_task entry, if `tags` was provided:
   a. Call `/v3/tags/list` once per handler invocation and build a label→id map (case-insensitive).
   b. For each requested label, reuse the existing Tag if found; otherwise call `/v3/tags/create` with `{ name: label }` and capture the new ID.
   c. Replace `body.tags` with the resolved `[tagId, ...]` array before POSTing to `/v3/tasks/create` (or `/update`).
2. Rate-limit budget per call with tags: 10 (list) + 1 per missing tag (create) + 1 (task create/update). Cache the label→id map in-process for the duration of the handler only — do not persist across calls (tag state can change server-side).
3. Keep the MCP-facing schema as `{ type: "array", items: { type: "string" } }` with a description clarifying "human-readable labels; auto-created on first use".

## Events (`/v3/events/...`)

Source: https://docs.morgen.so/events

### Recurrence — `recurrenceRules`, array of STRUCTURED OBJECTS (not RFC 5545 RRULE strings)
Verbatim example:
```json
"recurrenceRules": [{
  "@type": "RecurrenceRule",
  "frequency": "weekly",
  "interval": 1,
  "byDay": [{ "@type": "NDay", "day": "mo" }]
}]
```

### `seriesUpdateMode`
- Query parameter (not body field).
- Values: `all`, `future`, `single`
- Default: `single`

### Participants
- Map keyed by participant ID. Each value:
```json
{
  "@type": "Participant",
  "name": "John Doe",
  "email": "doe@morgen.so",
  "roles": { "attendee": true, "owner": true },
  "participationStatus": "needs-action",
  "accountOwner": true
}
```
- Fields: `name`, `email`, `roles` (object), `participationStatus` (NOT `responseStatus` or `status`).
- No separate `organizer` field — organizer is the participant with `roles.owner === true`.

## Calendars (`/v3/calendars/list`)

Source: https://docs.morgen.so/calendars

### Response shape — `{ data: { calendars: [...] } }` (doubly-wrapped)

### Calendar object fields
`@type` ("Calendar"), `id`, `accountId`, `integrationId` (e.g. `"o365"`), `name`, `color`, `sortOrder`, `myRights` (permissions object: `mayReadItems`, `mayWriteAll`, etc.), `defaultAlertsWithTime`, `defaultAlertsWithoutTime`, `morgen.so:metadata` (`busy`, `overrideColor`, `overrideName`).

Note: **no `isPrimary`, no `isReadOnly`, no `timezone` field.** Read-only is derived from `myRights`. Account-default status is not exposed as `isPrimary`.
