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
 * means quiet (Recommended)".
 *
 * WHAT IT DOES
 * ------------
 * - ONE NOTE PER TILL PER HOUR (F5). `PosHubService.ingest()` calls this once
 *   per import, after its loop, and only when something was refused. When this
 *   house's note for this till (group key `pos_import_refused:<till>`) was
 *   first written less than `OPEN_NOTE_WINDOW_MINUTES` ago, the refusals are
 *   COUNTED INTO IT: every recipient's row of that note, archived ones too
 *   ("Bring it back"), gets the new count, title and words, the named ids stay
 *   at most `MAX_NOTE_CHECK_IDS` in total, and the row returns to unread. No
 *   row is written and nothing is pushed. Otherwise a new note is written. A
 *   file import is one call, so it is still one note.
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
 *   zone cannot be read or is not known, or one person's preferences cannot
 *   be read, those people are pushed, as before quiet hours were read; it is
 *   logged and said in `caveats`.
 * - The note names at most `MAX_NOTE_CHECK_IDS` check ids and counts the
 *   rest, each id cut at `MAX_NOTE_ID_CHARS`. It carries the till's name, the
 *   count, and the first unreadable value the till sent, cut at 40
 *   characters. Nothing else from the payload, and no secret. The phone
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
 * writes a new note rather than drop its refusals. A note's pushed and quiet
 * rows are written by two calls, so an update from another process can land
 * between them; the rows written second then hold the older count until the
 * next update brings them up, and only rows still holding a count it read,
 * lower than the one it writes, so an older count never lands over a newer one.
 *
 * NEVER THROWS
 * ------------
 * A note that could not be filed must not fail or undo the import: the checks
 * were refused whatever happens here. Every path returns a `RefusedChecksNote`
 * that the import result carries as `bellNote`, so "not filed" is said, with
 * its reason, rather than read as "told" (ADR 0067's "a failed read is never
 * an empty one", in spirit). The reason is a fixed phrase; a database's own
 * message goes to the log only. A webhook caller is told `filed` and nothing
 * else (`bellNoteForTill`).
 *
 * NO EMOJI: `notification-text-is-plain.spec.ts` scans every gateway file that
 * names a notification funnel, and this one does.
 */
import { randomUUID } from "crypto";
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
   * (F5): rows updated, none written, nothing pushed.
   */
  addedToOpenNote: boolean;
  /** How many bells were written to, or updated. */
  recipients: number;
  /** Owners and managers set aside because they are Away today (ADR 0218). */
  heldAway: number;
  /** Recipients inside their quiet hours: the row, without a push (F6). */
  quietHours: number;
  /**
   * Why it was not filed, as a fixed phrase (a database's own message is
   * logged, never returned). Null when it was.
   */
  notFiledBecause: string | null;
  /**
   * What fell back, as fixed phrases: an open note that could not be read or
   * updated (a new note was written), quiet hours that could not be read
   * (those people were pushed). Empty when nothing fell back.
   */
  caveats: string[];
}

/**
 * What a webhook caller is told about the note: whether it was filed, and
 * nothing about who hears it, who is Away or quiet, or why it was not filed.
 * A webhook secret need not be the house's own (the legacy one signs the body
 * alone), so its holder learns no more than that.
 */
export type RefusedChecksNoteForTill = Pick<RefusedChecksNote, "filed">;

/** `bellNote` as the webhook route returns it; null when no note was due. */
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
  /** Checks refused into this note, over every import counted into it. */
  refused: number;
  /** The ids named, at most `MAX_NOTE_CHECK_IDS`, in the order refused. */
  checkIds: string[];
  /** The first unreadable value the till sent, as quoted. */
  firstSent: string;
  /** How many imports were counted into this note. */
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

/** One import's refusals, as a new note holds them. */
export function freshState(refused: ReadonlyArray<RefusedCheck>): NoteState {
  return {
    refused: refused.length,
    checkIds: refused
      .slice(0, MAX_NOTE_CHECK_IDS)
      .map((c) => sayCheckId(c.externalCheckId)),
    firstSent: refused.length > 0 ? sayValue(refused[0].closedAt) : "",
    imports: 1,
  };
}

