# Morgen API Feature Request — 2026-04-15

**Context:** Follow-up to John Mavrick's 2026-04-15 reply. Post this on Morgen's public feature-request channel (Canny / Discord / forum — wherever they track user requests) so other users can upvote ahead of the early-May hackathon. John explicitly asked for this.

---

## Title

Expose task auto-scheduling, task-to-calendar linking, and multi-calendar reflow in the public v3 API

## Background

I'm building a community MCP server + n8n 3-way sync (Obsidian ↔ Notion ↔ Morgen) on top of the v3 API. Morgen is the only tool I've found that unifies calendar and tasks the way my workflow needs, and the API has gotten me 95% of the way there. John confirmed via email on 2026-04-15 that three specific gaps are real and deferred — I'm filing this so other API users can share context and upvote.

I'm also aware that task lists are being deprecated in favor of tags in the upcoming app release, and I fully support that direction. **I'm migrating my sync pipeline to tags as the primary organization mechanism right now** — this request is specifically about the three areas where the v3 API has no equivalent I can reach from outside Morgen, regardless of whether the org unit is a list or a tag.

## Three asks, in priority order

### 1. Task → calendar slot (the "drag from sidebar" action, exposed as an API call)

**Current state:** Morgen's web app lets you drag a task from the sidebar onto a time slot, which creates a calendar event with `morgen.so:metadata.taskId` set and renders the checkbox-in-calendar UI. This is the single most powerful Morgen-exclusive UX — it's why I keep coming back to Morgen instead of calendar-only or task-only tools.

**What's blocked:** the API rejects every way I've found to reproduce this:

- `/v3/tasks/update` whitelist-rejects `start`, `scheduledStart`, `calendarId`, `accountId` (`property <field> should not exist`)
- `/v3/events/create` with `morgen.so:metadata.taskId` in the body rejects with `"An event with canBeCompleted cannot have a taskId"` or `"Invalid event id"`
- `/v3/events/update` with top-level `taskId` rejects: `"property taskId should not exist"`
- No endpoint exists at `/v3/tasks/schedule`, `/v3/tasks/plan`, `/v3/tasks/block`, `/v3/tasks/timeblock`, `/v3/events/fromTask`, `/v3/events/createFromTask`, `/v3/events/linkTask`, `/v3/tasks/scheduleOn`, `/v3/tasks/planAt`, `/v3/calendars/block-task`, or `/v3/tasks/scheduleInCalendar` (all return 404)
- `morgen.so:metadata` on an event is documented as read-only

**What would unblock me:** a single endpoint — something like `POST /v3/tasks/:id/schedule` with `{ calendarId, accountId, start }` that creates the linked event the same way the drag UX does. Even without auto-placement logic, the ability to script "put this task on this slot at this time" removes the last piece of manual tending in my sync workflow.

**Why this is the biggest one:** today my pipeline pushes tasks into Morgen correctly, but I have to open the app and drag them onto time slots by hand to get them rendered on the calendar grid. Everything else in the sync (create, update, complete, delete, tag) is automated.

### 2. Auto-flow / reflow across the day

**Current state:** my v0.1.4 MCP ships a client-side `reflow_day` that fetches events once (`list_events`, 10 pts), then issues one `POST /v3/events/update` per reflowable step to compress them back-to-back from an anchor time. It works for the common case (4-5 focus blocks on one calendar) but is partial-failure-prone and capped at 50 event moves per call to stay under the budget.

**What John flagged in the email as design work Morgen would need to do:**

- Non-movable meetings — should the reflow split time before and after, or skip the block entirely?
- Preserving existing breaks/gaps — don't compress through a lunch window
- Multi-calendar awareness — most users (me included) have personal + work + ops calendars that need to reflow together, not one at a time

**What would unblock me:** a server-side `POST /v3/calendars/reflow` (or `/v3/tasks/autoflow`) that takes: an anchor window, a list of calendars to include, a list of event IDs to treat as fixed (non-movable), optional gap rules, and returns the computed event updates atomically. Even a dry-run mode would be valuable — let the caller preview the moves, then commit.

**Why this matters even if #1 ships first:** once tasks are on the calendar grid (via #1), I need to be able to reshuffle them around a late-afternoon meeting that landed on my calendar after the initial plan. Today I do this by hand.

### 3. Multi-calendar task scheduling (follows from #1 and #2)

**Current state:** I run 4 Morgen-connected accounts (personal, two work, ops). The MCP's `create_event` smart-account router figures out which calendar to write to based on context, but since #1 is blocked there's no way to express "schedule this task on the correct calendar automatically."

**What would unblock me:** tie this into #1's endpoint. `POST /v3/tasks/:id/schedule` should accept either an explicit `calendarId` + `accountId` pair, OR a `strategy: "auto"` that uses the same multi-calendar logic the web app uses when dragging a task without pre-selecting a target slot.

---

## What I've migrated to in the meantime

- **Tags over task lists:** I'm switching my n8n Obsidian ↔ Morgen sync pipeline to use `/v3/tags` as the organization primitive instead of `taskListId`. "Inbox" becomes a tag. "Lorecraft", "Parzvl", "Lava", etc. become Area tags. URGENT becomes a flag tag that can coexist with an Area tag — something task lists couldn't express. The label → UUID resolver in my MCP already handles create-if-missing, so the migration is mostly in the sync workflow, not the MCP itself.
- **Rate limit headroom:** thanks for the 100 → 300 bump. My n8n polling workflow (W2) now has ~14× headroom at the current cadence, which means I can safely drop polling from 15 min to 5 min if I need faster Morgen → Obsidian propagation.

## What the community MCP can cover vs. what needs first-party support

I'd love for the hackathon team to know that **the community morgen-mcp project is not trying to compete with a first-party MCP — it's a community reference that can absorb whatever shape Morgen chooses.** The MCP layer itself (natural-language date parsing, smart-account routing, local rate-limit ledger, tag label resolver) is mostly glue that makes the existing API ergonomic for LLM callers. The three gaps above are the ones I can't paper over in client code.

Happy to review any preview/beta endpoints, answer questions about real-world sync patterns, and contribute test cases if that's useful.

Thanks for building Morgen — it's the best unified calendar+tasks tool I've found, and it's become load-bearing in my daily workflow.

— Nathan
nate@lorecraft.io
github.com/lorecraft-io/morgen-mcp
