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

// Smart account routing: infer which connected account a new event should
// live on based on title, description, and participant emails. Returns a
// logical account name like "lorecraft" / "parzvl" / "bloom"; callers then
// resolve that to an actual calendar via resolveCalendarByAccountName.
//
// Default is "lorecraft" unless an obvious PARZVL or BLOOM signal shows up.
// Precedence: participant emails first (most reliable), then free-text cues
// in title + description.
export function inferAccountFromContext({ title = "", description = "", participants = [] }) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  const emails = (participants || []).map((p) => String(p || "").toLowerCase());
  const hasEmail = (domain) => emails.some((e) => e.endsWith(domain));
  const matches = (re) => re.test(text);

  if (hasEmail("@parzvl.com") || matches(/\bparzvl\b/) || matches(/beard club/)) {
    return "parzvl";
  }
  if (hasEmail("@bloomit.ai") || matches(/\bbloom(it)?\b/)) {
    return "bloom";
  }
  return "lorecraft";
}

// Map a logical account name to the calendar metadata entry Morgen uses.
// Falls back to the cache's defaultId if the requested account can't be
// found (which shouldn't happen in Nate's setup but is safer than throwing).
const ACCOUNT_NAME_PATTERNS = {
  lorecraft: /(^|[^a-z0-9])(nate@lorecraft\.io|lorecraft)($|[^a-z0-9])/i,
  parzvl: /(^|[^a-z0-9])(nate@parzvl\.com|parzvl)($|[^a-z0-9])/i,
  bloom: /(^|[^a-z0-9])(nate@bloomit\.ai|bloom(?:it)?)($|[^a-z0-9])/i,
};

export async function resolveCalendarByAccountName(name) {
  const c = await getCalendarCache();
  const pattern = ACCOUNT_NAME_PATTERNS[name];
  if (pattern) {
    for (const entry of c.list) {
      const calName = entry?.name || "";
      if (pattern.test(calName) && entry?.myRights?.mayWriteAll !== false) {
        return c.byId.get(entry.id);
      }
    }
  }
  // Fall back to the default writable calendar
  if (c.defaultId) return c.byId.get(c.defaultId);
  throw new Error(
    `No calendar found for account name "${name}" and no default calendar is available`
  );
}

// Resolve the caller's own email address, used when keying RSVP patches into
// the Morgen participants map. Order of resolution:
//   1. MORGEN_SELF_EMAIL env var (explicit override, always wins)
//   2. The calendar meta's name if it looks like an email (most of Nate's
//      Google calendars are named after the account email)
//   3. Throw with a clear hint to set the env var
export function resolveSelfEmail(calendarMeta) {
  const envEmail = process.env.MORGEN_SELF_EMAIL;
  if (envEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(envEmail)) {
    return envEmail;
  }
  const name = calendarMeta?.name || "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
    return name;
  }
  throw new Error(
    `Could not determine your own email address for RSVP patching. Set the MORGEN_SELF_EMAIL environment variable (e.g. nate@lorecraft.io) in your MCP config.`
  );
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
