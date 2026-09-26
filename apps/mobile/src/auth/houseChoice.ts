/**
 * What THIS PHONE remembers about the houses people used on it (ADR 0164, R3).
 *
 * The server decides which house a sign-in lands in: none for no membership,
 * that one for one, and for two or more the house this device used within the
 * last seven days, otherwise the person chooses. The phone's part is to
 * remember, per person, the last house it held a session for and when, and to
 * send that as a hint with every sign-in. The server checks it against the
 * person's memberships every time; it is never authority.
 *
 * Pure functions over the stored record, so they are tested without
 * SecureStore; `state/session.ts` reads and writes the record.
 */

/** The SecureStore key. Kept across sign-out on purpose: ids and times only. */
export const LAST_HOUSE_KEY = "mudavym.lastHouse.v1";

/** The SecureStore key for the email→userId index below. Same lifetime as
 * `LAST_HOUSE_KEY`: kept across sign-out, a hash of the email only. */
export const EMAIL_INDEX_KEY = "mudavym.lastHouse.emailIndex.v1";

export interface HouseUse {
  houseId: string;
  usedAt: number;
}

export type HouseMemory = Record<string, HouseUse>;

export interface HouseSummary {
  id: string;
  name: string;
  city: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEOPLE = 20;

/** The stored record, or {} for anything unreadable. */
export function parseMemory(raw: string | null | undefined): HouseMemory {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: HouseMemory = {};
    for (const [userId, v] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const e = v as Partial<HouseUse> | null;
      if (
        UUID.test(userId) &&
        e &&
        typeof e.houseId === "string" &&
        UUID.test(e.houseId) &&
        typeof e.usedAt === "number" &&
        Number.isFinite(e.usedAt)
      ) {
        out[userId] = { houseId: e.houseId, usedAt: e.usedAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function trim(mem: HouseMemory): HouseMemory {
  return Object.fromEntries(
    Object.entries(mem)
      .sort((a, b) => b[1].usedAt - a[1].usedAt)
      .slice(0, MAX_PEOPLE),
  );
}

/** `mem` with `userId`'s last house set to `houseId`, used at `at`. */
export function remember(
  mem: HouseMemory,
  userId: string,
  houseId: string,
  at: number,
): HouseMemory {
  if (!UUID.test(userId) || !UUID.test(houseId)) return mem;
  return trim({ ...mem, [userId]: { houseId, usedAt: at } });
}

/** `mem` without `houseId` for `userId`, when it is no longer theirs. */
export function forget(
  mem: HouseMemory,
  userId: string,
  houseId: string,
): HouseMemory {
  if (mem[userId]?.houseId !== houseId) return mem;
  const next = { ...mem };
  delete next[userId];
  return next;
}

// ── Email → userId index (parity fix, round 3, 2026-09-19) ─────────────
//
// A sign-in used to send `hints(mem)` — every person this phone remembers, up
// to 20 — because the phone did not learn WHICH of them was signing in until
// the server answered. That meant every other account that had ever used
// this phone (its user id, house id and last-use time) rode along in every
// sign-in body, on a device restaurants often share. The web fixed the same
// leak as item 8, 2026-09-19; this mirrors it for the phone.
//
// The one thing the phone DOES know before the server answers is the email
// being typed, so this index answers "which userId does this phone associate
// with this email" without storing (or sending) the address itself, and a
// sign-in can then ask for and send the ONE relevant entry.

export type EmailIndex = Record<string, string>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A short, one-way, non-cryptographic fingerprint of a normalised email —
 * not a security boundary, just an opaque local key so the index never has
 * to hold the address itself. Same FNV-1a shape as the web's `emailKey`
 * (item 8), kept as its own copy rather than shared: each platform's index
 * lives in its own storage and a key is never compared across devices.
 */
function emailKey(email: string): string {
  const normalized = normalizeEmail(email);
  let hash = 0x811c9dc5; // FNV-1a, 32-bit offset basis
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The stored email index, or {} for anything unreadable. */
export function parseEmailIndex(raw: string | null | undefined): EmailIndex {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: EmailIndex = {};
    for (const [key, userId] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof userId === "string" && UUID.test(userId)) out[key] = userId;
    }
    return out;
  } catch {
    return {};
  }
}

/** `index` with `email`'s key now pointing at `userId`. */
export function indexEmail(
  index: EmailIndex,
  email: string | null | undefined,
  userId: string,
): EmailIndex {
  if (!email || !UUID.test(userId)) return index;
  const capped = Object.entries({
    ...index,
    [emailKey(email)]: userId,
  }).slice(-MAX_PEOPLE);
  return Object.fromEntries(capped);
}

/**
 * What a sign-in sends: the ONE entry for the email being submitted, if this
 * phone has seen that email sign in before — never any other account it
 * remembers.
 */
export function hintFor(
  mem: HouseMemory,
  index: EmailIndex,
  email: string | null | undefined,
): { userId: string; houseId: string; usedAt: number } | null {
  if (!email) return null;
  const userId = index[emailKey(email)];
  if (!userId) return null;
  const use = mem[userId];
  return use ? { userId, ...use } : null;
}

/** The chooser's order: this phone's last house first, then by name. */
export function orderHouses(
  houses: HouseSummary[],
  mem: HouseMemory,
  userId: string | null | undefined,
): { houses: HouseSummary[]; lastOpenedId: string | null } {
  const byName = [...houses].sort((a, b) => a.name.localeCompare(b.name));
  const last = userId ? mem[userId]?.houseId : undefined;
  const lastOpenedId = last && byName.some((h) => h.id === last) ? last : null;
  if (!lastOpenedId) return { houses: byName, lastOpenedId: null };
  return {
    houses: [
      ...byName.filter((h) => h.id === lastOpenedId),
      ...byName.filter((h) => h.id !== lastOpenedId),
    ],
    lastOpenedId,
  };
}
