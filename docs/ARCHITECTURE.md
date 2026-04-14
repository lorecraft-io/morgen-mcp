# morgen-mcp Architecture

Current as of v0.1.2 (2026-04-13).

## File Size Audit (500-line project limit)

| File                                      | Lines | Status |
|-------------------------------------------|------:|--------|
| src/index.js                              |   101 | OK     |
| src/client.js                             |   141 | OK     |
| src/validation.js                         |    47 | OK     |
| src/tools-events.js                       |   357 | OK     |
| src/tools-events-schema.js                |   181 | OK     |
| src/events-shape.js                       |   177 | OK     |
| src/calendar-cache.js                     |   132 | OK     |
| src/tools-tasks.js                        |   333 | OK     |
| bin/setup.js                              |    96 | OK     |
| tests/client.test.js                      |   234 | test suite, informational |
| tests/validation.test.js                  |   254 | test suite, informational |
| tests/security-errors.test.js             |   304 | test suite, informational |
| tests/security-input-content.test.js      |   255 | test suite, informational |
| tests/security-input-traversal.test.js    |   200 | test suite, informational |

All production files under the 500-line limit. `tools-events.js` was further trimmed in v0.1.2 by extracting `tools-events-schema.js` (pure JSON Schema definitions for the 6 event tools) and `calendar-cache.js` (in-memory default-calendar resolver), keeping each module single-purpose and well under budget. The security test suite was split from one monolithic file into three category-scoped files to keep each file readable.

## Dependency Graph

```
                      +----------------+
                      |  src/index.js  |  stdio entrypoint, env load, dispatch
                      +-------+--------+
                              |
                 +------------+------------+
                 |                         |
                 v                         v
        +------------------+      +------------------+
        | tools-events.js  |      | tools-tasks.js   |
        |  eventHandlers   |      |  TASK_TOOLS (7)  |
        |  (6 handlers)    |      |  taskHandlers    |
        +-+----+----+---+--+      +--+-----------+---+
          |    |    |   |            |           |
          |    |    |   +----+       |           |
          |    |    |        |       |           |
          |    |    v        v       |           |
          |    |  +--------------+ +--------------------+
          |    |  | tools-events-| | calendar-cache.js  |
          |    |  |  schema.js   | | getCalendarCache   |
          |    |  | EVENT_TOOLS  | | resolveCalendarMeta|
          |    |  |   (6 defs)   | | resolveDefaultMeta |
          |    |  +--------------+ +----+----------+----+
          |    |                        |          |
          |    v                        |          |
          |  +------------------+       |          |
          |  | events-shape.js  |<------+          |
          |  | mapCalendar      |                  |
          |  | mapEvent         |                  |
          |  | toParticipantMap |                  |
          |  | toLocationMap    |                  |
          |  | unwrap*          |                  |
          |  +------------------+                  |
          |                                        |
          v                                        v
        +-------------+<---------------------------+
        | client.js   |           +--------------------+
        | morgenFetch |           |  validation.js     |
        | rate limit  |           |  validateId,       |
        | retries     |           |  validateISODate,  |
        | key scrub   |           |  validateEnum,     |
        +------+------+           |  validateIntRange, |
               |                  |  validateStringArr |
               v                  +--------------------+
         (global fetch)
```

No circular imports. `index.js` depends on the two `tools-*` modules. `tools-events.js` depends on `tools-events-schema.js`, `events-shape.js`, `calendar-cache.js`, `client.js`, and `validation.js`. `calendar-cache.js` depends on `client.js` and `events-shape.js` (see `src/calendar-cache.js:46-60`). `tools-tasks.js` depends on `client.js` and `validation.js`. `client.js` and `validation.js` have zero intra-project imports.

## Tool Count

