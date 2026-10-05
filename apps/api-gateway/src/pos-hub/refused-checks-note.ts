/**
 * One bell note for the owners and managers when a POS import refuses checks
 * (ADR 0281, amended 2026-10-05: refused checks reach the bell).
 *
 * WHY
 * ---
 * ADR 0281's ruling F4 refuses a check whose closing time the import cannot
 * read: no `pos_checks` row, no stock, no consumption. The import result says
 * so (`refusedUnreadableDate`, `errors[]`), but only the caller reads that
 * result, and a webhook has no person reading its response. The founder's
 * answers (2026-10-05, verbatim in the ADR): "Bell note, follow-up PR
 * (Recommended)", then F5 "One note per till per hour (Recommended)" and F6
 * "Push outside quiet hours (Recommended)", then "Bring it back
 * (Recommended)", "One push per hour, re-flagged (Recommended)" and "Quiet
 * means quiet (Recommended)", then "Count each check once (Recommended)",
 * then "New note at once (Recommended)", "No, stays as it is (Recommended)"
 * and "Respect their switch (Recommended)".
 *
 * WHAT IT DOES
 * ------------
 * - ONE NOTE PER TILL PER HOUR (F5). `PosHubService.ingest()` calls this once
 *   per import, after its loop, and only when something was refused. When this
 *   house's note for this till (group key `pos_import_refused:<till>`) was
 *   first written less than `OPEN_NOTE_WINDOW_MINUTES` ago, the refusals are
 *   COUNTED INTO IT: when that raises its count (below), every recipient's
 *   row of that note, archived ones too ("Bring it back"), gets the new
 *   count, title and words, the named ids stay at most `MAX_NOTE_CHECK_IDS`
 *   in total, and the row returns to unread. No row is written and nothing
 *   is pushed. Otherwise a new note is written. A file import is one call,
 *   so it is still one note.
 * - EACH CHECK COUNTED ONCE ("Count each check once"). The note counts the
 *   distinct check ids refused in its hour: a check the till sends again,
 *   in the same import or a later one, is not counted or named again. The
 *   note keeps the ids it counted, at most `MAX_NOTE_KEPT_CHECKS`, each as a
 *   key (`checkKey`, a digest of the id as the till sent it), and names the
 *   first `MAX_NOTE_CHECK_IDS` of them. Once it has counted more ids than it
 *   keeps, an id it does not keep may be one it counted, so a later import
 *   that brings such an id makes the count a floor, said as "At least N"
 *   (`atLeast`), never more than it can prove. A check with no id is never
 *   merged with another: each one is counted every time it is refused, and
 *   the note says so (`withoutId`). An import that adds no check the note
 *   had not counted changes nothing in it, so nothing is written and no row
 *   turns unread or comes back from the archive (the founder: "No, stays as
 *   it is (Recommended)").
 * - A ROW DELETED FROM THE BELL is gone (`deleteNotification` removes it), so
 *   it is neither read nor brought back: while another recipient still holds
 *   a row of the note, the one who deleted it hears nothing more of that note
 *   ("Stays deleted (Recommended)"). When every row of the note is deleted,
 *   nothing is left to find, so the next refusal inside the same hour writes
 *   a new note, with only its own checks, and pushes it to every owner and
 *   manager, those who deleted the old one too (the founder: "New note at
 *   once (Recommended)").
 * - THE IMPORT ANSWERS ON TIME. The import waits at most `NOTE_DEADLINE_MS`
 *   for its note, then answers without it, says so, and logs it; the note
 *   goes on being filed. One filing that never answers holds the next one for
 *   the same house and till for at most that long, so the queue cannot wedge.
 * - To the house's ACTIVE OWNERS AND MANAGERS only (`user_restaurant_access`,
 *   this house, `is_active`), written with `onlyUserIds`, so staff never get
 *   it and `persistForRestaurant` intersects it with the house's own members.
 *   A role read from the legacy `users` row is not read: that row proves
 *   membership, never privilege (ADR 0088).
 * - Away (ADR 0218) is applied by the funnel's own ladder,
 *   `AreaRoutingService.route`, over those owners and managers: the ones
 *   Away today are set aside; if every one of them is Away, the owners get
 *   the row in their inbox only (no push, no live ping), so it never waits
 *   unseen. An unreadable Away register writes to all of them, as the
 *   funnel does.
 * - QUIET HOURS (F6). A recipient inside their quiet window gets the row with
 *   no push and no live ping. The window is read with `isWithinQuietHours`
 *   (`calendar/reminder-window.ts`, the rule the sweeping producers use) from
 *   `NotificationsService.getPreferences` (its defaults for a person with no
 *   row: quiet hours off), on the house's clock from `houseFrame` (ADR 0207:
 *   the house's own zone, else its country's only zone). When the house's
 *   zone cannot be read or is not known, quiet hours are not judged and
 *   everyone whose push switch is on is pushed; when one person's
 *   preferences cannot be read, that person is pushed, as before quiet hours
 *   were read (the founder: "Push anyway (Recommended)"). Either is logged
 *   and said in `caveats`.
 * - THE PERSON'S OWN PUSH SWITCH (the founder: "Respect their switch
 *   (Recommended)"). A recipient whose switch is off gets the row with no
 *   push and no live ping, as a quiet person does, whatever their quiet hours
 *   and whether the house's zone reads; `pushSwitchedOff` counts them. The
 *   switch is `push` in the same `getPreferences` answer, which
 *   `mapPreferencesRow` takes from `notification_preferences.push_enabled`
 *   (`?? true`), and which is `true` for a person with no row. Only a
 *   literal `false` is off, as `channelAllowed` (`team/broadcast-preferences.ts`)
 *   reads it: a missing row, or a field that is not there, pushes; a read
 *   that fails pushes too (above). Other notes written through the funnel
 *   still do not read it (`v3.0-TECH-DEBT.md`, the team broadcast entry: the
 *   funnel's own push "reading no preference"); the team broadcast reads it
 *   for its own push.
 * - The note names at most `MAX_NOTE_CHECK_IDS` check ids and counts the
 *   rest, each id cut at `MAX_NOTE_ID_CHARS`. It carries the till's name, the
 *   count, and the first unreadable value the till sent, cut at 40
 *   characters. Nothing else from the payload, and no secret; the kept keys
 *   are digests of the ids it counted, not the ids. The phone
 *   push's `data` carries only the note's id and count (`pushData`), with the
 *   type and link the funnel adds, never the till's text; the push's title and
 *   body are the note's own, so its body still names the ids and the value.
 *
 * TWO IMPORTS AT ONCE
 * -------------------
 * Inside one gateway process, the notes of one house and one till are filed
 * one at a time (`oneAtATime`), so a burst of webhooks writes one note and
 * counts the rest into it, unless one filing outlasts `NOTE_DEADLINE_MS`, when
 * the next starts beside it, as another process would. Across processes nothing
 * serialises them: two imports with no open note can each write one (two notes,
 * two pushes, one per process), and two that count into the same note race on
 * the update, which only changes rows whose title, and so whose count, is still
 * the one that was read; the loser reads again once, and if it loses again it
 * writes a new note rather than drop its refusals. A note's pushed rows, its
 * quiet rows and the rows of those whose push switch is off are written by up
 * to three calls, so an update from another process can land between them;
 * the rows written later then hold the older count until the
 * next import counted into the note brings them up (one that adds no check
 * too), and only rows still holding a count it read, lower than the one it
 * writes, so an older count never lands over a newer one. "Lower" orders the
 * count first, then an exact count below "at least" the same count
 * (`noteRank`); every write raises it, so the title is a version.
 *
 * NEVER THROWS
 * ------------
 * A note that could not be filed must not fail or undo the import: the checks
 * were refused whatever happens here. Every path returns a `RefusedChecksNote`
 * that the import result carries as `bellNote`, so "not filed" is said, with
 * its reason, rather than read as "told" (ADR 0067's "a failed read is never
 * an empty one", in spirit). The reason is a fixed phrase; a database's own
 * message goes to the log only. Neither route returns more than `filed`
 * (`bellNoteForTill`): a webhook caller and the file import's caller alike
 * learn whether the bell was rung, and the reasons and counts stay in the log.
 *
 * NO EMOJI: `notification-text-is-plain.spec.ts` scans every gateway file that
 * names a notification funnel, and this one does.
 */
