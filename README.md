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
| `create_task` | Create a new task with title, description, due date, and priority (integer 0-9; 1 = highest, 9 = lowest) |
| `update_task` | Update an existing task -- change title, description, due date, or priority |
| `move_task` | Move a task to a different list |
| `close_task` | Mark a task as completed |
| `reopen_task` | Reopen a completed task |
| `delete_task` | Delete a task permanently |

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

Morgen uses a rolling point-based rate limit: **100 points per 15-minute window** per API key.

- List endpoints (`list_events`, `list_tasks`, `list_calendars`) cost **10 points** per call
- Writes (create, update, delete, close, reopen, rsvp, move) cost **1 point** per call

In practice this is generous for interactive use -- you can fire off dozens of writes in a session without getting near the ceiling. Just avoid tight polling loops on the list endpoints.

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
