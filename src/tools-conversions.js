// Event ↔ Task conversion tools — v0.1.5
//
// Morgen's public API does NOT expose the task-to-calendar scheduling
// linkage (the `morgen.so:metadata.taskId` field is read-only on events,
// and there is no /v3/tasks/schedule endpoint). This means an MCP-created
// task lands in the user's inbox task list WITHOUT a calendar slot.
//
// `event_to_task` performs a "soft conversion": it creates a Morgen task
// from the caller's event metadata, then (optionally) deletes the source
// event. The resulting task sits in the inbox task list. To get the
// checkbox-on-calendar render like Morgen's web app produces, the user
// has to drag the task to a time slot manually — that triggers Morgen's
// private linking endpoint which is not exposed to the public API.
//
// This tool is still useful as a single natural-language trigger for
// "convert this calendar block into a todo" — it bundles create_task +
// delete_event into one call and preserves the event's metadata.

import { taskHandlers } from "./tools-tasks.js";
import { eventHandlers } from "./tools-events.js";
import { validateId } from "./validation.js";

const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 5000;
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 9;

function validateTitle(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("title is required and must be a non-empty string");
  }
  if (value.length > MAX_TITLE_LEN) {
    throw new Error(`title must be ≤ ${MAX_TITLE_LEN} chars`);
  }
  return value.trim();
}

export async function handleEventToTask(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  const calendarId = validateId(args.calendar_id, "calendar_id");
  const title = validateTitle(args.title);

  if (args.description !== undefined && typeof args.description !== "string") {
    throw new Error("description must be a string when provided");
  }
  if (args.description && args.description.length > MAX_DESCRIPTION_LEN) {
    throw new Error(`description must be ≤ ${MAX_DESCRIPTION_LEN} chars`);
  }

  if (args.priority !== undefined && args.priority !== null) {
    if (
      typeof args.priority !== "number" ||
      args.priority < PRIORITY_MIN ||
      args.priority > PRIORITY_MAX ||
      !Number.isInteger(args.priority)
    ) {
      throw new Error(
        `priority must be an integer between ${PRIORITY_MIN} and ${PRIORITY_MAX}`
      );
    }
  }

  const deleteOriginal = args.delete_original === false ? false : true;

  const taskArgs = { title };
  if (args.description !== undefined) taskArgs.description = args.description;
  if (args.priority !== undefined && args.priority !== null) {
    taskArgs.priority = args.priority;
  }
  if (args.estimated_duration) {
    taskArgs.estimated_duration = args.estimated_duration;
  }
  if (args.due) taskArgs.due = args.due;
  if (Array.isArray(args.tags) && args.tags.length > 0) {
    taskArgs.tags = args.tags;
  }
  if (args.task_list_id) taskArgs.task_list_id = args.task_list_id;

  // Create the task first. If this fails, we haven't touched the event yet.
  const task = await taskHandlers.create_task(taskArgs);

  if (!task || !task.id) {
    throw new Error(
      "event_to_task: create_task did not return a task id — aborting before touching the source event"
    );
  }

  let deletedEvent = null;
  if (deleteOriginal) {
    try {
      deletedEvent = await eventHandlers.delete_event({
        event_id: eventId,
        calendar_id: calendarId,
      });
    } catch (err) {
      // Task was created but event delete failed. Surface the partial state
      // so the caller can either retry the delete or manually clean up.
      const safeMessage =
        err instanceof Error ? err.message : "unknown delete error";
      const partialErr = new Error(
        `event_to_task: task ${task.id} was created but the source event could not be deleted: ${safeMessage}. ` +
        `Retry delete manually or pass delete_original: false next time.`
      );
      partialErr.conversion = {
        task_id: task.id,
        source_event_id: eventId,
        source_calendar_id: calendarId,
        deleted: false,
        error: safeMessage,
      };
      throw partialErr;
    }
  }

  return {
    success: true,
    task,
    source_event_id: eventId,
    source_calendar_id: calendarId,
    deleted_event: deletedEvent,
    note:
      "Task is in the Morgen inbox. To render it on the calendar with a checkbox like Morgen's web app does, drag it to a time slot in the Morgen UI — the public API does not expose the task-to-calendar linking endpoint.",
  };
}

export const CONVERSION_TOOLS = [
  {
    name: "event_to_task",
    description:
      "Convert a calendar event into a Morgen task. Bundles create_task + delete_event. Useful for 'turn this block into a todo' flows. NOTE: the resulting task lands in the Morgen inbox WITHOUT a calendar slot — Morgen's public API does not expose the task-to-calendar scheduling endpoint. Drag the task onto a calendar slot manually in the Morgen web app to get the checkbox render.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The ID of the source event (from list_events).",
        },
        calendar_id: {
          type: "string",
          description: "The calendar the event belongs to (from list_events).",
        },
        title: {
          type: "string",
          description: "Task title. Usually the event's title.",
        },
        description: {
          type: "string",
          description: "Optional task description. Usually the event's description.",
        },
        estimated_duration: {
          type: "string",
          description:
            "Optional ISO 8601 duration (e.g. 'PT30M') — usually derived from the event's duration.",
        },
        priority: {
          type: "integer",
          minimum: PRIORITY_MIN,
          maximum: PRIORITY_MAX,
          description: "Optional priority 0-9 (1 = highest, 9 = lowest).",
        },
        due: {
          type: "string",
          description: "Optional ISO 8601 due date-time.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          maxItems: 50,
          description:
            "Optional tag labels. Resolved to Morgen tag UUIDs by create_task.",
        },
        task_list_id: {
          type: "string",
          description: "Optional Morgen task list ID. Defaults to the account's default list.",
        },
        delete_original: {
          type: "boolean",
          description:
            "When true (default), deletes the source event after the task is created. Pass false to keep the event and only add a task.",
        },
      },
      required: ["event_id", "calendar_id", "title"],
      additionalProperties: false,
    },
  },
];

export const conversionHandlers = {
  event_to_task: handleEventToTask,
};
