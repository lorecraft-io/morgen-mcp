// Morgen task tools — native Morgen tasks only (integrationId: "morgen").
// Tasks synced from external providers (Todoist, etc.) are NOT writable via /v3/tasks endpoints.
import { morgenFetch } from "./client.js";
import { validateId, validateISODate, validateIntegerRange } from "./validation.js";

// Priority is an integer 0-9 per https://docs.morgen.so/tasks
// 0 = undefined, 1 = highest, 9 = lowest
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 9;

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;

const DESCRIPTION_CONTENT_TYPES = ["text/plain", "text/html"];

const ISO_DURATION_RE = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

function validateIsoDuration(value, field = "estimated_duration") {
  if (typeof value !== "string" || !ISO_DURATION_RE.test(value)) {
    throw new Error(
      `${field} must be an ISO 8601 duration string (e.g. 'PT30M', 'PT1H', 'PT2H30M')`
    );
  }
  return value;
}

function validateTaskTags(value, field = "tags") {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  if (value.length > MAX_TAGS) {
    throw new Error(`${field} exceeds maximum of ${MAX_TAGS} tags`);
  }
  for (const tag of value) {
    if (typeof tag !== "string" || tag.length === 0 || tag.length > MAX_TAG_LENGTH) {
      throw new Error(`${field} entries must be non-empty strings under ${MAX_TAG_LENGTH} chars`);
    }
  }
  return value;
}

function validateTitle(value) {
  if (!value || typeof value !== "string") {
    throw new Error("title is required and must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error("title cannot be empty");
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Error(`title exceeds maximum length of ${MAX_TITLE_LENGTH} characters`);
  }
  return trimmed;
}

function validateDescription(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("description must be a string");
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return value;
}

function unwrapTask(raw) {
  return raw?.data?.task ?? raw?.task ?? raw?.data ?? raw;
}

function unwrapTaskList(raw) {
  if (Array.isArray(raw)) return raw;
  return (
    raw?.data?.tasks ??
    raw?.tasks ??
    (Array.isArray(raw?.data) ? raw.data : []) ??
    []
  );
}

function shapeTask(raw) {
  const task = unwrapTask(raw);
  if (!task || typeof task !== "object") return null;
  return {
    id: task.id ?? null,
    title: task.title ?? null,
    description: task.description ?? null,
    due: task.due ?? null,
    priority: typeof task.priority === "number" ? task.priority : null,
    taskListId: task.taskListId ?? null,
    accountId: task.accountId ?? null,
    integrationId: task.integrationId ?? "morgen",
    progress: task.progress ?? null,
    position: typeof task.position === "number" ? task.position : null,
    estimatedDuration: task.estimatedDuration ?? null,
    timeZone: task.timeZone ?? null,
    tags: Array.isArray(task.tags) ? task.tags : undefined,
    created: task.created ?? null,
    updated: task.updated ?? null,
  };
}

function shapeTaskList(raw) {
  const list = unwrapTaskList(raw);
  const tasks = list.map(shapeTask).filter(Boolean);
  return { count: tasks.length, tasks };
}

export const TASK_TOOLS = [
  {
    name: "list_tasks",
    description:
      "List native Morgen tasks. Does not include tasks synced from external providers (Todoist, Google Tasks, etc.).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description:
      "Create a new native Morgen task. Only creates first-party Morgen tasks; external-provider tasks are not supported.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Task title (required, max 500 chars).",
        },
        description: {
          type: "string",
          description: "Optional task description / notes (max 5000 chars).",
        },
        due: {
          type: "string",
          description: "Optional ISO 8601 due date-time (e.g. 2026-04-20T17:00:00.000Z).",
        },
        priority: {
          type: "integer",
          minimum: PRIORITY_MIN,
          maximum: PRIORITY_MAX,
          description:
            "Optional priority. Integer 0-9 where 0 = undefined, 1 = highest, 9 = lowest.",
        },
        task_list_id: {
          type: "string",
          description:
            "Optional Morgen task list ID. Defaults to the account's default list if omitted.",
        },
        estimated_duration: {
          type: "string",
          description: "Optional ISO 8601 duration string (e.g. 'PT30M', 'PT1H', 'PT2H30M') — how long the task is expected to take. Used by Morgen's auto-scheduler.",
        },
        timezone: {
          type: "string",
          description: "Optional IANA timezone (e.g. 'America/New_York') that applies to the task's due time.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional array of tag strings. Max 50 tags, 100 chars each.",
        },
        description_content_type: {
          type: "string",
          enum: DESCRIPTION_CONTENT_TYPES,
          description: "Optional content type for the description field: 'text/plain' (default) or 'text/html'.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "Update an existing native Morgen task's fields.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Morgen task ID.",
        },
        title: {
          type: "string",
          description: "New title (max 500 chars).",
        },
        description: {
          type: "string",
          description: "New description (max 5000 chars).",
        },
        due: {
          type: "string",
          description: "New ISO 8601 due date-time.",
        },
        priority: {
          type: "integer",
          minimum: PRIORITY_MIN,
          maximum: PRIORITY_MAX,
          description: "Integer 0-9 (1 = highest, 9 = lowest, 0 = undefined).",
        },
        estimated_duration: {
          type: "string",
          description: "ISO 8601 duration (e.g. 'PT30M').",
        },
        timezone: {
          type: "string",
          description: "IANA timezone for the due date.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Replacement tag array.",
        },
        description_content_type: {
          type: "string",
          enum: DESCRIPTION_CONTENT_TYPES,
          description: "'text/plain' or 'text/html'.",
        },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "move_task",
    description: "Move a task to a different Morgen task list.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Morgen task ID.",
        },
        task_list_id: {
          type: "string",
          description: "Destination Morgen task list ID.",
        },
      },
      required: ["task_id", "task_list_id"],
      additionalProperties: false,
    },
  },
  {
    name: "close_task",
    description:
      "Mark a native Morgen task as completed. Morgen represents completion via the task's progress field.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Morgen task ID.",
        },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "reopen_task",
    description: "Reopen a previously completed native Morgen task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Morgen task ID.",
        },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_task",
    description: "Delete a native Morgen task permanently.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Morgen task ID.",
        },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
];

