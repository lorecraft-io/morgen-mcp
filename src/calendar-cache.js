// Cached calendar directory. Every write endpoint in Morgen's API requires
// both `calendarId` AND `accountId`, so we need to look up the accountId for
// a given calendarId. Hitting /v3/calendars/list costs 10 rate points, so we
// cache the whole result for 10 minutes.
import { morgenFetch } from "./client.js";
import { unwrapCalendars } from "./events-shape.js";

const TTL_MS = 10 * 60 * 1000;

let cache = null;
let expiresAt = 0;
let loadingPromise = null;

async function loadCache() {
  const raw = await morgenFetch("/v3/calendars/list", { points: 10 });
  const list = unwrapCalendars(raw);
  const byId = new Map();
  const byAccount = new Map();
  for (const c of list) {
    if (!c || !c.id) continue;
    const rights = c.myRights || {};
    const readOnly =
      rights.mayWriteAll === false && rights.mayReadItems === true;
    const entry = {
      id: c.id,
      name: c.name,
      accountId: c.accountId,
      integrationId: c.integrationId,
      color: c.color,
      readOnly,
    };
    byId.set(c.id, entry);
    if (entry.accountId) {
      if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
      byAccount.get(entry.accountId).push(entry);
    }
  }
  // Default writable calendar = first non-read-only entry in docs order.
  const defaultEntry =
    list.find((c) => c?.id && !(c.myRights?.mayWriteAll === false)) || list[0];
  const defaultId = defaultEntry?.id || null;
  cache = { list, byId, byAccount, defaultId };
  expiresAt = Date.now() + TTL_MS;
  return cache;
}

export async function getCalendarCache() {
  if (cache && expiresAt > Date.now()) return cache;
  if (loadingPromise) return loadingPromise;
  loadingPromise = loadCache().finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
}

export async function resolveCalendarMeta(calendarId) {
  const c = await getCalendarCache();
  const entry = c.byId.get(calendarId);
  if (!entry) {
    throw new Error(
      `calendar_id is not a known calendar on this account — run list_calendars to discover valid IDs`
    );
  }
  return entry;
}

export async function resolveDefaultCalendarMeta() {
  const c = await getCalendarCache();
  if (!c.defaultId) {
    throw new Error(
      "No calendars available on this account. Connect a calendar in Morgen first."
    );
  }
  return c.byId.get(c.defaultId);
}

export async function groupCalendarIdsByAccount(calendarIds) {
  const c = await getCalendarCache();
  const byAccount = new Map();
  for (const id of calendarIds) {
    const entry = c.byId.get(id);
    if (!entry) {
      throw new Error(
        `calendar_id ${id} is not a known calendar — run list_calendars to discover valid IDs`
      );
    }
    if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
    byAccount.get(entry.accountId).push(id);
  }
  return byAccount;
}

export async function getAllAccountsWithCalendars() {
  const c = await getCalendarCache();
  return c.byAccount;
}

export function _resetCalendarCache() {
  cache = null;
  expiresAt = 0;
  loadingPromise = null;
}

// Test helper: preload the cache with fake entries so handlers can look up
// calendar metadata without hitting a real API. Entries should be
// { id, accountId, name?, readOnly?, integrationId?, color? } objects.
export function _seedCalendarCache(entries) {
  loadingPromise = null;
  const byId = new Map();
  const byAccount = new Map();
  for (const e of entries) {
    const entry = {
      id: e.id,
      name: e.name || e.id,
      accountId: e.accountId,
      integrationId: e.integrationId || "google",
      color: e.color || "#000000",
      readOnly: e.readOnly === true,
    };
    byId.set(entry.id, entry);
    if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
    byAccount.get(entry.accountId).push(entry);
  }
  const defaultEntry = entries.find((e) => !e.readOnly) || entries[0];
  cache = {
    list: entries,
    byId,
    byAccount,
    defaultId: defaultEntry ? defaultEntry.id : null,
  };
  expiresAt = Date.now() + 10 * 60 * 1000;
}