import { createHash, randomUUID } from "crypto";
import type { Logger } from "@nestjs/common";
import type { AreaRoutingService } from "../areas/area-routing.service";
import { isWithinQuietHours } from "../calendar/reminder-window";
import { houseFrame } from "../common/house-frame";
import type { NotificationsService } from "../notifications/notifications.service";
import { PROVIDER_BY_KEY } from "./pos-provider.registry";

/** The bell row's `type`. */
export const REFUSED_CHECKS_NOTE_TYPE = "pos_import_refused";

/** At most this many refused check ids are named in a note; the rest are counted. */
export const MAX_NOTE_CHECK_IDS = 10;

/**
 * "Count each check once": a note keeps at most this many of the check ids it
 * counted, as keys, to tell a check sent again from a new one; past it the
 * count can only be a floor ("at least"). Why 500 and not the 10 it names: a
 * till that sends one check per webhook (F5's own case) brings one new id per
 * import, and with 10 kept its note would read "At least 11" for the rest of
 * the hour however many more were refused. 500 is a chosen figure, not a
 * measured one: fifty times the ids named, meant to leave room for such a
 * till's hour and for an export sent twice, at a size every recipient's row
 * can carry (16 characters a key, about 9 KB at the bound). No till's hourly
 * refusals were counted, Tuzlu's included. A house that refuses more distinct
 * checks than that in an hour can read "At least N": a floor, never more than
 * the note can prove.
 */
export const MAX_NOTE_KEPT_CHECKS = 500;

/** A check id longer than this is cut, so one id cannot fill a phone screen. */
export const MAX_NOTE_ID_CHARS = 40;

/** The value the till sent, as the note quotes it, is cut at this length. */
const MAX_NOTE_VALUE_CHARS = 40;

/**
 * F5: a till's note takes later refusals for this long after it was first
 * written ("One note per till per hour").
 */
export const OPEN_NOTE_WINDOW_MINUTES = 60;

/** The open-note read returns at most this many rows (one per recipient). */
const OPEN_NOTE_READ_LIMIT = 200;

/** Reads of the open note before a lost update writes a new note instead. */
const OPEN_NOTE_TRIES = 2;

/**
 * Every status a note's row is written or set to (`notifications.service.ts`:
 * written `unread`, set `read` or `archived`). A note counted into within its
 * hour is read, and updated, in all three, so an archived row returns to
 * unread with the new count (the founder: "Bring it back (Recommended)"). A
 * status outside this list is neither read nor revived.
 */
const NOTE_STATUSES = ["unread", "read", "archived"];

/**
 * The import waits at most this long for its note, from the call, then
 * answers without it (ADR 0281, amended 2026-10-05). The import's own work is
 * done by then; the note normally needs a handful of reads, one or two writes
 * and one push. A filing that never answers holds the next one for the same
 * house and till for at most this long after it started.
 */
