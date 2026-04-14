// Unit tests for synthesizeTaskFromBody (v0.1.4).
//
// Morgen's /v3/tasks/create and /v3/tasks/update endpoints only echo
// { data: { id } } — they do NOT return the full task object. We
// synthesize a task-shaped return value from the request body + server
// response so callers get something immediately usable without an
// extra list_tasks round-trip. These tests lock in that synthesis
// shape + id extraction fallbacks.
import { describe, it, expect } from "vitest";
import { synthesizeTaskFromBody } from "../src/tools-tasks.js";

describe("synthesizeTaskFromBody — create path", () => {
  it("echoes a full body + extracts id from { data: { id } }", () => {
    const body = {
      title: "Write launch post",
      description: "Draft for v0.1.4 announcement",
      due: "2026-04-20T17:00:00.000Z",
      priority: 1,
      taskListId: "list-abc",
      estimatedDuration: "PT45M",
      timeZone: "America/New_York",
      descriptionContentType: "text/plain",
    };
    const serverResponse = { data: { id: "task-xyz-123" } };
    const result = synthesizeTaskFromBody(body, serverResponse, { isCreate: true });

    expect(result).toEqual({
      id: "task-xyz-123",
      title: "Write launch post",
      description: "Draft for v0.1.4 announcement",
      due: "2026-04-20T17:00:00.000Z",
      priority: 1,
      taskListId: "list-abc",
      estimatedDuration: "PT45M",
      timeZone: "America/New_York",
      descriptionContentType: "text/plain",
      integrationId: "morgen",
      synthesized: true,
      created: true,
    });
  });

  it("leaves optional fields null when body has only a title", () => {
    const body = { title: "Quick todo" };
    const serverResponse = { data: { id: "task-minimal" } };
    const result = synthesizeTaskFromBody(body, serverResponse, { isCreate: true });

    expect(result.id).toBe("task-minimal");
    expect(result.title).toBe("Quick todo");
    expect(result.description).toBeNull();
    expect(result.due).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.taskListId).toBeNull();
    expect(result.estimatedDuration).toBeNull();
    expect(result.timeZone).toBeNull();
    expect(result.descriptionContentType).toBeNull();
    expect(result.integrationId).toBe("morgen");
    expect(result.synthesized).toBe(true);
    expect(result.created).toBe(true);
  });

  it("falls back to top-level { id } when server uses legacy shape", () => {
    const body = { title: "Legacy shape" };
    const serverResponse = { id: "task-legacy" };
    const result = synthesizeTaskFromBody(body, serverResponse, { isCreate: true });
    expect(result.id).toBe("task-legacy");
  });

  it("falls back to { data: { task: { id } } } nested shape", () => {
    const body = { title: "Nested shape" };
    const serverResponse = { data: { task: { id: "task-nested" } } };
    const result = synthesizeTaskFromBody(body, serverResponse, { isCreate: true });
    expect(result.id).toBe("task-nested");
  });

  it("returns id = null when server response is null and body has no id", () => {
    const body = { title: "Orphan" };
    const result = synthesizeTaskFromBody(body, null, { isCreate: true });
    expect(result.id).toBeNull();
    expect(result.synthesized).toBe(true);
    expect(result.created).toBe(true);
  });

  it("always stamps integrationId = 'morgen'", () => {
    const body = { title: "Morgen native" };
    const serverResponse = { data: { id: "task-1" } };
    const result = synthesizeTaskFromBody(body, serverResponse, { isCreate: true });
    expect(result.integrationId).toBe("morgen");
  });
});

describe("synthesizeTaskFromBody — update path", () => {
  it("echoes id from body when update response is empty", () => {
    const body = {
      id: "task-update-target",
      title: "Renamed task",
    };
    const serverResponse = {}; // update sometimes returns nothing
    const result = synthesizeTaskFromBody(body, serverResponse, { isCreate: false });

    expect(result.id).toBe("task-update-target");
    expect(result.title).toBe("Renamed task");
    expect(result.synthesized).toBe(true);
    expect(result.created).toBe(false);
  });

  it("preserves priority = 0 (not coerced to null)", () => {
    // priority 0 means "undefined" in Morgen but is still a valid
    // int the caller explicitly set, so the synthesized shape must
    // carry it through as 0 rather than dropping it to null.
    const body = { id: "task-p0", priority: 0 };
    const result = synthesizeTaskFromBody(body, {}, { isCreate: false });
    expect(result.priority).toBe(0);
  });

  it("leaves priority as null when unset", () => {
    const body = { id: "task-no-p" };
    const result = synthesizeTaskFromBody(body, {}, { isCreate: false });
    expect(result.priority).toBeNull();
  });

  it("maps estimatedDuration and timeZone independently", () => {
    const body = {
      id: "task-dur-only",
      estimatedDuration: "PT2H",
    };
    const result = synthesizeTaskFromBody(body, {}, { isCreate: false });
    expect(result.estimatedDuration).toBe("PT2H");
    expect(result.timeZone).toBeNull();

    const body2 = {
      id: "task-tz-only",
      timeZone: "Europe/Berlin",
    };
    const result2 = synthesizeTaskFromBody(body2, {}, { isCreate: false });
    expect(result2.estimatedDuration).toBeNull();
    expect(result2.timeZone).toBe("Europe/Berlin");
  });

  it("synthesized flag is always true, created flag mirrors isCreate", () => {
    const created = synthesizeTaskFromBody({ title: "c" }, { data: { id: "a" } }, { isCreate: true });
    const updated = synthesizeTaskFromBody({ id: "b", title: "u" }, {}, { isCreate: false });
    expect(created.synthesized).toBe(true);
    expect(created.created).toBe(true);
    expect(updated.synthesized).toBe(true);
    expect(updated.created).toBe(false);
  });

  it("defaults isCreate to false when options omitted entirely", () => {
    const body = { id: "task-default" };
    const result = synthesizeTaskFromBody(body, {});
    expect(result.created).toBe(false);
    expect(result.id).toBe("task-default");
  });
});
