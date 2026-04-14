# morgen-mcp Performance Notes

Current as of v0.1.2 (2026-04-13). Reference: https://docs.morgen.so/rate-limits

## Morgen Rate Limit Budget

- **100 points per 15-minute rolling window** per API key
- `/list` endpoints cost **10 points** each
- All other endpoints cost **1 point** each

The client rejects requests with points > 100 upfront, preventing indefinite waits on misconfigured endpoints.

## Steady-State Throughput

| Workload                                         | Req / 15 min | Points | Headroom |
|--------------------------------------------------|-------------:|-------:|---------:|
| Pure list calls                                  |           10 |    100 |        0 |
| Pure writes                                      |          100 |    100 |        0 |
| Mixed (5 lists + 50 writes)                      |           55 |    100 |        0 |
| Realistic (1 list + 90 writes)                   |           91 |    100 |        0 |
| Heavy read (8 lists + 20 writes)                 |           28 |    100 |        0 |
| Multi-account unfiltered list_events (4 accts)   |            1 |     40 |       60 |

One list call consumes 10% of the window budget. A user running `list_events` every 30 seconds for 5 minutes would burn the entire budget in 10 calls. On Nathan's 4-account setup, a single unfiltered `list_events` fans out to one `/v3/events/list` call per account (see `src/tools-events.js:131-139`), costing 40 points — 40% of the budget in one tool call.

## Client Rate Limiter

The limiter in `src/client.js` is point-based, rolling-window, and enforces the budget _before_ making a request.

- Ledger entries: `{ timestamp, points }` (`src/client.js:6`)
- Pruning: every call drops entries older than 15 minutes (`src/client.js:9-12`)
- Upfront budget guard (new in v0.1.2): `enforceRateLimit` rejects any request whose `points` exceeds `RATE_LIMIT_POINTS` before touching the ledger (`src/client.js:37-41`). A caller who passes `points: 150` fails immediately rather than waiting forever for a slot that can never open.
- `msUntilFits` walks the ledger forward, summing points that must expire before the incoming request fits (`src/client.js:22-34`). This prevents the retry-storm pattern where a naive calculation reports "wait 30 seconds" but the request still fails because only the oldest entry expired.
- Errors thrown from `morgenFetch` run through `scrubKey()` to strip both full URLs and the `MORGEN_API_KEY` value before propagating to the caller (`src/client.js:96-104`).

## Default Calendar Cache

The cache lives in `src/calendar-cache.js` — not `src/tools-events.js`. Every Morgen write endpoint requires both `calendarId` AND `accountId`, so the module caches the full calendar directory (not just the default id) in `byId` and `byAccount` lookup maps. Without caching, each default-path `create_event` would cost 11 points (10 list + 1 create), dropping effective write throughput from 100 to 9 per window.

`loadCache()` hits `/v3/calendars/list` once, builds the lookup maps, picks the first writable calendar as the default, and stores the result for **10 minutes** (`src/calendar-cache.js:8`, `:42-44`).

Promise-dedupe fix (new in v0.1.2): two concurrent callers on a cold cache share the same in-flight fetch via a `loadingPromise` guard, preventing 2× the rate cost on startup. See `src/calendar-cache.js:47-54` — if `loadingPromise` is non-null, a second caller awaits the same promise instead of firing a duplicate `/v3/calendars/list` request. The promise clears in a `.finally()` so the next cold read can retry cleanly.

Test code can reset the cache via `_resetCalendarCache()` (`src/calendar-cache.js:98-102`), which also clears any pending `loadingPromise`.

## Points Assignment

| Handler                                                     | Points |
|-------------------------------------------------------------|-------:|
| `list_calendars`, `list_events`, `list_tasks`               |     10 |
| All create / update / delete / move / close / reopen / rsvp |      1 |

All handler call sites pass `points` explicitly to `morgenFetch`.

## Observability

- Structured JSON log lines are emitted to stderr on every tool call from `src/index.js`:
  `{ event: "tool_call", tool, status: "success" | "error", durationMs, error? }`
- No external observability integration (OpenTelemetry, Sentry, etc.) — acceptable for a local stdio MCP. Claude Code surfaces the stderr logs in its debugger panel.

## Future Optimizations (not required for v0.1.2)

- Add a pre-flight budget warning when `currentPoints() > 80`, logged to stderr.
- Optionally cache `list_events` / `list_tasks` responses for 30 seconds to survive bursty AI workflows.
- Pin cache TTL to an env var (e.g. `MORGEN_CACHE_TTL_MS`) for per-deployment tuning of the 10-minute default.