export const NOTE_DEADLINE_MS = 3_000;

/** What the import result says about the note, as `bellNote`. */
export interface RefusedChecksNote {
  /** True when the refusals reached at least one owner's or manager's bell. */
  filed: boolean;
  /**
   * True when they were counted into this till's note from the last hour
   * (F5): rows updated, none written, nothing pushed. Also true when that
   * note had already counted every one of them ("Count each check once"):
   * nothing in it changed.
   */
  addedToOpenNote: boolean;
  /**
   * How many bells were written to, or updated; 0 when the open note had
   * already counted every check this import refused and no row of it was
   * behind, so nothing was written.
   */
  recipients: number;
  /** Owners and managers set aside because they are Away today (ADR 0218). */
  heldAway: number;
  /**
   * Recipients inside their quiet hours, with their push switch on: the row,
   * without a push or a live ping (F6).
   */
  quietHours: number;
  /**
   * Recipients whose own push switch is off: the row, without a push or a
   * live ping, whatever their quiet hours ("Respect their switch").
   */
  pushSwitchedOff: number;
  /**
   * Why it was not filed, as a fixed phrase (a database's own message is
   * logged, never returned). Null when it was.
   */
  notFiledBecause: string | null;
  /**
   * What fell back, as fixed phrases: an open note that could not be read or
   * updated (a new note was written), a house zone that could not be read
   * (quiet hours not judged; everyone whose switch is on was pushed), a
   * person's preferences that could not be read (that person was pushed).
   * Empty when nothing fell back. Not said here: an Away register that
   * cannot be read (`AreaRoutingService` logs it), and a pushed group that
   * wrote no rows beside a group without a push that wrote some.
   */
  caveats: string[];
}

/**
 * What a caller of either import route is told about the note: whether it was
 * filed, and nothing about who hears it, who is Away, quiet or has push
 * switched off, or why it was not filed.
 * A webhook secret need not be the house's own (the legacy one signs the body
 * alone), so its holder learns no more than that. The file import is open to
 * any member of the house, staff included, so it is told the same (ADR 0281,
 * founder 2026-10-05: "Only 'the bell was rung' (Recommended)").
 */
export type RefusedChecksNoteForTill = Pick<RefusedChecksNote, "filed">;

/** `bellNote` as both import routes return it; null when no note was due. */
export function bellNoteForTill(
  note: RefusedChecksNote | null | undefined,
): RefusedChecksNoteForTill | null {
  return note ? { filed: note.filed === true } : null;
}

/** The part of a refused check the note reads. */
export interface RefusedCheck {
  externalCheckId: unknown;
  closedAt?: unknown;
}