- `EVENT_TOOLS` — 6 (`list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `rsvp_event`), defined in `src/tools-events-schema.js`
- `TASK_TOOLS` — 7 (`list_tasks`, `create_task`, `update_task`, `move_task`, `close_task`, `reopen_task`, `delete_task`), defined in `src/tools-tasks.js`
- Total registered via `src/index.js`: **13**

## Separation of Concerns

- `index.js` — MCP stdio transport, env bootstrap, tool dispatch, URL-redacting error sanitization.
- `client.js` — HTTP wrapper (`morgenFetch`): 30s timeout, 3x retry on 429/503/network, rolling 100-point-per-15-minute rate limiter with accurate wait-time calculation, API key scrubbing in thrown errors.
- `validation.js` — pure input validators. No rate-limit logic (the canonical limiter lives in `client.js`).
- `tools-events-schema.js` — pure JSON Schema definitions for the six `EVENT_TOOLS` entries, zero runtime behavior.
- `tools-events.js` — event handler implementations; composes the schema module, shape helpers, and the calendar cache.
- `events-shape.js` — pure helpers: response unwrappers (`data.data.*`), `mapCalendar`, `mapEvent`, `toParticipantMap`, `toLocationMap`, `validateRecurrenceRules`.
- `calendar-cache.js` — 10-minute in-memory cache for `list_calendars` results so `create_event`/`update_event` calls that omit `calendar_id` don't spend 10 rate points per call.
- `tools-tasks.js` — task tool schemas + handlers. Priority is validated as integer 0-9 per the Morgen spec, not as a string enum.
- `bin/setup.js` — interactive first-run script that writes `MORGEN_API_KEY` into a local `.env` file.

## Consistency with motion-calendar-mcp

- **Intentional divergence — split files:** Motion ships one monolithic `src/index.js`. morgen-mcp splits into `index.js` / `client.js` / `tools-events.js` / `tools-events-schema.js` / `events-shape.js` / `calendar-cache.js` / `tools-tasks.js` / `validation.js` to respect the 500-line-per-file project rule and maintain clear bounded contexts.
- **Intentional divergence — simpler auth:** Motion uses OAuth via extracted Firebase refresh tokens. Morgen uses a single `Authorization: ApiKey <key>` header, so there is no token refresh cycle in `client.js`.
- **Intentional divergence — point-based rate limiter:** Motion tracks request counts; Morgen's documented limit is point-based (10 pts per list, 1 pt per write), so `client.js` ledgers points not requests.

## CLAUDE.md Compliance Matrix

| Rule                                    | Status |
|-----------------------------------------|--------|
| Files under 500 lines                   | PASS   |
| No stray files in repo root             | PASS   |
| Input validation at system boundaries   | PASS (every tool handler validates before fetch) |
| No secrets hardcoded                    | PASS (`MORGEN_API_KEY` read from env; `.env.example` ships without values) |
| DDD / bounded contexts                  | PASS (each module has a single clear responsibility) |

## Morgen API Shape Compliance

Every request body and response parser is aligned with the verified Morgen API shape documented in `docs/MORGEN-API-NOTES.md`:

- Base URL `https://api.morgen.so`.
- Auth header `Authorization: ApiKey <key>`.
- Doubly-wrapped list responses (`data.data.calendars`, `data.data.events`, `data.data.tasks`).
- Calendar objects: `readOnly` is derived from `myRights` (no `isPrimary`/`isReadOnly`/`timezone` fields on the wire).
- Event `participants` submitted as a keyed map `{ <email>: { "@type": "Participant", email, roles, participationStatus } }`.
- Event `locations` (plural) submitted as a keyed map with `{ "@type": "Location", name, ... }` entries — NEW in v0.1.2.
- Event `recurrenceRules` submitted as structured objects, not RFC 5545 RRULE strings.
- Event `seriesUpdateMode` sent as a query parameter on update/delete, not as a body field.
- `create_event` and `update_event` must send all four timing fields together (`start`, `duration`, `timeZone`, `showWithoutTime`); omitting `timeZone` is rejected by the API — NEW in v0.1.2.
- Task priority is integer 0-9 (0 = undefined, 1 = highest, 9 = lowest); task list field is `taskListId` (not `listId`); task timestamps use `created`/`updated` (not `createdAt`/`updatedAt`).
- `move_task` is implemented against `POST /v3/tasks/update` with a new `taskListId` in the body; there is no `/v3/tasks/move` endpoint — NEW in v0.1.2.
