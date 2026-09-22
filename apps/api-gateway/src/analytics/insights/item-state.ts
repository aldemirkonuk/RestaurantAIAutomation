/**
 * One shared per-item state — what every surface reads (ADR 0191, founder
 * answers of 2026-09-21).
 *
 * The founder, verbatim: "Build it right, in order" — the engine gets ONE
 * shared per-item state (dismissed with a reason / snoozed-until / done) that
 * the feed, the catalogue, reports and the rails all read.
 *
 * Before this file, "hidden" meant three different things in three places:
 *
 *   - the insight generator (Reports, the rails, the catalogue's live items,
 *     the mobile tab) honoured `dismissed` rows only, at every scope;
 *   - the recommendations feed honoured `dismissed` at every scope, but
 *     `snoozed` and `done` only on the bare rule key;
 *   - the stored-insight read (`getStored`) honoured nothing written after
 *     the last hourly persist, and the legacy rails filtered client-side on a
 *     key shape (`insight:<candidate>:<entity>`) nothing server-side writes.
 *
 * So a snooze from the feed held on the feed and nowhere else, and a
 * dismissal from a rail held on that rail and nowhere else. This is the one
 * definition. It is pure: the rows come in, the state of one item comes out,
 * and every reader calls the same function with the same rows.
 *
 * The state, in precedence order (the first that holds wins):
 *
 *   dismissed  a standing instruction, with a labelled reason (the signal)
 *   done       completed — hidden, and carries NO negative signal: a done row
 *              never holds a dismissal reason (`recommendation-actions.
 *              service.ts` clears it on write)
 *   snoozed    hidden until `snoozeUntil`, then it returns by itself. A snooze
 *              with no instant, or with one that has passed, is not a snooze:
 *              the item is back.
 *   active     none of the above
 *
 * Every state is honoured at every scope a key can carry (`suppressingKeysFor`
 * — this finding, this subject, this rule), because the state belongs to the
 * key that was written, and the key names how wide it reaches.
 */

import {
  ANY,
  SuppressionTarget,
  insightRuleId,
  parseSuppressionKey,
  suppressingKeysFor,
} from "./suppression";

/**
 * The dismissal reasons — a closed set of labels, not free text.
 *
 * The founder: "the reason is a labelled signal". A label a person did not
 * choose is not a signal, and a free-text string is not a label, so a
 * dismissal is refused without one of these (the gateway, every surface).
 *
 * Two, since round 3 (founder, 2026-09-21). The dismiss lists offered four —
 * the feed's and the legacy page's vocabulary — and two of them never meant
 * "stop showing this to the house":
 *
 *   - "Already handled" is recorded as DONE, not as a dismissal (answer 3):
 *     completion, no negative signal. `DONE_LABEL`.
 *   - "Not now" becomes the person's own snooze (answer 4, "Only them"): it
 *     hides the card from the one person who pressed it. `NOT_NOW_LABEL`.
 *
 * Both labels are still accepted at the door, from every client, and turned
 * into the act they mean by `planAct` — so the legacy page and an older
 * client record the right thing instead of a 400.
 */
