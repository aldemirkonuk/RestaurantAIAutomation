/**
 * What THIS DEVICE remembers about the houses people used on it (ADR 0164, R3).
 *
 * The server decides which house a sign-in lands in: none for no membership,
 * that one for one, and for two or more the house this device used last if it
 * did so within seven days, otherwise the person chooses. The device's part is
 * only to remember, per person, which house it last held a session for and
 * when, and to send that as a hint with every sign-in. The server checks the
 * hint against the person's memberships every time; it is never authority.
 *
 * Why the device and not the account: a PC or tablet usually belongs to one
 * house (the Kadıköy office PC should not open Moda because the owner used Moda
 * on their phone this morning), and it needs no database write at sign-in.
 *
 * Signing out does NOT clear it: it holds only ids and times, nothing that
 * grants access, and keeping it is what lets someone who signed out last night
 * go straight back in this morning. An entry is dropped when the server says
 * that house is no longer the person's. Every read and write is guarded: in a
 * private window or with storage blocked this simply remembers nothing, and the
 * person chooses.
 */

export const LAST_HOUSE_KEY = "mudavym.lastHouse.v1";
/** Set when a refresh says the session's house ended; read once by the chooser. */
export const HOUSE_ENDED_KEY = "mudavym.houseEnded";
/** Where a session with no house is sent. */
export const CHOOSER_PATH = "/choose-house";

/** At most this many people are remembered on one device, newest first. */
const MAX_PEOPLE = 20;

export interface HouseUse {
  houseId: string;
  usedAt: number;
}

