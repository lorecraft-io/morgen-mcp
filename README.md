# Morgen MCP

**Natural-language calendar and task control for Morgen in Claude Code.**

[![npm version](https://img.shields.io/npm/v/morgen-mcp)](https://www.npmjs.com/package/morgen-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

---

## How It Works

Once installed, you just talk to Claude. No commands to memorize, no special syntax, no API calls to learn. You speak in plain English and Claude handles the rest.

```
You:    "What's on my calendar this week?"
You:    "Add a task called 'Review contracts' due Friday, high priority"
You:    "Move my 3pm to 4pm tomorrow"
You:    "Mark the laundry task as done"
You:    "Decline the 5pm invite"
You:    "Create a 30-minute call with drew@example.com Thursday at 2pm"
```

That's it. Claude sees your Morgen calendars and tasks, understands your schedule, and takes action -- all through natural conversation. No buttons, no UI, no context switching. You stay in your terminal and your day stays in sync.

---

## Why This Exists

Morgen is one of the cleanest calendar-plus-task apps on the market. It unifies Google, Outlook, iCloud, and native tasks into a single auto-scheduling interface, and it ships a genuinely well-designed public API.

This MCP wraps that API and hands the whole surface to Claude Code -- events, tasks, RSVPs, calendars, the lot. One API key, one install command, and you are talking to your calendar in natural language.

Unlike other calendar integrations that require extracting refresh tokens from browser storage or juggling multiple credentials, Morgen uses a single API key. You grab it from their developer portal, drop it in the config, and you are done.

## Features

### Event Tools

| Tool | Description |
|---|---|
| `list_calendars` | List all Morgen calendars with id, name, color, account, sort order, and read-only status |
| `list_events` | Fetch events in a date range across one or more calendars with full details |
| `create_event` | Create an event with title, time, participants, description, location, and recurrence |
| `update_event` | Update an event; supports `seriesUpdateMode` for editing recurring events (this, following, all) |
| `delete_event` | Delete an event by ID |
| `rsvp_event` | Accept, decline, or tentatively respond to an invitation |

### Task Tools

| Tool | Description |
|---|---|
| `list_tasks` | List native Morgen tasks |
| `create_task` | Create a new task with title, description, due date, priority (integer 0-9; 1 = highest, 9 = lowest), and tag labels |
| `update_task` | Update an existing task -- change title, description, due date, priority, or tag labels |
| `move_task` | Move a task to a different list |
| `close_task` | Mark a task as completed |
| `reopen_task` | Reopen a completed task |
| `delete_task` | Delete a task permanently |

> **Note on `tags` (v0.1.5):** Pass tags as an array of human-readable **label strings** (e.g. `["urgent","admin"]`). The MCP resolves each label to a Morgen tag UUID via `/v3/tags/list` + `/v3/tags/create` and auto-creates any tag that doesn't already exist. Match is case-insensitive. This costs an extra 10 rate-limit points per tagged call (for the tags/list lookup) plus 1 point per newly-created tag.

> **Note on create/update responses:** Morgen's `/v3/tasks/create` and `/v3/tasks/update` responses only echo the task ID — not the full object. `create_task` and `update_task` synthesize a return shape from the request body + returned ID for immediate use. For server-authoritative state (after Morgen applies defaults), call `list_tasks` afterwards.

> **Note on task scheduling:** Morgen's public API does NOT expose the task-to-calendar linkage (the `morgen.so:metadata.taskId` field on events is read-only). A task created via `create_task` lands in the Morgen inbox WITHOUT a calendar slot. To get the checkbox-on-calendar render that Morgen's web app produces when you drag a task to a time slot, drag it manually in the Morgen UI once — there is no public endpoint for this as of 2026-04-14.

### Reflow Tools

| Tool | Description |
|---|---|
| `reflow_day` | Compress a day's events back-to-back starting from an anchor time. Defaults to dry_run mode. Auto-filters to solo blocks (no external participants) so real meetings never move. Pass `event_ids` to reflow an explicit set, or let the tool auto-detect solo blocks on the target calendar. Capped at 50 `event_ids` per call for rate-limit safety. On partial failure (mid-loop update_event errors), throws a structured error with `applied_steps` + `pending_steps` so you can recover manually. |

### Conversion Tools

| Tool | Description |
|---|---|
| `event_to_task` | Soft-convert a calendar event into a Morgen task. Bundles `create_task` + `delete_event` into one call. The resulting task lands in your Morgen inbox — Morgen's public API does not expose the task-to-calendar linkage, so you'll need to drag the task to a calendar slot manually in the Morgen web app to get the checkbox render. Pass `delete_original: false` to keep the source event. |

### Natural language support (v0.1.6)

Every tool that takes a date, time, or recurrence pattern now accepts natural language in addition to strict ISO / Morgen shapes. You never have to hand-build an ISO 8601 string or a `RecurrenceRule` object unless you want to.

**Date and time inputs** — `create_event.start`, `create_event.end`, `update_event.start`, `update_event.end`, `list_events.start`, `list_events.end`, `create_task.due`, `update_task.due`, `event_to_task.due`, `reflow_day.date`, and `reflow_day.anchor_time` all accept casual phrases:

```
"tomorrow at 3pm"
"next friday 10am"
"in 2 hours"
"friday at 5pm"
"today"
"next monday"
"1pm"
"3:30pm"
```

ISO 8601 still works unchanged — if the string already matches `YYYY-MM-DDTHH:MM` (or `YYYY-MM-DD` for date-only fields, or `HH:MM` for time-only fields), it's passed through untouched. Natural-language parsing respects the caller's timezone, so "tomorrow at 9am" resolves to a different UTC instant in `America/New_York` vs `Europe/London`.

**Recurrence** — `create_event.recurrence_rules` and `update_event.recurrence_rules` now accept a plain string *or* the original array of Morgen `RecurrenceRule` objects:

```
"daily" / "every day"
"weekly" / "every week"
"monthly" / "yearly" / "annually"
"every 2 weeks" / "biweekly" / "every other week"
"every monday"
"every tuesday and thursday"
"weekdays" / "weekends"
"first monday of every month"
"last friday of every month"
"every 6 months"
```

Example — a weekly 1:1 that Claude can now wire up from a sentence:

> "Create a 30-minute call with drew@example.com every tuesday at 2pm"

The old hand-built `recurrence_rules: [{ "@type": "RecurrenceRule", frequency: "weekly", ... }]` shape is still accepted unchanged, so existing scripted callers don't need to migrate.

**Example:** *"I just finished the Mama call early. Reflow the rest of today's focus blocks starting at 1:00 PM, dry run first."*

```
reflow_day {
  anchor_time: "13:00",
  dry_run: true
}
```

Returns a plan showing each event's old start → new start. Re-run with `dry_run: false` to commit.

## Important Note About Tasks

Morgen's `/tasks` endpoints only manage **first-party native Morgen tasks** -- the ones created directly inside Morgen with `integrationId: "morgen"`. Tasks that Morgen syncs in from external providers like Todoist, Google Tasks, Microsoft To Do, or Things are fully visible in the Morgen app but are **not writable through this MCP**. The Morgen API intentionally scopes write access to its own first-party task system.

The practical takeaway: if you want Claude to create, update, and close tasks programmatically, create them as native Morgen tasks. Everything else stays read-only from Morgen's side and should be managed through that provider's own integration.

## Quick Install

One command. That is it.

```bash
claude mcp add morgen --env MORGEN_API_KEY=your_key_here -- npx -y morgen-mcp
```

Then restart Claude Code and start talking to your calendar.

## Setup

Morgen authentication is simple: one API key. No browser scraping, no refresh tokens, no Firebase.

### Step 1: Get your Morgen API key

1. Go to [platform.morgen.so/developers-api](https://platform.morgen.so/developers-api)
2. Sign in with your Morgen account
3. Generate an API key and copy it

### Step 2: Configure

You have two options:

**Option A -- Run the setup command:**

```bash
npx morgen-mcp setup
```

It will prompt you for your API key and timezone, then write a `.env` file for you.

**Option B -- Create `.env` manually:**

```bash
MORGEN_API_KEY=your_morgen_api_key_here
MORGEN_TIMEZONE=America/New_York
```

Or pass them as environment variables in your Claude MCP config:

```json
{
  "mcpServers": {
    "morgen": {
      "command": "npx",
      "args": ["-y", "morgen-mcp"],
      "env": {
        "MORGEN_API_KEY": "your_morgen_api_key_here",
        "MORGEN_TIMEZONE": "America/New_York"
      }
    }
  }
}
```

### Step 3: Restart Claude Code

That is the whole setup. No token refresh cycles, no IndexedDB spelunking.

## Configuration Reference

| Variable | Required | Description |
|---|---|---|
| `MORGEN_API_KEY` | Yes | Your Morgen API key from [platform.morgen.so/developers-api](https://platform.morgen.so/developers-api) |
| `MORGEN_TIMEZONE` | No | IANA timezone for calendar operations (default: `America/New_York`). Used for formatting event times and task due dates. |

## Usage Examples

Once installed and configured, just talk to Claude naturally:

**Check your schedule**
> "What's on my calendar this week?"

**List calendars**
> "Which Morgen calendars do I have connected?"

**Create events**
> "Create a meeting called 'Team Sync' tomorrow at 2pm for 30 minutes"
> "Schedule a call with drew@example.com at 5:30pm today"

**Modify events**
> "Move my 3pm to 4pm"
> "Change the Team Sync description to include the agenda link"

**Handle invitations**
> "Decline the 5pm meeting"
> "Tentatively accept the all-hands on Thursday"

**Delete events**
> "Cancel the standup on Friday"

**Manage tasks**
> "Add a task called 'Review contracts' due Friday, high priority"
> "What tasks do I have open?"
> "Mark the laundry task as done"
> "Reopen the invoice follow-up task"
> "Move the recording task to my Deep Work list"

## Rate Limits

Morgen uses a rolling point-based rate limit: **300 points per 15-minute window** per API key (raised from 100 on 2026-04-15).

- List endpoints (`list_events`, `list_tasks`, `list_calendars`) cost **10 points** per call
- Writes (create, update, delete, close, reopen, rsvp, move) cost **1 point** per call

In practice this is very generous for interactive use -- you can fire off hundreds of writes in a session without getting near the ceiling. Just avoid tight polling loops on the list endpoints.

Full details: [docs.morgen.so/rate-limits](https://docs.morgen.so/rate-limits)

## Security

Your Morgen API key grants full access to your Morgen account -- all calendars, all events, all tasks. Treat it like a password:

- Do not commit your `.env` file to version control. The included `.gitignore` excludes it, but verify.
- Do not paste your key into shared chats, issues, or screenshots.
- Rotate the key from the developer portal if you suspect it has leaked.

## Development

```bash
# Clone the repo
git clone https://github.com/lorecraft-io/morgen-mcp.git
cd morgen-mcp

# Install dependencies
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your API key

# Run directly
npm start
```

## Under the Hood

The server runs as a stdio-based MCP server using the official `@modelcontextprotocol/sdk`. All Morgen operations go through raw `fetch` calls against the public API at `https://api.morgen.so/v3`, authenticated with your API key via the `Authorization: ApiKey ...` header.

No SDK middleware, no token juggling, no refresh cycles. Just a thin, predictable wrapper around endpoints that Morgen already documents.

## License

MIT -- see [LICENSE](LICENSE) for details.

---

Built by [Nathan Davidovich / Lorecraft](https://github.com/lorecraft-io)