/**
 * F5: a later import's refusals counted into an open note. The count adds up;
 * the named ids stay at most `MAX_NOTE_CHECK_IDS` in total, the earliest kept.
 * Every refusal counts, so a check the till sends again and is refused again
 * is counted, and named, again.
 */
export function addToState(
  prev: NoteState,
  refused: ReadonlyArray<RefusedCheck>,
): NoteState {
  const room = Math.max(0, MAX_NOTE_CHECK_IDS - prev.checkIds.length);
  return {
    refused: prev.refused + refused.length,
    checkIds: [
      ...prev.checkIds,
      ...refused.slice(0, room).map((c) => sayCheckId(c.externalCheckId)),
    ].slice(0, MAX_NOTE_CHECK_IDS),
    firstSent: prev.firstSent,
    imports: prev.imports + 1,
  };
}

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
  return {
    refused,
    checkIds: (Array.isArray(m.checkIds) ? m.checkIds : [])
      .filter((x): x is string => typeof x === "string")
      .slice(0, MAX_NOTE_CHECK_IDS),
    firstSent: typeof m.firstSent === "string" ? m.firstSent : "",
    imports,
  };
}

/** The metadata fields a note's state is kept in. */
function stateMetadata(s: NoteState): Record<string, unknown> {
  return {
    refused: s.refused,
    checkIds: s.checkIds,
    checkIdsNotNamed: Math.max(0, s.refused - s.checkIds.length),
    firstSent: s.firstSent,
    imports: s.imports,
  };
}

/**
 * The note's words for a state. Pure. The title is the founder's own example
 * ("3 checks not imported: date not readable"); no internal field name
 * appears in it.
 */
export function noteWords(
  providerKey: string,
  s: NoteState,
): { title: string; message: string; notNamed: number } {
  const n = s.refused;
  const one = n === 1;
  const notNamed = Math.max(0, n - s.checkIds.length);
  const title = `${n} check${one ? "" : "s"} not imported: date not readable`;
  const sent = s.firstSent
    ? ` (${one ? "it was" : "the first was"} written as ${s.firstSent})`
    : "";
  const message =
    `${n} check${one ? "" : "s"} from ${tillName(providerKey)} ` +
    `${one ? "was" : "were"} not imported because ${one ? "its" : "their"} closing time could not be read` +
    `${sent}. ` +
    `${one ? "Its sale and its stock are" : "Their sales and stock are"} not recorded. ` +
    `${one ? "Check" : "Checks"}: ${s.checkIds.join(", ")}${notNamed > 0 ? `, and ${notNamed} more` : ""}. ` +
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
          `refused=${refused.length} total=${added.total} rows=${added.rows}`,
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
    // step). Otherwise everyone outside their quiet hours (F6).
    const split = inboxOnly
      ? { push: [] as string[], quiet: [] as string[] }
      : await splitByQuietHours(deps, restaurantId, to, now, caveats);
    const groups = inboxOnly
      ? [{ ids: to, push: false }]
      : [
          { ids: split.push, push: true },
          { ids: split.quiet, push: false },
        ];

    const state = freshState(refused);
    const words = noteWords(providerKey, state);
    const noteId = randomUUID();
    let recipients = 0;
    let quietHours = 0;
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
          // The same metadata on every row of the note, both groups alike:
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
      if (!group.push && !inboxOnly) quietHours += inserted;
    }
    if (recipients === 0) {
      return notFiled(
        "the bell write wrote no rows (the notification funnel logs why)",
        heldAway,
      );
    }
    deps.logger.log(
      `POS_REFUSED_CHECKS_NOTE_FILED restaurant=${restaurantId} source=${providerKey} ` +
        `refused=${refused.length} recipients=${recipients} heldAway=${heldAway} quietHours=${quietHours}`,
    );
    return said({ filed: true, recipients, heldAway, quietHours });
  } catch (e: unknown) {
    return notFiled("the bell write failed", 0, reasonOf(e));
  }
}