export const taskHandlers = {
  list_tasks: async () => {
    const response = await morgenFetch("/v3/tasks/list", { points: 10 });
    return shapeTaskList(response);
  },

  create_task: async (args = {}) => {
    const title = validateTitle(args.title);
    const description = validateDescription(args.description);
    if (args.due !== undefined && args.due !== null) {
      validateISODate(args.due, "due");
    }
    if (args.priority !== undefined && args.priority !== null) {
      validateIntegerRange(args.priority, "priority", PRIORITY_MIN, PRIORITY_MAX);
    }
    let taskListId;
    if (args.task_list_id !== undefined && args.task_list_id !== null) {
      taskListId = validateId(args.task_list_id, "task_list_id");
    }
    if (args.estimated_duration !== undefined && args.estimated_duration !== null) {
      validateIsoDuration(args.estimated_duration, "estimated_duration");
    }
    if (args.tags !== undefined && args.tags !== null) {
      validateTaskTags(args.tags);
    }
    if (args.description_content_type !== undefined && args.description_content_type !== null) {
      if (!DESCRIPTION_CONTENT_TYPES.includes(args.description_content_type)) {
        throw new Error(`description_content_type must be one of: ${DESCRIPTION_CONTENT_TYPES.join(", ")}`);
      }
    }

    const body = { title };
    if (description !== undefined) body.description = description;
    if (args.due) body.due = args.due;
    if (args.priority !== undefined && args.priority !== null) body.priority = args.priority;
    if (taskListId) body.taskListId = taskListId;
    if (args.estimated_duration) body.estimatedDuration = args.estimated_duration;
    if (args.timezone) body.timeZone = args.timezone;
    if (args.tags) body.tags = args.tags;
    if (args.description_content_type) body.descriptionContentType = args.description_content_type;

    const response = await morgenFetch("/v3/tasks/create", {
      method: "POST",
      body,
      points: 1,
    });
    return shapeTask(response);
  },

  update_task: async (args = {}) => {
    const id = validateId(args.task_id, "task_id");
    if (args.due !== undefined && args.due !== null) {
      validateISODate(args.due, "due");
    }
    if (args.priority !== undefined && args.priority !== null) {
      validateIntegerRange(args.priority, "priority", PRIORITY_MIN, PRIORITY_MAX);
    }
    let description;
    if (args.description !== undefined) {
      description = validateDescription(args.description);
    }
    let title;
    if (args.title !== undefined) {
      title = validateTitle(args.title);
    }
    if (args.estimated_duration !== undefined && args.estimated_duration !== null) {
      validateIsoDuration(args.estimated_duration, "estimated_duration");
    }
    if (args.tags !== undefined && args.tags !== null) {
      validateTaskTags(args.tags);
    }
    if (args.description_content_type !== undefined && args.description_content_type !== null) {
      if (!DESCRIPTION_CONTENT_TYPES.includes(args.description_content_type)) {
        throw new Error(`description_content_type must be one of: ${DESCRIPTION_CONTENT_TYPES.join(", ")}`);
      }
    }

    const body = { id };
    if (title !== undefined) body.title = title;
    if (description !== undefined) body.description = description;
    if (args.due !== undefined && args.due !== null) body.due = args.due;
    if (args.priority !== undefined && args.priority !== null) body.priority = args.priority;
    if (args.estimated_duration) body.estimatedDuration = args.estimated_duration;
    if (args.timezone) body.timeZone = args.timezone;
    if (args.tags) body.tags = args.tags;
    if (args.description_content_type) body.descriptionContentType = args.description_content_type;

    if (Object.keys(body).length === 1) {
      throw new Error("update_task requires at least one field to update besides task_id");
    }

    const response = await morgenFetch("/v3/tasks/update", {
      method: "POST",
      body,
      points: 1,
    });
    return shapeTask(response);
  },

  move_task: async (args = {}) => {
    const id = validateId(args.task_id, "task_id");
    const taskListId = validateId(args.task_list_id, "task_list_id");
    const response = await morgenFetch("/v3/tasks/update", {
      method: "POST",
      body: { id, taskListId },
      points: 1,
    });
    return shapeTask(response);
  },

  close_task: async (args = {}) => {
    const id = validateId(args.task_id, "task_id");
    const response = await morgenFetch("/v3/tasks/close", {
      method: "POST",
      body: { id },
      points: 1,
    });
    return shapeTask(response) ?? { id };
  },

  reopen_task: async (args = {}) => {
    const id = validateId(args.task_id, "task_id");
    const response = await morgenFetch("/v3/tasks/reopen", {
      method: "POST",
      body: { id },
      points: 1,
    });
    return shapeTask(response) ?? { id };
  },

  delete_task: async (args = {}) => {
    const id = validateId(args.task_id, "task_id");
    await morgenFetch("/v3/tasks/delete", {
      method: "POST",
      body: { id },
      points: 1,
    });
    return { id, deleted: true };
  },
};
