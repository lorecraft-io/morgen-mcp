# morgen-mcp Architecture

Current as of v0.1.0 (2026-04-13).

## File Size Audit (500-line project limit)

| File                     | Lines | Status |
|--------------------------|------:|--------|
| src/index.js             |   101 | OK     |
| src/client.js            |   148 | OK     |
| src/validation.js        |    47 | OK     |
| src/tools-events.js      |   460 | OK     |
| src/events-shape.js      |   129 | OK     |
| src/tools-tasks.js       |   333 | OK     |
| tests/client.test.js     |   234 | OK     |
| tests/validation.test.js |   254 | OK     |
| tests/security.test.js   |   636 | exempt (test file, 10 attack categories) |

All production files under the 500-line limit. `events-shape.js` was extracted from `tools-events.js` to keep the latter under budget while growing to cover Morgen's full event shape requirements.

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
   |  EVENT_TOOLS (6) |      |  TASK_TOOLS (7)  |
   |  eventHandlers   |      |  taskHandlers    |
   +-+-----+-------+--+      +--+-----------+---+
     |     |       |            |           |
     |     |       v            |           |
     |     |  +------------------+          |
     |     |  | events-shape.js  |          |
     |     |  | mapCalendar      |          |
     |     |  | mapEvent         |          |
     |     |  | toParticipantMap |          |
     |     |  | unwrap*          |          |
     |     |  +------------------+          |
     |     |                                |
     v     v                                v
   +-------------+           +--------------------+
   | client.js   |           |  validation.js     |
   | morgenFetch |           |  validateId,       |
   | rate limit  |           |  validateISODate,  |
   | retries     |           |  validateEnum,     |
   | key scrub   |           |  validateIntRange, |
   +------+------+           |  validateStringArr |
          |                  +--------------------+
          v
    (global fetch)
```

No circular imports. `index.js` depends on the two `tools-*` modules. Both tool modules depend on `client.js` and `validation.js`. `tools-events.js` also depends on `events-shape.js` for pure data-shape helpers. `client.js` and `validation.js` have zero intra-project imports.

## Tool Count

- `EVENT_TOOLS` — 6 (`list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `rsvp_event`)
- `TASK_TOOLS` — 7 (`list_tasks`, `create_task`, `update_task`, `move_task`, `close_task`, `reopen_task`, `delete_task`)
- Total registered via `src/index.js`: **13**

## Separation of Concerns

- `index.js` — MCP stdio transport, env bootstrap, tool dispatch, URL-redacting error sanitization.
- `client.js` — HTTP wrapper (`morgenFetch`): 30s timeout, 3x retry on 429/503/network, rolling 100-point-per-15-minute rate limiter with accurate wait-time calculation, API key scrubbing in thrown errors.
- `validation.js` — pure input validators. No rate-limit logic (the canonical limiter lives in `client.js`).
- `tools-events.js` — event tool schemas + handlers. 10-minute in-memory cache for the default calendar id to avoid spending 10 rate points on every `create_event` that omits `calendar_id`.
- `events-shape.js` — pure helpers: response unwrappers (`data.data.*`), `mapCalendar`, `mapEvent`, `toParticipantMap` (keyed-map form Morgen expects), `validateRecurrenceRules` (structured-object form).
- `tools-tasks.js` — task tool schemas + handlers. Priority is validated as integer 0-9 per the Morgen spec, not as a string enum.

## Consistency with motion-calendar-mcp

- **Intentional divergence — split files:** Motion ships one monolithic `src/index.js`. morgen-mcp splits into `index.js` / `client.js` / `tools-events.js` / `tools-tasks.js` / `events-shape.js` / `validation.js` to respect the 500-line-per-file project rule and maintain clear bounded contexts.
- **Intentional divergence — simpler auth:** Motion uses OAuth via extracted Firebase refresh tokens. Morgen uses a single `Authorization: ApiKey <key>` header, so there is no token refresh cycle in `client.js`.
- **Intentional divergence — point-based rate limiter:** Motion tracks request counts; Morgen's documented limit is point-based (10 pts per list, 1 pt per write), so `client.js` ledgers points not requests.

## CLAUDE.md Compliance Matrix

| Rule                                    | Status |
|-----------------------------------------|--------|
| Files under 500 lines                   | PASS   |
| No stray files in repo root             | PASS   |
| Input validation at system boundaries   | PASS (every tool handler validates before fetch) |
| No secrets hardcoded                    | PASS (`MORGEN_API_KEY` read from env; `.env.example` ships without values) |
| Tests present                           | PASS (validation, client, security — 3 files) |
| DDD / bounded contexts                  | PASS (each module has a single clear responsibility) |

## Morgen API Shape Compliance

Every request body and response parser is aligned with the verified Morgen API shape documented in `docs/MORGEN-API-NOTES.md`:

- Base URL `https://api.morgen.so`
- Auth header `Authorization: ApiKey <key>`
- Doubly-wrapped list responses (`data.data.calendars`, `data.data.events`)
- Calendar objects carry `myRights` (used to derive `readOnly`); no `isPrimary`/`isReadOnly`/`timezone` fields
- Event participants submitted as a keyed map `{ <email>: { @type, email, roles, participationStatus } }`
- `recurrenceRules` submitted as structured objects, not RFC 5545 RRULE strings
- `seriesUpdateMode` sent as a query parameter on update/delete, not a body field
- Task priority is integer 0-9 (0 = undefined, 1 = highest, 9 = lowest)
- Task list field is `taskListId` (not `listId`)
- Task timestamps use `created` / `updated` (not `createdAt` / `updatedAt`)