export interface HouseHint extends HouseUse {
  userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readAll(): Record<string, HouseUse> {
  try {
    const raw = window.localStorage.getItem(LAST_HOUSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, HouseUse> = {};
    for (const [userId, v] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const entry = v as Partial<HouseUse> | null;
      if (
        UUID.test(userId) &&
        entry &&
        typeof entry.houseId === "string" &&
        UUID.test(entry.houseId) &&
        typeof entry.usedAt === "number" &&
        Number.isFinite(entry.usedAt)
      ) {
        out[userId] = { houseId: entry.houseId, usedAt: entry.usedAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, HouseUse>): void {
  try {
    const kept = Object.entries(all)
      .sort((a, b) => b[1].usedAt - a[1].usedAt)
      .slice(0, MAX_PEOPLE);
    window.localStorage.setItem(
      LAST_HOUSE_KEY,
      JSON.stringify(Object.fromEntries(kept)),
    );
  } catch {
    /* storage blocked: remember nothing */
  }
}

/** Record that `userId` holds a session for `houseId` on this device, now. */
export function rememberHouse(
  userId: string,
  houseId: string,
  at: number = Date.now(),
): void {
  if (!UUID.test(userId) || !UUID.test(houseId)) return;
  const all = readAll();
  all[userId] = { houseId, usedAt: at };
  writeAll(all);
}

/** Forget `houseId` for `userId`, when the server says it is no longer theirs. */
export function forgetHouse(userId: string, houseId: string): void {
  const all = readAll();
  if (all[userId]?.houseId !== houseId) return;
  delete all[userId];
  writeAll(all);
}

/** The house this device last used for `userId`, or null. */
export function lastHouseFor(
  userId: string | null | undefined,
): HouseUse | null {
  if (!userId) return null;
  return readAll()[userId] ?? null;
}

// ── Email → userId index (item 8, 2026-09-19) ───────────────────────
//
// A sign-in used to send `lastHouses: lastHouseHints()` — every person this
// device remembers, up to 20 — because the device does not learn WHICH of
// them is signing in until the server answers. That meant every other
// account that had ever used this device (its user id, house id and last-use
// time) rode along in each sign-in body of everyone else's.
//
// The one thing the device DOES know before the server answers is the email
// being typed (or, for an OAuth sign-in, the email inside the provider's own
// ID token, decodable the same way). This index lets that be enough: keyed
// by a hash of the normalised email, not the address itself, so a lookup
// answers "which userId does the device associate with this email" without
// storing (or needing to send) the address in the clear, and a sign-in can
// then ask for and send the ONE relevant entry.

const EMAIL_INDEX_KEY = "mudavym.lastHouse.emailIndex.v1";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A short, one-way, non-cryptographic fingerprint of a normalised email.
 * Not a security boundary — nothing is authorized by it, the server still
 * checks every hint against real membership — just an opaque local key so
 * this device's own memory, and what it sends, never has to hold the
 * address itself.
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

function readEmailIndex(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(EMAIL_INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, string> = {};
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

function writeEmailIndex(index: Record<string, string>): void {
  try {
    // One entry per email this device has ever signed in as, so this needs
    // no eviction beyond the same MAX_PEOPLE ceiling the memory itself uses
    // (each write here is paired with a `rememberHouse` write there).
    const capped = Object.entries(index).slice(-MAX_PEOPLE);
    window.localStorage.setItem(
      EMAIL_INDEX_KEY,
      JSON.stringify(Object.fromEntries(capped)),
    );
  } catch {
    /* storage blocked */
  }
}

/**
 * Records which `userId` this device has seen sign in as `email`, so a later
 * sign-in attempt for that same email can find its hint without the device
 * needing to know (or send) any other account it remembers. Called
 * alongside `rememberHouse`, whenever a token naming both is minted.
 */
export function indexEmail(email: string | null | undefined, userId: string): void {
  if (!email || !UUID.test(userId)) return;
  const index = readEmailIndex();
  index[emailKey(email)] = userId;
  writeEmailIndex(index);
}

/**
 * What a sign-in sends: the ONE entry for the email being submitted, if this
 * device has seen that email sign in before — never any other account's.
 * Replaces the old "send everything this device remembers" (item 8,
 * 2026-09-19): the server still reads and checks it exactly as before
 * (`lastHouses: [{ userId, houseId, usedAt }]`), just with at most one row.
 */
export function lastHouseHintFor(
  email: string | null | undefined,
): HouseHint | null {
  if (!email) return null;
  const userId = readEmailIndex()[emailKey(email)];
  if (!userId) return null;
  const use = lastHouseFor(userId);
  return use ? { userId, ...use } : null;
}

export interface TokenClaims {
  sub?: string;
  email?: string | null;
  restaurantId?: string | null;
  role?: string | null;
}

/** The claims of a JWT, read without verifying it (the server verifies). */
export function tokenClaims(
  token: string | null | undefined,
): TokenClaims | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as TokenClaims)
      : null;
  } catch {
    return null;
  }
}

/** The house a token names, or null. */
export function tokenHouse(token: string | null | undefined): string | null {
  const house = tokenClaims(token)?.restaurantId;
  return typeof house === "string" && UUID.test(house) ? house : null;
}

/**
 * Store a freshly minted pair, and everything that follows from it: the
 * device's memory of the house it names, and `activeRestaurantId`, which the
 * rest of the app reads, set to the TOKEN'S house (or removed when it names
 * none). The token is the only source of truth for which house the session is
 * in; the page never picks one of its own (ADR 0164, research §1 b).
 */
export function storeSession(
  accessToken: string,
  refreshToken?: string | null,
): string | null {
  const house = tokenHouse(accessToken);
  try {
    window.localStorage.setItem("accessToken", accessToken);
    if (refreshToken) window.localStorage.setItem("refreshToken", refreshToken);
    if (house) window.localStorage.setItem("activeRestaurantId", house);
    else window.localStorage.removeItem("activeRestaurantId");
  } catch {
    /* storage blocked */
  }
  const claims = tokenClaims(accessToken);
  if (claims?.sub && house) {
    rememberHouse(claims.sub, house);
    indexEmail(claims.email, claims.sub);
  }
  return house;
}

/**
 * A refresh answered `houseAccessEnded`: the person is no longer a member of
 * that house. Forget it on this device, note it for the chooser's one
 * sentence, and return true so the caller sends them to the chooser.
 */
export function noteHouseEnded(
  accessToken: string,
  endedHouseId: string | null | undefined,
): boolean {
  if (!endedHouseId) return false;
  const sub = tokenClaims(accessToken)?.sub;
  if (sub) forgetHouse(sub, endedHouseId);
  try {
    window.sessionStorage.setItem(HOUSE_ENDED_KEY, endedHouseId);
  } catch {
    /* storage blocked: the chooser shows no sentence */
  }
  return true;
}

/** The house whose access just ended, if any. Kept until `clearHouseEnded`. */
export function readHouseEnded(): string | null {
  try {
    return window.sessionStorage.getItem(HOUSE_ENDED_KEY);
  } catch {
    return null;
  }
}

/** Drop the note, once the person has chosen a house or signed out. */
export function clearHouseEnded(): void {
  try {
    window.sessionStorage.removeItem(HOUSE_ENDED_KEY);
  } catch {
    /* storage blocked */
  }
}

/** A cached house name, for the "your access to X has ended" sentence. */
export function cachedHouseName(
  houseId: string | null | undefined,
): string | null {
  if (!houseId) return null;
  try {
    const raw = window.localStorage.getItem("availableRestaurants");
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return null;
    const hit = list.find((b: { id?: string }) => b && b.id === houseId);
    return hit && typeof hit.name === "string" && hit.name.trim()
      ? hit.name
      : null;
  } catch {
    return null;
  }
}

/** Send the person to the chooser, unless they are there or on /no-access. */
export function goToChooser(): void {
  try {
    const here = window.location.pathname;
    if (here === CHOOSER_PATH || here === "/no-access" || here === "/login")
      return;
    window.location.assign(CHOOSER_PATH);
  } catch {
    /* no window */
  }
}

export interface ChooserHouse {
  id: string;
  name: string;
  city: string | null;
}

/**
 * The chooser's order (ADR 0164, R7): this device's last house for the person
 * first, then the rest alphabetically, so the list does not shuffle between
 * visits. Returns the list and which row, if any, is "last opened here".
 */
export function orderForChooser(
  houses: ChooserHouse[],
  userId: string | null | undefined,
): { houses: ChooserHouse[]; lastOpenedId: string | null } {
  const byName = [...houses].sort((a, b) => a.name.localeCompare(b.name));
  const last = lastHouseFor(userId);
  const lastOpenedId =
    last && byName.some((h) => h.id === last.houseId) ? last.houseId : null;
  if (!lastOpenedId) return { houses: byName, lastOpenedId: null };
  return {
    houses: [
      ...byName.filter((h) => h.id === lastOpenedId),
      ...byName.filter((h) => h.id !== lastOpenedId),
    ],
    lastOpenedId,
  };
}

/** Above this many houses the chooser offers a search box (R7). */
export const CHOOSER_SEARCH_ABOVE = 8;
