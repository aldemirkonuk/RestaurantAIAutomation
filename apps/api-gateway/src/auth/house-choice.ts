/**
 * Which house a sign-in lands in (ADR 0164; the founder, 2026-09-18/19: "if
 * they own couple houses ... we let them choose which", and "after quite some
 * time let them choose which restaurant to go").
 *
 *   active memberships 0   -> no house, no role
 *   active memberships 1   -> that house, however long they were away
 *   active memberships 2+  -> the house this DEVICE last used, if it is still
 *                             one of theirs and was used within
 *                             HOUSE_RETURN_WINDOW_MS; otherwise they choose
 *
 * The device sends what it remembers as a hint (`lastHouses`); the hint is
 * never authority. The server checks it against active memberships on every
 * sign-in, so a stale or forged hint can only ever pick among the person's own
 * houses, or be ignored.
 */

/**
 * "Quite some time": seven days (ADR 0164, R2). A restaurant runs on a weekly
 * cycle, and a person running several houses touches each within a week.
 *
 * Its own constant on purpose. It happens to equal the refresh token's
 * lifetime today (`generateTokens`, "7d"), so a session that lapsed from
 * disuse is always past the window, but the two answer different questions:
 * one is how old a guess about intent may be, the other how long a credential
 * lives. Changing one must not silently change the other.
 */
export const HOUSE_RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far in the future a device's clock may put `usedAt` and still be read.
 * Beyond this the hint is not a clock we can reason about, so it is ignored
 * and the person chooses.
 */
export const HOUSE_HINT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** At most this many hints are read from one request; the rest are ignored. */
export const HOUSE_HINTS_READ = 20;

/** The code a request carries when its token names a house the person left. */
export const HOUSE_ACCESS_ENDED = "HOUSE_ACCESS_ENDED";

/** The code a request carries when it needs a house and the session has none. */
export const HOUSE_REQUIRED = "HOUSE_REQUIRED";

export interface HouseHint {
  userId: string;
  houseId: string;
  usedAt: number;
}

export interface SignInHouse {
  /** The house the token will name, or null. */
  house: string | null;
  /** True when the person has two or more houses and must pick one. */
  choose: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The hints a sign-in body carries, as `[{ userId, houseId, usedAt }]`.
 *
 * Anything malformed is dropped rather than refused: a hint is a convenience,
 * and a bad one must never stop someone signing in. `usedAt` is epoch
 * milliseconds or an ISO string.
 */
export function parseLastHouseHints(raw: unknown): HouseHint[] {
  if (!Array.isArray(raw)) return [];
  const out: HouseHint[] = [];
  for (const entry of raw.slice(0, HOUSE_HINTS_READ)) {
    if (!entry || typeof entry !== "object") continue;
    const { userId, houseId, usedAt } = entry as Record<string, unknown>;
    if (typeof userId !== "string" || !UUID.test(userId)) continue;
    if (typeof houseId !== "string" || !UUID.test(houseId)) continue;
    const at =
      typeof usedAt === "number"
        ? usedAt
        : typeof usedAt === "string"
          ? Date.parse(usedAt)
          : NaN;
    if (!Number.isFinite(at)) continue;
    out.push({ userId, houseId, usedAt: at });
  }
  return out;
}

/** The newest hint this device holds for `userId`, or null. */
export function hintFor(hints: HouseHint[], userId: string): HouseHint | null {
  let best: HouseHint | null = null;
  for (const h of hints) {
    if (h.userId !== userId) continue;
    if (!best || h.usedAt > best.usedAt) best = h;
  }
  return best;
}

/** The sign-in rule itself. Pure: memberships and the clock come in. */
export function signInHouse(
  memberships: string[],
  hint: HouseHint | null,
  now: number,
): SignInHouse {
  if (memberships.length === 0) return { house: null, choose: false };
  if (memberships.length === 1) return { house: memberships[0], choose: false };

  const recent =
    hint !== null &&
    memberships.includes(hint.houseId) &&
    hint.usedAt <= now + HOUSE_HINT_CLOCK_SKEW_MS &&
    now - hint.usedAt <= HOUSE_RETURN_WINDOW_MS;

  return recent
    ? { house: hint.houseId, choose: false }
    : { house: null, choose: true };
}