/** What a note says, as every one of its rows' metadata carries it. */
export interface NoteState {
  /**
   * The checks this note counts: the distinct check ids refused in its hour,
   * plus every refusal that came with no id. Exact, or a floor when
   * `atLeast`.
   */
  refused: number;
  /**
   * True once the count can no longer be proven exact: the note counted more
   * ids than it keeps, and a later import brought an id it does not keep,
   * which may be one it counted. Never turns false again.
   */
  atLeast: boolean;
  /**
   * The ids named: the first `MAX_NOTE_CHECK_IDS` of the ids kept, as shown,
   * in the order first refused.
   */
  checkIds: string[];
  /**
   * The ids kept, as `checkKey`s, at most `MAX_NOTE_KEPT_CHECKS`, in the
   * order first refused: how a check sent again is told from a new one.
   */
  checkKeys: string[];
  /** Refusals that came with no check id, each counted (never merged). */
  withoutId: number;
  /** The first unreadable value the till sent, as quoted. */
  firstSent: string;
  /** How many imports changed this note: its first, and each that added to it. */
  imports: number;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A log line's detail, in parentheses; nothing when there is none. */
function inParens(detail: string | undefined): string {
  return detail ? ` (${detail})` : "";
}

/** A check id as the note shows it: one line, cut, never blank. */
export function sayCheckId(id: unknown): string {
  const text = String(id ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? cut(text, MAX_NOTE_ID_CHARS) : "(no id)";
}

/** The value the till sent, as JSON, on one line, cut. */
function sayValue(value: unknown): string {
  const text = (JSON.stringify(value) ?? String(value)).replace(/\s+/g, " ");
  return cut(text, MAX_NOTE_VALUE_CHARS);
}

/** The till as the house knows it: the registry's name, else its key. */
export function tillName(providerKey: string): string {
  return PROVIDER_BY_KEY[providerKey]?.name ?? providerKey;
}

/**
 * The key a refused check is counted by: the first 16 hex characters (64
 * bits) of the SHA-256 of its id exactly as the till sent it, so an id of any
 * length is kept in 16 characters, and two ids that differ anywhere are two
 * checks (the import's own `pos_checks` row is keyed on the same exact id).
 * Two different ids share a key with a chance below 1 in 10^13 among 500.
 * Null for a check with no id (blank, or only spaces): it cannot be told from
 * another, so it is never merged with one.
 */
export function checkKey(id: unknown): string | null {
  const text = String(id ?? "");
  if (text.trim() === "") return null;
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** A note before any import: what `freshState` adds the first import to. */
const EMPTY_STATE: NoteState = {
  refused: 0,
  atLeast: false,
  checkIds: [],
  checkKeys: [],
  withoutId: 0,
  firstSent: "",
  imports: 0,
};

/** One import's refusals, as a new note holds them. */
export function freshState(refused: ReadonlyArray<RefusedCheck>): NoteState {
  return addToState(EMPTY_STATE, refused);
}

/**
 * An import's refusals counted into a note ("Count each check once
 * (Recommended)"). Pure.
 *
 * - An id is counted once: one this import repeats, or one the note keeps
 *   (`checkKeys`), is not counted or named again.
 * - While every id the note counted is one it keeps, an id it does not keep
 *   is a new check: it is counted, and kept while there is room (at most
 *   `MAX_NOTE_KEPT_CHECKS`), and named while fewer than `MAX_NOTE_CHECK_IDS`
 *   are; the count stays exact.
 * - Once the note has counted more ids than it keeps, an id it does not keep
 *   may be one of those it counted and no longer knows. The ids are then
 *   counted at the floor the note can prove: the larger of what it counted
 *   and the ids it keeps plus this import's ids it does not keep. If this
 *   import brought such an id, the count becomes "at least" (`atLeast`);
 *   an import that brings only kept ids leaves it as it was.
 * - A check with no id is counted every time it is refused, never merged.
 */
export function addToState(
  prev: NoteState,
  refused: ReadonlyArray<RefusedCheck>,
): NoteState {
  const known = new Set(prev.checkKeys);
  const seen = new Set<string>();
  const fresh: Array<{ key: string; shown: string }> = [];
  let withoutId = 0;
  for (const c of refused) {
    const key = checkKey(c.externalCheckId);
    if (key === null) {
      withoutId++;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    if (!known.has(key))
      fresh.push({ key, shown: sayCheckId(c.externalCheckId) });
  }
  const allKept =
    !prev.atLeast && prev.refused - prev.withoutId === prev.checkKeys.length;
  const room = allKept
    ? Math.max(0, MAX_NOTE_KEPT_CHECKS - prev.checkKeys.length)
    : 0;
  const kept = fresh.slice(0, room);
  const namedRoom = Math.max(0, MAX_NOTE_CHECK_IDS - prev.checkIds.length);
  const idsCounted = allKept
    ? prev.checkKeys.length + fresh.length
    : Math.max(
        prev.refused - prev.withoutId,
        prev.checkKeys.length + fresh.length,
      );
  const atLeast = allKept ? false : prev.atLeast || fresh.length > 0;
  return {
    refused: idsCounted + prev.withoutId + withoutId,
    atLeast,
    checkIds: [
      ...prev.checkIds,
      ...kept.slice(0, namedRoom).map((k) => k.shown),
    ],
    checkKeys: [...prev.checkKeys, ...kept.map((k) => k.key)],
    withoutId: prev.withoutId + withoutId,
    firstSent:
      prev.imports === 0
        ? refused.length > 0
          ? sayValue(refused[0].closedAt)
          : ""
        : prev.firstSent,
    imports: prev.imports + 1,
  };
}

/**
 * A note's standing: its count, then an exact count below "at least" the
 * same count. Every write to a note raises it, and the title says it, so a
 * title is a version (the compare-and-sets in `addToOpenNote`).
 */
export function noteRank(s: NoteState): number {
  return s.refused * 2 + (s.atLeast ? 1 : 0);
}

const KEY_SHAPE = /^[0-9a-f]{16}$/;

/** A note's state read back from a row's metadata; null when it does not read. */
function readState(metadata: unknown): NoteState | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const refused = m.refused;
  if (typeof refused !== "number" || !Number.isInteger(refused) || refused < 1)
    return null;
  const imports =
    typeof m.imports === "number" &&
    Number.isInteger(m.imports) &&
    m.imports >= 1
      ? m.imports
      : 1;
  const withoutId = m.withoutId ?? 0;
  if (
    typeof withoutId !== "number" ||
    !Number.isInteger(withoutId) ||
    withoutId < 0
  )
    return null;
  const atLeast = m.atLeast ?? false;
  if (typeof atLeast !== "boolean") return null;
  // The ids named are the first of the ids kept: a row whose two do not
  // line up, or whose keys are not keys, cannot say which checks it counted.
  const checkIds = m.checkIds;
  const checkKeys = m.checkKeys;
  if (
    !Array.isArray(checkIds) ||
    !Array.isArray(checkKeys) ||
    checkIds.length !== Math.min(checkKeys.length, MAX_NOTE_CHECK_IDS) ||
    checkKeys.length > MAX_NOTE_KEPT_CHECKS ||
    !checkIds.every((x) => typeof x === "string") ||
    !checkKeys.every((x) => typeof x === "string" && KEY_SHAPE.test(x)) ||
    checkKeys.length + withoutId > refused
  )
    return null;
  return {
    refused,
    atLeast,
    checkIds: checkIds as string[],
    checkKeys: checkKeys as string[],
    withoutId,
    firstSent: typeof m.firstSent === "string" ? m.firstSent : "",
    imports,
  };
}

/** Ids counted but not named: past the first `MAX_NOTE_CHECK_IDS`. */
function idsNotNamed(s: NoteState): number {
  return Math.max(0, s.refused - s.withoutId - s.checkIds.length);
}

/** The metadata fields a note's state is kept in. */
function stateMetadata(s: NoteState): Record<string, unknown> {
  return {
    refused: s.refused,
    atLeast: s.atLeast,
    checkIds: s.checkIds,
    checkKeys: s.checkKeys,
    checkIdsNotNamed: idsNotNamed(s),
    withoutId: s.withoutId,
    firstSent: s.firstSent,
    imports: s.imports,
  };
}

/**
 * The note's words for a state. Pure. The title is the founder's own example
 * ("3 checks not imported: date not readable"), led by "At least" when the
 * count is a floor ("Past a cap it says 'at least'"); no internal field name
 * appears in it.
 */
export function noteWords(
  providerKey: string,
  s: NoteState,
): { title: string; message: string; notNamed: number } {
  const n = s.refused;
  const one = n === 1;
  const count = `${s.atLeast ? "At least " : ""}${n}`;
  const notNamed = idsNotNamed(s);
  const w = s.withoutId;
  const title = `${count} check${one ? "" : "s"} not imported: date not readable`;
  const sent = s.firstSent
    ? ` (${one ? "it was" : "the first was"} written as ${s.firstSent})`
    : "";
  const named =
    s.checkIds.length > 0
      ? `${one ? "Check" : "Checks"}: ${s.checkIds.join(", ")}` +
        `${notNamed > 0 ? `, and ${s.atLeast ? "at least " : ""}${notNamed} more` : ""}. `
      : "";
  const noId =
    w > 0
      ? `${w === n ? (one ? "It" : "They") : `${w} of them`} came with no check id, ` +
        `so ${w === 1 ? "it is" : "each is"} counted every time it is sent. `
      : "";
  const floor = s.atLeast
    ? `This note keeps the first ${MAX_NOTE_KEPT_CHECKS} check ids, so past those a check sent again cannot be told from a new one. `
    : "";
  const message =
    `${count} check${one ? "" : "s"} from ${tillName(providerKey)} ` +
    `${one ? "was" : "were"} not imported because ${one ? "its" : "their"} closing time could not be read` +
    `${sent}. ` +
    `${one ? "Its sale and its stock are" : "Their sales and stock are"} not recorded. ` +
    named +
    noId +
    floor +
    `Send ${one ? "it" : "them"} again with the closing time written as 2026-10-03 21:00.`;
  return { title, message, notNamed };
}

/** The words of a new note for one import's refusals. */
export function refusedChecksNoteCopy(input: {
  providerKey: string;
  refused: ReadonlyArray<RefusedCheck>;
}): {
  title: string;
  message: string;
  named: string[];
  notNamed: number;
} {
  const s = freshState(input.refused);
  const { title, message, notNamed } = noteWords(input.providerKey, s);
  return { title, message, named: s.checkIds, notNamed };
}

function isOwnerOrManager(role: unknown): boolean {
  if (typeof role !== "string") return false;
  const r = role.trim().toLowerCase();
  return r === "owner" || r === "manager";
}

type Deps = {
  client: any;
  notifications?: NotificationsService;
  areaRouting?: AreaRoutingService;
  logger: Logger;
  /** `NOTE_DEADLINE_MS` unless given (the spec gives a short one). */
  deadlineMs?: number;
};

type Input = {
  restaurantId: string;
  providerKey: string;
  refused: ReadonlyArray<RefusedCheck>;
  now?: Date;
};

/** Resolves when `p` settles or `ms` have passed, whichever is first. */
function settledOrAfter(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
}

/**
 * Inside this process, the work for one key runs after the previous work for
 * that key has settled, so one note's read-then-write is never interleaved
 * with another's; but never more than `holdMs` after the previous work
 * started, so a read or push that never answers cannot hold every later
 * filing for that key. The entry is dropped once its chain is idle.
 */
const queues = new Map<string, Promise<void>>();
function oneAtATime<T>(
  key: string,
  work: () => Promise<T>,
  holdMs: number,
): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(work);
  const released = before.then(() => settledOrAfter(run, holdMs));
  queues.set(key, released);
  void released.then(() => {
    if (queues.get(key) === released) queues.delete(key);
  });
  return run;
}

/**
 * The filing's own answer, or `onLate()` once `ms` have passed from the call,
 * whichever is first. The filing is not stopped: it goes on, and logs its own
 * outcome when it settles.
 */
function answerBy(
  filing: Promise<RefusedChecksNote>,
  ms: number,
  onLate: () => RefusedChecksNote,
  onFailed: (e: unknown) => RefusedChecksNote,
): Promise<RefusedChecksNote> {
  return new Promise<RefusedChecksNote>((resolve) => {
    let answered = false;
    const answer = (note: () => RefusedChecksNote) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      resolve(note());
    };
    const timer = setTimeout(() => answer(onLate), ms);
    filing.then(
      (note) => answer(() => note),
      (e: unknown) => answer(() => onFailed(e)),
    );
  });
}

/** A note with nothing filed, as the import result carries it. */
function notFiledNote(why: string): RefusedChecksNote {
  return {
    filed: false,
    addedToOpenNote: false,
    recipients: 0,
    heldAway: 0,
    quietHours: 0,
    pushSwitchedOff: 0,
    notFiledBecause: why,
    caveats: [],
  };
}

/**
 * File the refusals of one import: counted into this till's open note, or a
 * new note. Never throws, and answers within the deadline; see the header for
 * every outcome.
 */
export function fileRefusedChecksNote(
  deps: Deps,
  input: Input,
): Promise<RefusedChecksNote> {
  const deadlineMs = deps.deadlineMs ?? NOTE_DEADLINE_MS;
  const where =
    `restaurant=${input.restaurantId} source=${input.providerKey} ` +
    `refused=${input.refused.length}`;
  const filing = oneAtATime(
    `${input.restaurantId}|${input.providerKey}`,
    () => fileOnce(deps, input),
    deadlineMs,
  );
  return answerBy(
    filing,
    deadlineMs,
    () => {
      deps.logger.warn(
        `POS_REFUSED_CHECKS_NOTE_LATE ${where} — no answer within ${deadlineMs} ms, so the import answered without it. ` +
          "The note is still being filed; its outcome is logged when it settles.",
      );
      return notFiledNote(
        `the bell did not answer within ${deadlineMs / 1000} s; the note may still arrive`,
      );
    },
    (e: unknown) => {
      deps.logger.warn(
        `POS_REFUSED_CHECKS_NOTE_NOT_FILED ${where} — the bell write failed (${reasonOf(e)}).`,
      );
      return notFiledNote("the bell write failed");
    },
  );
}

async function fileOnce(deps: Deps, input: Input): Promise<RefusedChecksNote> {
  const { restaurantId, providerKey, refused } = input;
  const now = input.now ?? new Date();
  const groupKey = `${REFUSED_CHECKS_NOTE_TYPE}:${providerKey}`;
  const caveats: string[] = [];
  const said = (
    r: Pick<RefusedChecksNote, "filed"> & Partial<RefusedChecksNote>,
  ): RefusedChecksNote => ({
    addedToOpenNote: false,
    recipients: 0,
    heldAway: 0,
    quietHours: 0,
    pushSwitchedOff: 0,
    notFiledBecause: null,
    ...r,
    caveats,
  });
  // `why` is a fixed phrase, returned to the caller; `detail` (a database's
  // own message) goes to the log only.
  const notFiled = (
    why: string,
    heldAway = 0,
    detail?: string,
  ): RefusedChecksNote => {
    deps.logger.warn(
      `POS_REFUSED_CHECKS_NOTE_NOT_FILED restaurant=${restaurantId} source=${providerKey} ` +
        `refused=${refused.length} — ${why}${inParens(detail)}. The checks stay refused; the import result says so.`,
    );
    return said({ filed: false, heldAway, notFiledBecause: why });
  };

  try {
    if (!deps.notifications) {
      return notFiled("the bell is not wired on this server");
    }

    // F5: this till's note from the last hour takes these refusals.
    const added = await addToOpenNote(
      deps,
      { restaurantId, providerKey, groupKey, refused, now },
      caveats,
    );
    if (added !== null) {
      deps.logger.log(
        `POS_REFUSED_CHECKS_NOTE_ADDED restaurant=${restaurantId} source=${providerKey} ` +
          `refused=${refused.length} total=${added.total} atLeast=${added.atLeast} grew=${added.grew} rows=${added.rows}`,
      );
      return said({
        filed: true,
        addedToOpenNote: true,
        recipients: added.rows,
      });
    }

    const { data, error } = await deps.client
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (error) {
      return notFiled(
        "this house's owners and managers could not be read",
        0,
        error.message,
      );
    }
    const audience = [
      ...new Set(
        ((data ?? []) as Array<{ user_id?: unknown; role?: unknown }>)
          .filter((r) => isOwnerOrManager(r?.role))
          .map((r) => r?.user_id)
          .filter((id): id is string => typeof id === "string" && id !== ""),
      ),
    ];
    if (audience.length === 0) {
      return notFiled("this house has no active owner or manager to tell");
    }

    // ADR 0218: the funnel's own ladder, over the owners and managers only.
    const route = deps.areaRouting
      ? await deps.areaRouting.route(restaurantId, audience, null, now)
      : null;
    const inboxOnly = route?.step === "owners_inbox_only";
    const to = route ? (inboxOnly ? route.inboxOnly : route.alert) : audience;
    const heldAway = route?.heldAway ?? 0;
    if (to.length === 0) {
      return notFiled("no owner or manager could be addressed", heldAway);
    }

    // Who is pushed. Every owner and manager Away: nobody (ADR 0218's last
    // step). Otherwise everyone whose own push switch is on ("Respect their
    // switch") and who is outside their quiet hours (F6).
    const split = inboxOnly
      ? {
          push: [] as string[],
          quiet: [] as string[],
          switchedOff: [] as string[],
        }
      : await splitByPushSettings(deps, restaurantId, to, now, caveats);
    // `without` names the count a group's rows go to when they carry no push.
    const groups = inboxOnly
      ? [{ ids: to, push: false, without: null }]
      : [
          { ids: split.push, push: true, without: null },
          { ids: split.quiet, push: false, without: "quietHours" as const },
          {
            ids: split.switchedOff,
            push: false,
            without: "pushSwitchedOff" as const,
          },
        ];

    const state = freshState(refused);
    const words = noteWords(providerKey, state);
    const noteId = randomUUID();
    let recipients = 0;
    const withoutPush = { quietHours: 0, pushSwitchedOff: 0 };
    for (const group of groups) {
      if (group.ids.length === 0) continue;
      const { inserted } = await deps.notifications.persistForRestaurant(
        restaurantId,
        {
          type: REFUSED_CHECKS_NOTE_TYPE,
          title: words.title,
          message: words.message,
          // A row with no push is "low", which keeps the funnel from pushing
          // to a phone, and `broadcast: false` keeps it from the live ping.
          priority: group.push ? "high" : "low",
          actionUrl: "/connections",
          actionLabel: "Open Connections",
          groupKey,
          // The same metadata on every row of the note, every group alike:
          // `noteId` is how a later import finds them all (F5).
          metadata: {
            source: providerKey,
            till: tillName(providerKey),
            noteId,
            ...stateMetadata(state),
            reason: "date_not_readable",
            awayStep: route?.step ?? null,
            heldAway,
          },
        },
        {
          onlyUserIds: group.ids,
          broadcast: group.push,
          // The push's data carries the note's id and count, never the till's
          // text (the ids and the value it sent); its body is the message.
          pushData: { noteId, refused: state.refused },
        },
      );
      recipients += inserted;
      if (group.without) withoutPush[group.without] += inserted;
    }
    if (recipients === 0) {
      return notFiled(
        "the bell write wrote no rows (the notification funnel logs why)",
        heldAway,
      );
    }
    deps.logger.log(
      `POS_REFUSED_CHECKS_NOTE_FILED restaurant=${restaurantId} source=${providerKey} ` +
        `refused=${refused.length} recipients=${recipients} heldAway=${heldAway} ` +
        `quietHours=${withoutPush.quietHours} pushSwitchedOff=${withoutPush.pushSwitchedOff}`,
    );
    return said({ filed: true, recipients, heldAway, ...withoutPush });
  } catch (e: unknown) {
    return notFiled("the bell write failed", 0, reasonOf(e));
  }
}

/**
 * F5: count these refusals into this till's note from the last hour. Returns
 * the rows updated, the note's count and whether it grew, or null when there
 * is no open note or it could not be read or updated; in the last two cases a
 * caveat says so and the caller writes a new note, so the refusals are never
 * dropped.
 *
 * Every row of the note is read and updated whatever its status in
 * `NOTE_STATUSES`, so an archived row returns to unread with the new count
 * (the founder: "Bring it back (Recommended)"). Both updates are
 * compare-and-sets on the title, which carries the count: a row is changed
 * only while it still holds a count this import read, and every such count
 * ranks lower than the one written (`noteRank`), so an older count never
 * lands over a newer one.
 *
 * When this import adds no check the note had not counted ("Count each check
 * once (Recommended)"), the note did not grow: its lead rows are left as they
 * are (no new count, so not news: no row turns unread or comes back from the
 * archive), and only rows behind it are brought up to it.
 *
 * A note whose every row was deleted from the bell is no open note: the read
 * finds nothing, so the caller writes a new one (see the header; the
 * founder: "New note at once (Recommended)").
 */
async function addToOpenNote(
  deps: Deps,
  a: {
    restaurantId: string;
    providerKey: string;
    groupKey: string;
    refused: ReadonlyArray<RefusedCheck>;
    now: Date;
  },
  caveats: string[],
): Promise<{
  rows: number;
  total: number;
  atLeast: boolean;
  grew: boolean;
} | null> {
  // `caveat` is a fixed phrase, returned to the caller; `detail` (a
  // database's own message) goes to the log only.
  const fellBack = (caveat: string, detail?: string) => {
    deps.logger.warn(
      `POS_REFUSED_CHECKS_NOTE_FELL_BACK restaurant=${a.restaurantId} source=${a.providerKey} — ` +
        `${caveat}${inParens(detail)}.`,
    );
    caveats.push(caveat);
  };
  const since = new Date(
    a.now.getTime() - OPEN_NOTE_WINDOW_MINUTES * 60_000,
  ).toISOString();
  for (let attempt = 1; attempt <= OPEN_NOTE_TRIES; attempt++) {
    const { data, error } = await deps.client
      .from("notifications")
      .select("id, title, metadata")
      .eq("restaurant_id", a.restaurantId)
      .eq("type", REFUSED_CHECKS_NOTE_TYPE)
      .eq("group_key", a.groupKey)
      .in("status", NOTE_STATUSES)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(OPEN_NOTE_READ_LIMIT);
    if (error) {
      fellBack(
        "this till's open note could not be read, so a new note was written",
        error.message,
      );
      return null;
    }
    const rows = (data ?? []) as Array<{
      id?: unknown;
      title?: unknown;
      metadata?: any;
    }>;
    if (rows.length === 0) return null;

    // The newest note's rows, and the one of them that ranks highest.
    const noteId = rows[0]?.metadata?.noteId;
    let lead: { title: string; metadata: any; state: NoteState } | null = null;
    for (const r of rows) {
      if (typeof noteId !== "string" || r?.metadata?.noteId !== noteId)
        continue;
      const state = readState(r.metadata);
      if (
        state &&
        typeof r.title === "string" &&
        (!lead || noteRank(state) > noteRank(lead.state))
      ) {
        lead = { title: r.title, metadata: r.metadata, state };
      }
    }
    if (!lead) {
      fellBack(
        "this till's open note could not be read (it carries no note id, count or check list), so a new note was written",
      );
      return null;
    }
    const leadTitle = lead.title;
    const ids = rows
      .filter(
        (r) =>
          r?.metadata?.noteId === noteId &&
          r.title === leadTitle &&
          typeof r.id === "string",
      )
      .map((r) => r.id as string);

    const grown = addToState(lead.state, a.refused);
    // "Count each check once": an import that adds no check the note had
    // not counted leaves it as it was, so `next` is the note as read.
    const grew = noteRank(grown) > noteRank(lead.state);
    const next = grew ? grown : lead.state;
    const words = noteWords(a.providerKey, next);
    const patch = {
      title: words.title,
      message: words.message,
      // A note that grew is news again: back to unread, with no push, an
      // archived row too ("Bring it back").
      status: "unread",
      read_at: null,
      archived_at: null,
      metadata: {
        ...lead.metadata,
        ...stateMetadata(next),
        ...(grew ? { lastAddedAt: a.now.toISOString() } : {}),
      },
    };
    let n = 0;
    if (grew) {
      const { data: updated, error: updateError } = await deps.client
        .from("notifications")
        .update(patch)
        .in("id", ids)
        // Only rows still saying what was read: another process that counted
        // into this note first has changed the title, and this matches nothing.
        .eq("title", leadTitle)
        .in("status", NOTE_STATUSES)
        .select("id");
      if (updateError) {
        fellBack(
          "this till's open note could not be updated, so a new note was written",
          updateError.message,
        );
        return null;
      }
      n = ((updated ?? []) as unknown[]).length;
      if (n === 0) continue;
    }

    // Rows of this note that hold an older count: another process counted
    // into the note while it was still writing them. They are brought up to
    // the note's count too, whether or not this import grew it, so every
    // recipient's row says the same, but only rows whose count was read and
    // ranks lower, and only while they still hold it: a row another process
    // has since moved on is left.
    const older = rows.filter((r) => {
      if (
        r?.metadata?.noteId !== noteId ||
        typeof r.id !== "string" ||
        typeof r.title !== "string" ||
        r.title === leadTitle
      )
        return false;
      const state = readState(r.metadata);
      return state !== null && noteRank(state) < noteRank(next);
    });
    const behind = older.map((r) => r.id as string);
    const behindTitles = [...new Set(older.map((r) => r.title as string))];
    let caught = 0;
    if (behind.length > 0) {
      const { data: behindRows, error: behindError } = await deps.client
        .from("notifications")
        .update(patch)
        .in("id", behind)
        .in("title", behindTitles)
        .in("status", NOTE_STATUSES)
        .select("id");
      if (behindError) {
        fellBack(
          `${behind.length} row${behind.length === 1 ? "" : "s"} of this till's open note kept an older count`,
          behindError.message,
        );
      } else {
        caught = ((behindRows ?? []) as unknown[]).length;
      }
    }
    return {
      rows: n + caught,
      total: next.refused,
      atLeast: next.atLeast,
      grew,
    };
  }
  fellBack(
    "this till's open note changed while it was being counted into, so a new note was written",
  );
  return null;
}

/**
 * Who is pushed, judged once per recipient from one preferences read. Never
 * throws.
 * - A person whose own push switch is off gets the row only, with no push and
 *   no live ping, whatever their quiet hours and whether the house's zone
 *   reads (the founder: "Respect their switch (Recommended)"). Only a literal
 *   `push === false` is off: `getPreferences` gives `true` for a person with
 *   no row and `push_enabled ?? true` for a row (`mapPreferencesRow`), and
 *   `channelAllowed` (`team/broadcast-preferences.ts`) reads a switch the
 *   same way, so a field that is not there pushes.
 * - Otherwise a person inside their quiet window, on the house's clock, gets
 *   the row only (F6), and everyone else is pushed.
 * - Preferences that cannot be read push that person, as before quiet hours
 *   were read (the founder: "Push anyway (Recommended)"); a house zone that
 *   cannot be read or is not known leaves quiet hours unjudged, so everyone
 *   whose switch is on is pushed. A caveat says which.
 */
async function splitByPushSettings(
  deps: Deps,
  restaurantId: string,
  ids: string[],
  now: Date,
  caveats: string[],
): Promise<{ push: string[]; quiet: string[]; switchedOff: string[] }> {
  // `why` is a fixed phrase, returned to the caller; `detail` (a
  // database's own message) goes to the log only.
  const zoneUnread = (why: string, detail?: string): null => {
    deps.logger.warn(
      `POS_REFUSED_CHECKS_NOTE_QUIET_HOURS_UNREAD restaurant=${restaurantId} — ${why}${inParens(detail)}. ` +
        "Quiet hours are not judged: everyone whose push switch is on is pushed, as before quiet hours were read.",
    );
    caveats.push(`${why}, so every recipient whose push is on was pushed`);
    return null;
  };

  let houseZone: string | null;
  try {
    const { data, error } = await deps.client
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      houseZone = zoneUnread(
        "the house's time zone could not be read",
        error.message,
      );
    } else {
      const zone = houseFrame(data ?? null).zone;
      houseZone = zone
        ? zone
        : zoneUnread("the house has no time zone on record");
    }
  } catch (e: unknown) {
    houseZone = zoneUnread(
      "the house's time zone could not be read",
      reasonOf(e),
    );
  }

