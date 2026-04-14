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

### /v3/tasks/create response shape — echoes ONLY the ID
Verified live 2026-04-14 against the published API. The `POST /v3/tasks/create` endpoint returns:
```json
{ "data": { "id": "<uuid>" } }
```
It does **not** echo the full task object. To read back the created task with Morgen's server-side defaults applied (priority, progress, position, created/updated), call `/v3/tasks/list` and filter by the returned ID. The same applies to `/v3/tasks/update`.

### `tags` field — wire shape UNKNOWN
The Morgen docs list `tags (Array)` on the full task object but do **not** specify the entry shape. Sending `tags: ["string", "string"]` as a raw string array to `/v3/tasks/create` is rejected with HTTP 400 (verified 2026-04-14). Likely candidates, not yet tested:
- `tags: { "tag-name": { "@type": "Tag", "name": "..." } }` — keyed map à la participants/locations
- `tags: [{ "@type": "Tag", "name": "..." }]` — array of structured objects

**Action:** tags was temporarily removed from `create_task` + `update_task` in morgen-mcp v0.1.4 until the shape is confirmed against a live doc example or a `/v3/tasks/list` response that contains non-empty tags. Reintroduce in v0.1.5.

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