/**
 * F5: count these refusals into this till's note from the last hour. Returns
 * the rows updated and the new total, or null when there is no open note or
 * it could not be read or updated; in the last two cases a caveat says so and
 * the caller writes a new note, so the refusals are never dropped.
 *
 * Every row of the note is read and updated whatever its status in
 * `NOTE_STATUSES`, so an archived row returns to unread with the new count
 * (the founder: "Bring it back (Recommended)"). Both updates are
 * compare-and-sets on the title, which carries the count: a row is changed
 * only while it still holds a count this import read, and every such count is
 * lower than the one written, so an older count never lands over a newer one.
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
): Promise<{ rows: number; total: number } | null> {
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

    // The newest note's rows, and the one of them with the highest count.
    const noteId = rows[0]?.metadata?.noteId;
    let lead: { title: string; metadata: any; state: NoteState } | null = null;
    for (const r of rows) {
      if (typeof noteId !== "string" || r?.metadata?.noteId !== noteId)
        continue;
      const state = readState(r.metadata);
      if (
        state &&
        typeof r.title === "string" &&
        (!lead || state.refused > lead.state.refused)
      ) {
        lead = { title: r.title, metadata: r.metadata, state };
      }
    }
    if (!lead) {
      fellBack(
        "this till's open note could not be read (it carries no note id or count), so a new note was written",
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

    const next = addToState(lead.state, a.refused);
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
        lastAddedAt: a.now.toISOString(),
      },
    };
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
    const n = ((updated ?? []) as unknown[]).length;
    if (n === 0) continue;

    // Rows of this note that hold an older count: another process counted
    // into the note while it was still writing them. They are brought up to
    // the new count too, so every recipient's row says the same, but only
    // rows whose count was read and is lower than the new one, and only while
    // they still hold it: a row another process has since moved on is left.
    const older = rows.filter((r) => {
      if (
        r?.metadata?.noteId !== noteId ||
        typeof r.id !== "string" ||
        typeof r.title !== "string" ||
        r.title === leadTitle
      )
        return false;
      const state = readState(r.metadata);
      return state !== null && state.refused < next.refused;
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
    return { rows: n + caught, total: next.refused };
  }
  fellBack(
    "this till's open note changed while it was being counted into, so a new note was written",
  );
  return null;
}

/**
 * F6: split the recipients by their quiet hours, on the house's clock. Never
 * throws; anyone whose quiet hours cannot be judged is pushed, as before
 * quiet hours were read, and a caveat says why.
 */
async function splitByQuietHours(
  deps: Deps,
  restaurantId: string,
  ids: string[],
  now: Date,
  caveats: string[],
): Promise<{ push: string[]; quiet: string[] }> {
  // `why` is a fixed phrase, returned to the caller; `detail` (a
  // database's own message) goes to the log only.
  const pushAll = (why: string, detail?: string) => {
    deps.logger.warn(
      `POS_REFUSED_CHECKS_NOTE_QUIET_HOURS_UNREAD restaurant=${restaurantId} — ${why}${inParens(detail)}. ` +
        "Every recipient is pushed, as before quiet hours were read.",
    );
    caveats.push(`${why}, so every recipient was pushed`);
    return { push: ids, quiet: [] as string[] };
  };

  let zone: string | null;
  try {
    const { data, error } = await deps.client
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      return pushAll("the house's time zone could not be read", error.message);
    }
    zone = houseFrame(data ?? null).zone;
  } catch (e: unknown) {
    return pushAll("the house's time zone could not be read", reasonOf(e));
  }
  if (!zone) {
    return pushAll("the house has no time zone on record");
  }
  const houseZone = zone;

  const read = await Promise.all(
    ids.map(async (id) => {
      try {
        const prefs = await deps.notifications!.getPreferences(
          id,
          restaurantId,
        );
        return {
          id,
          quiet: prefs?.quietHours ?? null,
          failed: null as string | null,
        };
      } catch (e: unknown) {
        return { id, quiet: null, failed: reasonOf(e) };
      }
    }),
  );
  const push: string[] = [];
  const quiet: string[] = [];
  const unread: string[] = [];
  for (const r of read) {
    if (r.failed !== null || !r.quiet) {
      unread.push(r.id);
      push.push(r.id);
      continue;
    }
    const inside = isWithinQuietHours(now, houseZone, {
      enabled: r.quiet.enabled === true,
      start: String(r.quiet.startTime ?? ""),
      end: String(r.quiet.endTime ?? ""),
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
      `the quiet hours of ${unread.length} recipient${unread.length === 1 ? "" : "s"} could not be read, so ${unread.length === 1 ? "that person was" : "they were"} pushed`,
    );
  }
  return { push, quiet };
}
