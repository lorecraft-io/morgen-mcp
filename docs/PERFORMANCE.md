# morgen-mcp Performance Notes

Current as of v0.1.0 (2026-04-13). Reference: https://docs.morgen.so/rate-limits

## Morgen Rate Limit Budget

- **100 points per 15-minute rolling window** per API key
- `/list` endpoints cost **10 points** each
- All other endpoints cost **1 point** each

## Steady-State Throughput

| Workload                         | Req / 15 min | Points | Headroom |
|----------------------------------|-------------:|-------:|---------:|
| Pure list calls                  |           10 |    100 |        0 |
| Pure writes                      |          100 |    100 |        0 |
| Mixed (5 lists + 50 writes)      |           55 |    100 |        0 |
| Realistic (1 list + 90 writes)   |           91 |    100 |        0 |
| Heavy read (8 lists + 20 writes) |           28 |    100 |        0 |

One list call consumes 10% of the window budget. A user running `list_events` every 30 seconds for 5 minutes would burn the entire budget in 10 calls.

## Client Rate Limiter (`src/client.js`)

The limiter is point-based, rolling-window, and enforces the budget _before_ making a request.

- Ledger entries: `{ timestamp, points }`
- Pruning: every call drops entries older than 15 minutes
- Over-budget wait calculation walks the ledger forward, summing points that must expire before the incoming request fits. This prevents the retry-storm pattern where a naive calculation reports "wait 30 seconds" but the request still fails because only the oldest entry expired.
- Errors thrown from `morgenFetch` run through `scrubKey()` to strip both full URLs and the `MORGEN_API_KEY` value before propagating to the caller.

## Default Calendar Cache (`src/tools-events.js`)

`handleCreateEvent` needs a calendar id. When the caller omits `calendar_id`, the handler resolves the default by hitting `/v3/calendars/list` (10 points). Without caching, every default-path `create_event` would cost 11 points (10 list + 1 create), dropping effective write throughput from 100 to 9 per window.

The module caches the resolved default calendar id for **10 minutes**:

```js
const DEFAULT_CALENDAR_TTL_MS = 10 * 60 * 1000;
let cachedDefaultCalendarId = null;
let cachedDefaultCalendarExpiry = 0;
```

After the first call, subsequent `create_event` calls in the cache window cost just 1 point each. Test code can reset the cache via `_resetDefaultCalendarCache()`.

## Points Assignment

| Handler                                     | Points |
|---------------------------------------------|-------:|
| `list_calendars`, `list_events`, `list_tasks` |     10 |
| All create / update / delete / move / close / reopen / rsvp |      1 |

All handler call sites pass `points` explicitly to `morgenFetch`.

## Observability

- Structured JSON log lines are emitted to stderr on every tool call from `src/index.js`:
  `{ event: "tool_call", tool, status: "success" | "error", durationMs, error? }`
- No external observability integration (OpenTelemetry, Sentry, etc.) — acceptable for a local stdio MCP. Claude Code surfaces the stderr logs in its debugger panel.

## Future Optimizations (not required for v0.1.0)

- Add a pre-flight budget warning when `currentPoints() > 80`, logged to stderr.
- Optionally cache `list_events` / `list_tasks` responses for 30 seconds to survive bursty AI workflows.
- Add a Morgen-budget-aware test that simulates 11 consecutive list calls and asserts the 11th fails with a `secondsUntilExpiry` matching the expiry of the first entry.
