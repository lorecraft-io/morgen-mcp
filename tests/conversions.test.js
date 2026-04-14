// v0.1.5 unit tests for event_to_task (tools-conversions.js).
// Uses vitest to mock the underlying task + event handlers so the tool
// is exercised in isolation without touching the network.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/tools-tasks.js", () => ({
  taskHandlers: {
    create_task: vi.fn(async (args) => ({
      id: "task-123",
      title: args.title,
      description: args.description ?? null,
      priority: args.priority ?? null,
      estimatedDuration: args.estimated_duration ?? null,
      synthesized: true,
      created: true,
    })),
  },
}));

vi.mock("../src/tools-events.js", () => ({
  eventHandlers: {
    delete_event: vi.fn(async ({ event_id, calendar_id }) => ({
      success: true,
      deletedId: event_id,
      calendarId: calendar_id,
    })),
  },
}));

import { handleEventToTask } from "../src/tools-conversions.js";
import { taskHandlers } from "../src/tools-tasks.js";
import { eventHandlers } from "../src/tools-events.js";

beforeEach(() => {
  taskHandlers.create_task.mockClear();
  eventHandlers.delete_event.mockClear();
});

describe("handleEventToTask — input validation", () => {
  it("rejects missing event_id", async () => {
    await expect(
      handleEventToTask({ calendar_id: "cal-1", title: "T" })
    ).rejects.toThrow();
  });
  it("rejects missing calendar_id", async () => {
    await expect(
      handleEventToTask({ event_id: "evt-1", title: "T" })
    ).rejects.toThrow();
  });
  it("rejects missing title", async () => {
    await expect(
      handleEventToTask({ event_id: "evt-1", calendar_id: "cal-1" })
    ).rejects.toThrow();
  });
  it("rejects empty title", async () => {
    await expect(
      handleEventToTask({ event_id: "evt-1", calendar_id: "cal-1", title: "" })
    ).rejects.toThrow();
    await expect(
      handleEventToTask({ event_id: "evt-1", calendar_id: "cal-1", title: "   " })
    ).rejects.toThrow();
  });
  it("rejects non-integer priority", async () => {
    await expect(
      handleEventToTask({
        event_id: "evt-1",
        calendar_id: "cal-1",
        title: "T",
        priority: 1.5,
      })
    ).rejects.toThrow();
  });
  it("rejects out-of-range priority", async () => {
    await expect(
      handleEventToTask({
        event_id: "evt-1",
        calendar_id: "cal-1",
        title: "T",
        priority: 10,
      })
    ).rejects.toThrow();
  });
});

describe("handleEventToTask — happy path", () => {
  it("creates a task then deletes the source event by default", async () => {
    const result = await handleEventToTask({
      event_id: "evt-1",
      calendar_id: "cal-1",
      title: "Mama HIPAA",
      description: "Call insurance.",
      estimated_duration: "PT30M",
      priority: 1,
    });

    expect(taskHandlers.create_task).toHaveBeenCalledTimes(1);
    expect(taskHandlers.create_task).toHaveBeenCalledWith({
      title: "Mama HIPAA",
      description: "Call insurance.",
      estimated_duration: "PT30M",
      priority: 1,
    });
    expect(eventHandlers.delete_event).toHaveBeenCalledTimes(1);
    expect(eventHandlers.delete_event).toHaveBeenCalledWith({
      event_id: "evt-1",
      calendar_id: "cal-1",
    });
    expect(result.success).toBe(true);
    expect(result.task.id).toBe("task-123");
    expect(result.deleted_event).toMatchObject({
      success: true,
      deletedId: "evt-1",
    });
    expect(result.source_event_id).toBe("evt-1");
  });

  it("keeps the source event when delete_original is false", async () => {
    const result = await handleEventToTask({
      event_id: "evt-2",
      calendar_id: "cal-1",
      title: "Soft convert",
      delete_original: false,
    });

    expect(taskHandlers.create_task).toHaveBeenCalledTimes(1);
    expect(eventHandlers.delete_event).not.toHaveBeenCalled();
    expect(result.deleted_event).toBeNull();
  });

  it("passes tags through to create_task as labels", async () => {
    await handleEventToTask({
      event_id: "evt-3",
      calendar_id: "cal-1",
      title: "Tagged",
      tags: ["urgent", "admin"],
    });
    expect(taskHandlers.create_task).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["urgent", "admin"] })
    );
  });

  it("omits tags from create_task args when an empty array is passed", async () => {
    await handleEventToTask({
      event_id: "evt-4",
      calendar_id: "cal-1",
      title: "No tags",
      tags: [],
    });
    const call = taskHandlers.create_task.mock.calls[0][0];
    expect(call.tags).toBeUndefined();
  });
});

describe("handleEventToTask — partial failure surfaces structured error", () => {
  it("throws with conversion metadata when delete_event fails", async () => {
    eventHandlers.delete_event.mockImplementationOnce(async () => {
      throw new Error("Morgen API error (HTTP 500)");
    });

    await expect(
      handleEventToTask({
        event_id: "evt-5",
        calendar_id: "cal-1",
        title: "Partial failure",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("task task-123 was created"),
      conversion: {
        task_id: "task-123",
        source_event_id: "evt-5",
        source_calendar_id: "cal-1",
        deleted: false,
        error: "Morgen API error (HTTP 500)",
      },
    });

    // Task WAS created even though the delete failed
    expect(taskHandlers.create_task).toHaveBeenCalledTimes(1);
  });

  it("throws without touching event delete if create_task returns no id", async () => {
    taskHandlers.create_task.mockImplementationOnce(async () => ({
      id: null,
    }));
    await expect(
      handleEventToTask({
        event_id: "evt-6",
        calendar_id: "cal-1",
        title: "Broken create",
      })
    ).rejects.toThrow(/did not return a task id/);
    expect(eventHandlers.delete_event).not.toHaveBeenCalled();
  });
});