export const DISMISS_REASONS = ["not_relevant", "disagree"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export function isDismissReason(value: unknown): value is DismissReason {
  return (
    typeof value === "string" &&
    (DISMISS_REASONS as readonly string[]).includes(value)
  );
}

/** The dismiss-list label that is recorded as done (round 3, answer 3). */
export const DONE_LABEL = "already_handled";
/** The dismiss-list label that is the person's own snooze (round 3, answer 4). */
export const NOT_NOW_LABEL = "not_now";

/**
 * How long "Not now" hides a card from the person who pressed it, when the
 * request names no instant (the legacy page, the keyboard shortcut, an older
 * client). One day: the shortest snooze the product already offers ("Until
 * tomorrow", `SNOOZE_CHOICES`). The founder has not named a length; this is
 * the build's reading, put to him in ADR 0191 round 3.
 */
export const NOT_NOW_DEFAULT_MS = 86_400_000;

/** Who a snooze is for: the person alone, or the whole house. */
export type SnoozeFor = "me" | "house";

export type ItemState = "active" | "dismissed" | "snoozed" | "done";

/** The fields of one `recommendation_actions` row the state is read from. */
export interface StateRow {
  ruleKey: string;
  status: string;
  reason: string | null;
  snoozeUntil: string | null;
}

/** Every hiding row, by the state it holds. Built once per read. */
export interface StateBook {
  dismissed: Map<string, StateRow>;
  done: Map<string, StateRow>;
  /** Only snoozes whose instant is still in the future. */
  snoozed: Map<string, StateRow>;
}

export interface ResolvedState {
  state: ItemState;
  /** The stored key that decided it, or null when the item is active. */
  key: string | null;
  /** The dismissal label, only when `state === 'dismissed'`. */
  reason: string | null;
  /** When the item returns, only when `state === 'snoozed'`. */
  snoozeUntil: string | null;
}

const ACTIVE: ResolvedState = {
  state: "active",
  key: null,
  reason: null,
  snoozeUntil: null,
};

/** A snooze is in force only with an instant that has not passed. */
export function snoozeHolds(
  snoozeUntil: string | null | undefined,
  now: number,
): boolean {
  if (!snoozeUntil) return false;
  const at = new Date(snoozeUntil).getTime();
  return Number.isFinite(at) && at > now;
}

export function stateBookFrom(
  rows: Iterable<StateRow>,
  now: number = Date.now(),
): StateBook {
  const book: StateBook = {
    dismissed: new Map(),
    done: new Map(),
    snoozed: new Map(),
  };
  for (const r of rows) {
    if (r.status === "dismissed") book.dismissed.set(r.ruleKey, r);
    else if (r.status === "done") book.done.set(r.ruleKey, r);
    else if (r.status === "snoozed" && snoozeHolds(r.snoozeUntil, now))
      book.snoozed.set(r.ruleKey, r);
  }
  return book;
}

/**
 * The state of one item. Keys are tried widest first (`suppressingKeysFor`
 * lists the bare rule key first), so the key reported is the widest one in
 * force — the one that has to be lifted for the item to come back.
 */
export function resolveItemState(
  target: SuppressionTarget,
  book: StateBook,
): ResolvedState {
  const keys = suppressingKeysFor(target);
  for (const k of keys) {
    const row = book.dismissed.get(k);
    if (row)
      return {
        state: "dismissed",
        key: k,
        reason: row.reason ?? null,
        snoozeUntil: null,
      };
  }
  for (const k of keys) {
    if (book.done.has(k))
      return { state: "done", key: k, reason: null, snoozeUntil: null };
  }
  for (const k of keys) {
    const row = book.snoozed.get(k);
    if (row)
      return {
        state: "snoozed",
        key: k,
        reason: null,
        snoozeUntil: row.snoozeUntil,
      };
  }
  return ACTIVE;
}

/**
 * Whether a stored key silences a WHOLE rule (or a whole catalogue type):
 * no subject and no period. `rule` and `rule#*#*` are the same instruction.
 *
 * Deliberately not `parseSuppressionKey(key).scope === 'rule'` alone: a key
 * with a period and no subject (`rule#*#p7:2026-09-02`) silences one period,
 * not the rule, and gating it as rule-wide would take a one-finding dismiss
 * away from staff.
 */
export function isRuleWideKey(key: string): boolean {
  const p = parseSuppressionKey(key);
  return p.subject === ANY && p.grain === ANY;
}

/**
 * Whether a status write is a rule-wide dismiss or restore — the founder's
 * owner/manager-only, audited act (2026-09-21, answer 1).
 *
 * A dismiss: `dismissed` written at a rule-wide key. A restore: any status
 * written over a rule-wide key that is currently dismissed (back to active,
 * or to snoozed/done, both of which lift the standing instruction). Pin,
 * feedback, assignment and acted-on never are; a snooze or done over a
 * rule-wide key that is NOT dismissed is not a dismiss or a restore.
 */
export function isRuleWideDismissOrRestore(
  key: string,
  nextStatus: string | undefined,
  currentStatus: string | null | undefined,
): boolean {
  if (nextStatus === undefined) return false;
  if (!isRuleWideKey(key)) return false;
  return nextStatus === "dismissed" || currentStatus === "dismissed";
}

/**
 * The roles that act FOR the house on its cards — owners and managers, and
 * nobody else (ADR 0191 round 4, answer 7, 2026-09-21: the platform `admin`
 * role never acts for a house's cards unless that person is also an owner or
 * manager of that house).
 *
 * `admin` is deliberately NOT here, although `RolesGuard` lets it through
 * every `@Roles("owner", "manager")` route. The role is the one the token's
 * house gives (`JwtStrategy.validate` → `roleInHouse`, ADR 0162): an access
 * row in the house decides, and its role is `owner`, `manager` or `staff`
 * (the CHECK of migration 20260902200000), so an owner or manager of the
 * house reads `owner` or `manager`. `admin` reaches this code only from a
 * `users` row — one with no access row in the house whose `restaurant_id`
 * names it, or a token that names no house. The areas lane's
 * `mayActForEveryone` (`areas/area-routing.ts`, ADR 0218) draws the same
 * line: owner and manager act for everyone, `admin` does not.
 */
export function mayActForTheHouse(role: string | null | undefined): boolean {
  const r = role ? String(role).toLowerCase() : "";
  return r === "owner" || r === "manager";
}

/**
 * The platform role, when the token reads it for this house — a person with
 * no owner, manager or staff role here (round 4, answer 7).
 */
export function isPlatformAdminRole(role: string | null | undefined): boolean {
  return (role ? String(role).toLowerCase() : "") === "admin";
}

/** The roles that may make a rule-wide act: owners and managers (round 4 dropped `admin`). */
export function mayActRuleWide(role: string | null | undefined): boolean {
  return mayActForTheHouse(role);
}

/**
 * Who may snooze a card for EVERYONE (round 3, answer 4). The founder: a
 * staff snooze is "Only them"; snooze for everyone is owners and managers —
 * and area leads inside their own area, once the areas lane lands.
 *
 * The area half is a typed hook, not a feature: nothing builds areas here,
 * `actorOf` never fills `leadsAreas` and no card carries an area yet
 * (`RecommendationActionsService.cardAreasOf` returns none), so today this
 * is exactly owner/manager — not the platform `admin` (round 4, answer 7).
 * When the areas lane fills both, a lead may snooze for everyone a card in
 * an area they lead, and nothing else.
 */
export function maySnoozeForEveryone(
  role: string | null | undefined,
  leadsAreas: ReadonlyArray<string> = [],
  cardAreas: ReadonlyArray<string> = [],
): boolean {
  if (mayActRuleWide(role)) return true;
  return leadsAreas.some((a) => cardAreas.includes(a));
}

/** The shape of a state write, as it reaches the one write path. */
export interface StateWriteIn {
  status?: string;
  reason?: string | null;
  snoozeUntil?: string | null;
  snoozeFor?: string | null;
}

/** What one write is recorded as — said back to the client. */
export type RecordedAs =
  | "dismissed"
  | "done"
  | "snoozed_for_everyone"
  | "snoozed_for_you"
  | "restored"
  | "note";

/**
 * Where one write goes (round 3). `house` is the shared state every surface
 * reads, with the status, reason and instant it will actually hold;
 * `personal` is the person's own snooze, which hides the card from them
 * alone and is never written to the house state or its history; `refused`
 * is a request that is not written, said in words — `forbidden` when the
 * actor may not make it (403), otherwise malformed (400).
 */
export type ActRoute =
  | {
      to: "house";
      status: string | undefined;
      reason: string | null | undefined;
      snoozeUntil: string | null | undefined;
      recordedAs: RecordedAs;
    }
  | { to: "personal"; snoozeUntil: string; recordedAs: "snoozed_for_you" }
  | { to: "refused"; why: string; forbidden: boolean };

/**
 * Route one state write — the founder's round-3 answers, in one pure place:
 *
 *   - a dismissal labelled "Already handled" is recorded as DONE (answer 3);
 *   - a dismissal labelled "Not now" is the person's own snooze (answer 4),
 *     until the instant sent, or `NOT_NOW_DEFAULT_MS` when none is;
 *   - a snooze `snoozeFor: 'me'` is personal, for anyone;
 *   - a snooze `snoozeFor: 'house'` needs `maySnoozeForEveryone` — refused
 *     otherwise, never quietly narrowed, because the person asked for more
 *     than they got;
 *   - a snooze that names no audience is for everyone from an owner or a
 *     manager (what their snooze has always done) and personal from anyone
 *     else ("Only them" — a staff snooze hides the card from them alone).
 *
 * Everything else goes to the house state unchanged. Validation of what is
 * left (a label from DISMISS_REASONS, an instant in the future) stays with
 * the write path, which runs it on the routed result.
 *
 * Round 4, answer 7: the platform `admin` role never acts for a house's
 * cards — a dismiss, done, restore or snooze for everyone that would land
 * on the house state is refused (403). Their own snooze hides a card from
 * them alone and acts for nobody else, so it stays; so do notes (pin,
 * rating, assignment), which round 3 already said are not acts.
 */
export function planAct(
  patch: StateWriteIn,
  actor: { role: string | null; leadsAreas?: ReadonlyArray<string> },
  cardAreas: ReadonlyArray<string>,
  now: number,
): ActRoute {
  const route = routeOf(patch, actor, cardAreas, now);
  if (
    route.to === "house" &&
    route.status !== undefined &&
    isPlatformAdminRole(actor.role)
  )
    return { to: "refused", why: PLATFORM_ADMIN_REFUSAL, forbidden: true };
  return route;
}

/** Why a platform admin's house act is refused (round 4, answer 7). */
export const PLATFORM_ADMIN_REFUSAL =
  "A platform admin acts on a house's cards only as an owner or manager of that house.";

function routeOf(
  patch: StateWriteIn,
  actor: { role: string | null; leadsAreas?: ReadonlyArray<string> },
  cardAreas: ReadonlyArray<string>,
  now: number,
): ActRoute {
  const house = (
    status: string | undefined,
    reason: string | null | undefined,
    snoozeUntil: string | null | undefined,
    recordedAs: RecordedAs,
  ): ActRoute => ({ to: "house", status, reason, snoozeUntil, recordedAs });

  if (
    patch.snoozeFor !== undefined &&
    patch.snoozeFor !== null &&
    patch.snoozeFor !== "me" &&
    patch.snoozeFor !== "house"
  )
    return {
      to: "refused",
      why: "snoozeFor is 'me' or 'house'",
      forbidden: false,
    };

  if (patch.status === "dismissed" && patch.reason === DONE_LABEL)
    return house("done", null, null, "done");

  if (patch.status === "dismissed" && patch.reason === NOT_NOW_LABEL)
    return {
      to: "personal",
      snoozeUntil: snoozeHolds(patch.snoozeUntil, now)
        ? (patch.snoozeUntil as string)
        : new Date(now + NOT_NOW_DEFAULT_MS).toISOString(),
      recordedAs: "snoozed_for_you",
    };

  if (patch.status === "snoozed") {
    const forEveryone = maySnoozeForEveryone(
      actor.role,
      actor.leadsAreas ?? [],
      cardAreas,
    );
    if (patch.snoozeFor === "house" && !forEveryone)
      return {
        to: "refused",
        why: "Only an owner or manager can snooze this for everyone. Snooze it for yourself instead.",
        forbidden: true,
      };
    if (patch.snoozeFor === "me" || !forEveryone) {
      if (!snoozeHolds(patch.snoozeUntil, now))
        return {
          to: "refused",
          why: "A snooze needs a snoozeUntil instant in the future",
          forbidden: false,
        };
      return {
        to: "personal",
        snoozeUntil: patch.snoozeUntil as string,
        recordedAs: "snoozed_for_you",
      };
    }
    return house(
      "snoozed",
      patch.reason,
      patch.snoozeUntil,
      "snoozed_for_everyone",
    );
  }

  if (patch.status === "dismissed")
    return house("dismissed", patch.reason, patch.snoozeUntil, "dismissed");
  if (patch.status === "done")
    return house("done", patch.reason, patch.snoozeUntil, "done");
  if (patch.status === "active")
    return house("active", patch.reason, patch.snoozeUntil, "restored");
  return house(patch.status, patch.reason, patch.snoozeUntil, "note");
}

/**
 * The act a house state write is, in the append-only history (round 3,
 * answer 2, "Keep every label"): the founder's four words — dismiss,
 * restore, done, snooze. A write back to `active` lifts whatever held the
 * card, so it is a restore; the history's `status_from` says what it lifted.
 */
export type HistoryAct = "dismiss" | "restore" | "done" | "snooze";

export function historyActOf(status: string): HistoryAct | null {
  if (status === "dismissed") return "dismiss";
  if (status === "active") return "restore";
  if (status === "done") return "done";
  if (status === "snoozed") return "snooze";
  return null;
}

// ---- Undoing someone's act (round 4, answer 5) -------------------------------

/** What a `recommendation_actions` row holds now, as the undo gate reads it. */
export interface HeldRow {
  status: string;
  snoozeUntil: string | null;
}

/**
 * Whether the row holds somebody's act — a dismissal, a done, or a house
 * snooze still in force. A status write over such a row undoes (or replaces)
 * that act. An active row, a snooze whose instant has passed and a key with
 * no row hold nothing: writing over them undoes nobody.
 */
export function holdsAnAct(row: HeldRow | null | undefined, now: number): boolean {
  if (!row) return false;
  if (row.status === "dismissed" || row.status === "done") return true;
  return row.status === "snoozed" && snoozeHolds(row.snoozeUntil, now);
}

/** The newest history row for a key, as the undo gate reads it. */
export interface LatestAct {
  actorId: string | null;
  statusTo: string;
}

/**
 * Who made the act a row holds, or null when that is not known.
 *
 * The append-only history is the record of who did what (round 3, "Keep
 * every label"); its newest row for the key names the person — but only
 * when it wrote the very status the row holds now. Otherwise the act that
 * set the row was never kept (written before the history existed, or its
 * history row missed), and the newest row is someone else's older act. A
 * name the retention rule removed, or a deleted person, is null too.
 */
export function authorOf(
  row: HeldRow,
  latest: LatestAct | null | undefined,
): string | null {
  if (!latest || latest.statusTo !== row.status) return null;
  return latest.actorId ?? null;
}

/**
 * Round 4, answer 5 (the founder, 2026-09-21): staff undo only their own
 * acts; owners and managers undo anyone's. An act nobody can name — no
 * history row, a history row for another act, a name removed after two
 * years — is not provably the person's own, so only an owner or manager
 * undoes it.
 */
export function mayUndo(
  actor: { userId: string | null; role: string | null },
  madeBy: string | null,
): boolean {
  if (mayActForTheHouse(actor.role)) return true;
  return !!actor.userId && madeBy !== null && madeBy === actor.userId;
}

/** What a refused undo says — the one refusal, in words, per case. */
export function undoRefusal(unknownAuthor: boolean, n: number): string {
  if (n > 1)
    return `Only an owner or manager can undo someone else's act (${n} in this selection).`;
  return unknownAuthor
    ? "It is not recorded who did this, so only an owner or manager can undo it."
    : "Only the person who did this, or an owner or manager, can undo it.";
}

/** One person's own snoozes — `recommendation_personal_snoozes` rows. */
export interface PersonalRow {
  ruleKey: string;
  snoozeUntil: string | null;
}

/** A person's snoozes still in force, by key. Built once per read. */
export type PersonalBook = Map<string, PersonalRow>;

export function personalBookFrom(
  rows: Iterable<PersonalRow>,
  now: number = Date.now(),
): PersonalBook {
  const book: PersonalBook = new Map();
  for (const r of rows)
    if (snoozeHolds(r.snoozeUntil, now)) book.set(r.ruleKey, r);
  return book;
}

/**
 * The person's own snooze holding this item, or null. At every scope its key
 * can carry, like the house state — a personal snooze is written at the
 * card's own key, but honouring the wider ones costs nothing and keeps one
 * matching rule.
 */
export function personalSnoozeOf(
  target: SuppressionTarget,
  book: PersonalBook,
): PersonalRow | null {
  if (book.size === 0) return null;
  for (const k of suppressingKeysFor(target)) {
    const row = book.get(k);
    if (row) return row;
  }
  return null;
}

/**
 * The step that runs only where a named person is looking (their feed,
 * their catalogue, their rails): drop what they snoozed for themselves and
 * count it. The house state and every reader without a person — the digest,
 * the MCP reader, the stored cache — never see it (ADR 0191 round 3).
 */
export function personalView<T>(
  items: T[],
  targetOf: (item: T) => SuppressionTarget,
  book: PersonalBook,
): { kept: T[]; hiddenForYou: number } {
  if (book.size === 0) return { kept: items, hiddenForYou: 0 };
  const kept: T[] = [];
  let hiddenForYou = 0;
  for (const item of items) {
    if (personalSnoozeOf(targetOf(item), book)) hiddenForYou++;
    else kept.push(item);
  }
  return { kept, hiddenForYou };
}

/**
 * The item an insight row is, live (`candidateKey`, `periodKey`) or stored
 * (`candidate_key`, `period_key`) — the same target the generator resolves
 * the house state with.
 */
export function insightRowTarget(row: unknown): SuppressionTarget {
  const r = (row ?? {}) as Record<string, unknown>;
  const candidate =
    typeof r.candidateKey === "string"
      ? r.candidateKey
      : typeof r.candidate_key === "string"
        ? r.candidate_key
        : "";
  const period =
    typeof r.periodKey === "string"
      ? r.periodKey
      : typeof r.period_key === "string"
        ? r.period_key
        : null;
  return {
    ruleId: insightRuleId(candidate),
    subject: typeof r.subject === "string" && r.subject ? r.subject : null,
    periodKey: period || null,
  };
}
