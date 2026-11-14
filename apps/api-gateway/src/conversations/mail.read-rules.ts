import { BadRequestException } from "@nestjs/common";
import type { MailDoor, MailPersonRef } from "./mail.types";

/**
 * The pure rules of the Mail read model (founder /goal 2026-11-07): who sees
 * withheld letters, what a page cursor is, how big a page is, which door a
 * letter came by, and the "Subject:" line the bridge writes on top of a
 * letter. No database here; MailService applies these to what it reads.
 */

export const MAIL_PAGE_DEFAULT = 50;
export const MAIL_PAGE_MAX = 100;
/** G9: a thread is read 50 letters at a time, however long it is. */
export const MAIL_THREAD_PAGE = 50;

const OWNER_MANAGER_ROLES = new Set(["owner", "manager"]);

/** The least trusted reading of a missing or unknown role, never the most. */
export function withholdsHouseLetters(
  role: string | null | undefined,
): boolean {
  return !(
    typeof role === "string" && OWNER_MANAGER_ROLES.has(role.toLowerCase())
  );
}

// Copied from conversations.service.ts (not exported there): `status` is
// nullable, so each test keeps the NULL rows a bare `neq` would drop.
export const WITHHOLD_HOUSE_DRAFT = "status.is.null,status.neq.HOUSE_DRAFT";
export const WITHHOLD_HOUSE_CANCELLED =
  "status.is.null,status.neq.HOUSE_CANCELLED";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Postgres timestamptz as PostgREST prints it (microseconds kept). */
const PG_TIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
export const PERSON_KEY_RE =
  /^vendor:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SUBJECT_LINE_RE = /^\s*subject:[^\n]*(\r?\n|$)\s*/i;

export const BAD_CURSOR =
  "That page link is not one this list made. Open the mail list again from the top.";
export const READ_FAILED =
  "The mail could not be read just now. Nothing was changed; try again in a moment.";

/** One page boundary: the time and key of the last row the caller saw. */
export interface MailCursor {
  at: string;
  key: string;
}

export function encodeMailCursor(at: string, key: string): string {
  return Buffer.from(JSON.stringify([at, key]), "utf8").toString("base64url");
}

/**
 * Only for checking the date is real: Postgres may print the offset as `+00`
 * or `+0000`, which Date.parse refuses, so it is widened to `+00:00`. The
 * cursor itself keeps the string exactly as Postgres printed it.
 */
function isoForDateParse(pgTime: string): string {
  return pgTime
    .replace(" ", "T")
    .replace(
      /([+-]\d{2}):?(\d{2})?$/,
      (_m, h: string, m?: string) => `${h}:${m ?? "00"}`,
    );
}

/** Throws a 400 in words for anything this service did not make. */
export function decodeMailCursor(raw: string): MailCursor {
  let parsed: unknown;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(raw)) throw new Error("charset");
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException(BAD_CURSOR);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    !PG_TIME_RE.test(parsed[0]) ||
    Number.isNaN(Date.parse(isoForDateParse(parsed[0]))) ||
    parsed[1].length === 0 ||
    parsed[1].length > 500
  ) {
    throw new BadRequestException(BAD_CURSOR);
  }
  return { at: parsed[0], key: parsed[1] };
}

/** The most a Mail search reads of what was typed (r28 mail gap 16). */
export const MAIL_SEARCH_MAX = 100;
export const SEARCH_TOO_LONG = `A search is at most ${MAIL_SEARCH_MAX} characters.`;

/**
 * What was typed into the Mail search, trimmed; null for no search. A
 * repeated `q` (an array) or one past the limit is a 400 in words, never a
 * search the caller did not ask for.
 */
export function mailSearchOf(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new BadRequestException("Search for one thing at a time.");
  }
  const q = raw.trim();
  if (!q) return null;
  if (q.length > MAIL_SEARCH_MAX) throw new BadRequestException(SEARCH_TOO_LONG);
  return q;
}

/** Default 50, clamped to 1..100. Anything that is not a whole number is a 400. */
export function clampMailLimit(
  raw: string | number | undefined | null,
): number {
  if (raw === undefined || raw === null || raw === "") return MAIL_PAGE_DEFAULT;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BadRequestException("The page size must be a whole number.");
  }
  return Math.min(MAIL_PAGE_MAX, Math.max(1, n));
}

/** The letter without the "Subject: ..." line the bridge writes on top. */
export function stripSubjectLine(text: string | null | undefined): string {
  return (text ?? "").replace(SUBJECT_LINE_RE, "");
}

/** Which door a stored letter came by, from stored columns alone. */
export function mailDoorOf(row: {
  direction?: string | null;
  channel?: string | null;
  mirrored_by_grant_id?: string | null;
}): MailDoor {
  if ((row.direction ?? "").toLowerCase() !== "inbound") return "from_house";
  if (row.mirrored_by_grant_id) return "house_mailbox";
  if ((row.channel ?? "").toLowerCase() === "whatsapp") return "whatsapp";
  return "mudavym_mail";
}

export function mailDirectionOf(v: unknown): "inbound" | "outbound" | null {
  const d = typeof v === "string" ? v.toLowerCase() : "";
  return d === "inbound" || d === "outbound" ? d : null;
}

export function personRef(providerId: string, name: unknown): MailPersonRef {
  return {
    key: `vendor:${providerId}`,
    kind: "vendor",
    providerId,
    name: typeof name === "string" ? name : null,
  };
}

export const SEEN_BAD_TIME =
  "Name the newest letter the thread showed, as the thread gave its time.";

/**
 * The time of the newest letter a screen showed, for POST /mail/thread/seen.
 * Kept exactly as given (Postgres keeps microseconds; a JavaScript Date would
 * drop them, and the thread would then never read as seen). Anything that is
 * not a real Postgres time is a 400 in words.
 */
export function mailSeenThroughOf(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    !PG_TIME_RE.test(raw.trim()) ||
    Number.isNaN(Date.parse(isoForDateParse(raw.trim())))
  ) {
    throw new BadRequestException(SEEN_BAD_TIME);
  }
  return raw.trim();
}

/**
 * Is this row new to the person reading it (r36 mail gap 6)? Only when its
 * newest letter came from the vendor and is later than the newest letter of
 * it they were shown. A row never opened is new. `seenKnown` false means the
 * marks could not be read: then nobody can say, and the answer is null,
 * never false.
 */
export function newToYou(
  lastDirection: "inbound" | "outbound" | null,
  lastAt: unknown,
  seenThrough: unknown,
  seenKnown: boolean,
): boolean | null {
  if (!seenKnown) return null;
  if (lastDirection !== "inbound" || typeof lastAt !== "string") return false;
  if (typeof seenThrough !== "string") return true;
  const last = Date.parse(isoForDateParse(lastAt));
  const seen = Date.parse(isoForDateParse(seenThrough));
  if (Number.isNaN(last)) return false;
  if (Number.isNaN(seen)) return true;
  return last > seen;
}
