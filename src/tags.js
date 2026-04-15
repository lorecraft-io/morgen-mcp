// Morgen tag helpers — shared by tools-tasks.js (and any future tag-aware
// tool). Lives in its own file to keep tools-tasks.js under the 500-line
// project cap.
//
// Morgen stores tags as a first-class resource keyed by UUID. The Task.tags
// field is an array of tag UUIDs, NOT an array of label strings. We expose
// a user-friendly "pass labels" surface at the MCP boundary and do the
// label → UUID resolution here, auto-creating unknown tags on first use.
//
// Source of truth: https://docs.morgen.so/tasks and https://docs.morgen.so/tags
// (verified 2026-04-14).
import { morgenFetch } from "./client.js";

export const MAX_TAGS = 50;
export const MAX_TAG_LABEL_LENGTH = 100;

export function validateTagLabels(value, field = "tags") {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of label strings`);
  }
  if (value.length > MAX_TAGS) {
    throw new Error(`${field} may not exceed ${MAX_TAGS} entries`);
  }
  for (const label of value) {
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error(`${field} entries must be non-empty strings`);
    }
    if (label.length > MAX_TAG_LABEL_LENGTH) {
      throw new Error(
        `${field} entries must be ≤ ${MAX_TAG_LABEL_LENGTH} chars each`
      );
    }
  }
  return value;
}

// Resolve an array of human-readable tag labels → array of Morgen tag UUIDs.
// Case-insensitive match against existing tags; unknown labels auto-create
// new Tag resources via /v3/tags/create. Duplicates (case-insensitive) are
// collapsed before any network call.
//
// Rate-limit cost: 10 points (tags/list) + 1 point per newly-created tag.
export async function resolveTagLabelsToIds(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return [];

  const listResponse = await morgenFetch("/v3/tags/list", { points: 10 });
  // Morgen's /v3/tags/list returns a BARE ARRAY at the top level
  // (confirmed live 2026-04-15 — see docs/MORGEN-API-NOTES.md). Earlier
  // versions of this resolver assumed `{ data: { tags: [...] } }`, which
  // always fell through to the `[]` fallback, silently breaking every
  // tagged create/update. All observed shapes are handled below.
  const existingTags = Array.isArray(listResponse)
    ? listResponse
    : (listResponse?.data?.tags ??
       listResponse?.tags ??
       (Array.isArray(listResponse?.data) ? listResponse.data : []) ??
       []);
  const byLabel = new Map();
  for (const tag of existingTags) {
    if (tag && typeof tag.name === "string" && typeof tag.id === "string") {
      byLabel.set(tag.name.toLowerCase(), tag.id);
    }
  }

  const ids = [];
  const seen = new Set();
  for (const rawLabel of labels) {
    const label = String(rawLabel).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (byLabel.has(key)) {
      ids.push(byLabel.get(key));
      continue;
    }

    const createResponse = await morgenFetch("/v3/tags/create", {
      method: "POST",
      body: { name: label },
      points: 1,
    });
    const newId =
      createResponse?.data?.id ??
      createResponse?.data?.tag?.id ??
      createResponse?.id ??
      null;
    if (newId) {
      byLabel.set(key, newId);
      ids.push(newId);
    }
  }
  return ids;
}