  const read = await Promise.all(
    ids.map(async (id) => {
      try {
        const prefs = await deps.notifications!.getPreferences(
          id,
          restaurantId,
        );
        return { id, prefs: prefs ?? null, failed: null as string | null };
      } catch (e: unknown) {
        return { id, prefs: null, failed: reasonOf(e) };
      }
    }),
  );
  const push: string[] = [];
  const quiet: string[] = [];
  const switchedOff: string[] = [];
  const unread: string[] = [];
  for (const r of read) {
    if (r.failed !== null || !r.prefs) {
      unread.push(r.id);
      push.push(r.id);
      continue;
    }
    if (r.prefs.push === false) {
      switchedOff.push(r.id);
      continue;
    }
    const q = r.prefs.quietHours;
    if (!q) {
      unread.push(r.id);
      push.push(r.id);
      continue;
    }
    const inside =
      houseZone !== null &&
      isWithinQuietHours(now, houseZone, {
        enabled: q.enabled === true,
        start: String(q.startTime ?? ""),
        end: String(q.endTime ?? ""),
      });
    (inside ? quiet : push).push(r.id);
  }
  if (unread.length > 0) {
    const first =
      read.find((r) => r.failed !== null)?.failed ?? "no preferences returned";
    deps.logger.warn(
      `POS_REFUSED_CHECKS_NOTE_QUIET_HOURS_UNREAD restaurant=${restaurantId} recipients=${unread.length} — ${first}. ` +
        "They are pushed, as before quiet hours were read.",
    );
    caveats.push(
      `the notification settings of ${unread.length} recipient${unread.length === 1 ? "" : "s"} could not be read, so ${unread.length === 1 ? "that person was" : "they were"} pushed`,
    );
  }
  return { push, quiet, switchedOff };
}
