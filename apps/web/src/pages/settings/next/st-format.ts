/**
 * SettingsNext — the page's vocabulary and its formatting.
 *
 * The vocabulary is the page's one structural idea: every setting on /settings
 * is a RECORD, and a record has a place it is kept and a date it was last
 * written. `Kept` names the place; `fmtWhen` names the date, or an em dash when
 * no date exists (ADR 0020 — an unknown is never a zero and never a confident
 * "just now").
 *
 * WHAT THE SECOND PASS CHANGED HERE (2026-09-03)
 * ---------------------------------------------
 * The first pass wrote four em dashes whose stated reason was false: the date
 * existed and was being dropped between the database and this page. An em dash
 * is only honest when the absence is real, so the reason attached to one is now
 * treated as a claim that has to survive being checked — three of the four were
 * repaired at the source (gateway + hook), and the fourth was re-worded to name
 * the layer that actually drops it. `PROVENANCE_UNKNOWN` below is the register
 * of the ones that remain, each with the file that proves it.
 */

import { getErrorMessage } from '@/services/api/client';

/**
 * The half of this file that /providers also speaks now lives in
 * `lib/mudavym/format.ts` (hoisted 2026-09-04). It is re-exported here rather
 * than left as a second import for every caller: this page had thirty-odd
 * `st-format` imports and none of them was wrong, so the move is a change of
 * WHERE the shared words live, not of who may say them.
 *
 * `EM` is re-exported because half of this file's own sentences use it.
 */
export {
  EM,
  SOURCE_LABEL,
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
  fmtCutoff,
  fmtExact,
  fmtMoney,
  fmtWeekdays,
  fmtWhen,
  type TermSource,
} from '@/lib/mudavym/format';
import { EM } from '@/lib/mudavym/format';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/* ── Where a setting is kept ─────────────────────────────────────────────── */

export type Kept = 'restaurant' | 'account' | 'browser';

export const KEPT_LABEL: Record<Kept, string> = {
  restaurant: 'this restaurant',
  account: 'your account',
  browser: 'this browser',
};

export const KEPT_NOTE: Record<Kept, string> = {
  restaurant: 'Kept on the restaurant. Everyone who works here gets the same answer.',
  account: 'Kept on your account. It follows you to another browser and to the phone.',
  browser:
    'Kept in this browser only. Nobody else sees it, it does not reach the phone, and clearing site data forgets it.',
};

/**
 * Every reason this page is allowed to print beside an em dash, in one place.
 *
 * Each one names a file that was read, so the claim is checkable rather than
 * atmospheric — and keeping them together is what stops a fifth one being
 * invented in passing, which is how the first pass produced four false ones.
 */
export const PROVENANCE_UNKNOWN = {
  /** `restaurant_feature_flags` has `created_at` and no update column. */
  featureFlags: 'the settings row has no changed-at column',
  /** `user_restaurant_access` has created_at / valid_from and no update column. */
  memberChange: 'no column records a later change to this access',
  /** localStorage keeps a value, never a history. */
  browser: 'this browser keeps the value, not a history of it',
  /** The token is a column on the restaurant row; that row's date is not its own. */
  icalToken:
    'the token has no date of its own — it is a column on the restaurant row, whose date moves for any change to the branch',
  /** A regeneration is not recorded anywhere. */
  icalRegen: 'no table records a regeneration',
  /** A test send writes no row. */
  testSend: 'a test send is not recorded',
  /** The preference row has never been written for this account. */
  neverWritten: 'this record has never been written',
  /** An integration that is simply not connected. */
  notConnected: 'not connected',
} as const;

/* ── The registers, in the order the page reads them ─────────────────────── */

/**
 * The first ten are the legacy `?tab=` set, in the legacy order, so every
 * bookmark and every link in the product still lands where it did
 * (`pages/Settings.tsx:66`). `cellar` was added at the end rather than
 * inserted, for the same reason, and the fourth pass's three follow it.
 *
 * THIS ARRAY IS THE ID SET, NOT THE READING ORDER (changed 2026-09-03, and
 * true in a new way since sketch 109A, 2026-09-17: the page is no longer
 * tab-panels swapped by this order at all — it is one continuous interview in
 * `INTERVIEW_GROUPS`' fixed I–VII order below. `SECTION_IDS` survives as the
 * bookmark surface: `TAB_TO_ANCHOR` maps every one of these ids to the
 * interview anchor it now scrolls to, so no existing `?tab=` link breaks).
 * `group`/`order` below are the OLD five-group taxonomy (`GroupId`) this
 * spec was built under; kept on `SectionSpec` only because `keptTally` and a
 * couple of internal callers still read `kind`, not because anything renders
 * five groups any more — the visible grouping is `INTERVIEW_GROUPS`.
 */
export const SECTION_IDS = [
  'team', 'services', 'email', 'notifications', 'locations',
  'measurement', 'map', 'features', 'pos', 'calendar', 'cellar',
  'vendor-terms', 'thresholds', 'ledger',
  // Appended, never inserted, for the same reason `cellar` was: an id's
  // position is not its identity, but a bookmark is, and `?tab=` is the id.
  'currency',
  'carrying-cost',
  // 'hours', 'digest', and 'ask-training' render outside `SECTIONS`/
  // `group.members` — each is a special-cased block in `SettingsNext.tsx`
  // keyed on `group.id`, with its own real `st-section-<id>` DOM id — so they
  // were never added to SECTIONS even though that DOM id is exactly what the
  // deep-link effect looks up. They do NOT belong in `SECTIONS` — only here
  // and in `TAB_TO_ANCHOR`.
  'hours',
  'digest',
  'ask-training',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type GroupId = 'house' | 'buying' | 'autonomy' | 'yours' | 'record';

export interface SectionSpec {
  id: SectionId;
  /** Index label — the short one, matching the legacy `?tab=` nav. */
  label: string;
  /** Heading when the register is open. */
  title: string;
  /** What changes here, in one line. */
  description: string;
  /** Where this register's settings are kept. */
  kind: Kept;
  /** Which heading it reads under in the contents column. */
  group: GroupId;
  /** Position within that group. */
  order: number;
}

export const SECTIONS: SectionSpec[] = [
  { id: 'team', label: 'Team', title: 'Team', kind: 'restaurant', group: 'house', order: 1,
    description: 'Who can reach this restaurant, and what each of them may change.' },
  { id: 'services', label: 'Services', title: 'Services & permissions', kind: 'account', group: 'yours', order: 1,
    description: 'What the product is allowed to do with your data, and which apps you have connected.' },
  { id: 'email', label: 'Email', title: 'Email sign-off', kind: 'restaurant', group: 'house', order: 3,
    description: 'The name every vendor email is signed with.' },
  { id: 'notifications', label: 'Notifications', title: 'Notifications', kind: 'account', group: 'autonomy', order: 2,
    description: 'Which alerts leave the building, and through which door.' },
  { id: 'locations', label: 'Locations', title: 'Locations & chains', kind: 'restaurant', group: 'house', order: 2,
    description: 'The branches on this account and how they group.' },
  { id: 'measurement', label: 'Measurement', title: 'Measurement & recipes', kind: 'browser', group: 'yours', order: 3,
    description: 'Units, the default glass pour, and whether recipes are tracked.' },
  { id: 'map', label: 'Map', title: 'Map', kind: 'account', group: 'yours', order: 2,
    description: 'How wide Find distributors frames you when it opens.' },
  { id: 'features', label: 'Features', title: 'Features', kind: 'restaurant', group: 'autonomy', order: 1,
    description: 'The switches that change what the system does on its own.' },
  { id: 'pos', label: 'POS', title: 'Point of sale', kind: 'restaurant', group: 'buying', order: 3,
    description: 'The till connection and what it has actually sent.' },
  { id: 'calendar', label: 'Calendar', title: 'Calendar subscription', kind: 'restaurant', group: 'house', order: 4,
    description: 'The feed another calendar can read.' },
  { id: 'cellar', label: 'Cellar', title: 'Cellar registers', kind: 'restaurant', group: 'buying', order: 4,
    description: 'Which drinks registers this house actually carries.' },
  { id: 'vendor-terms', label: 'Vendor terms', title: 'Vendor terms', kind: 'restaurant', group: 'buying', order: 1,
    description: 'When each vendor closes for the day, which days they deliver, and what they will not go below.' },
  { id: 'thresholds', label: 'Approval thresholds', title: 'Approval thresholds', kind: 'restaurant', group: 'buying', order: 2,
    description: 'Who may seal an order, above what amount, and in which circumstances a second signature is wanted.' },
  { id: 'ledger', label: 'What changed here', title: 'What changed here', kind: 'restaurant', group: 'record', order: 1,
    description: 'Every setting change on this restaurant, who made it, and what it was before.' },
  // Its own register rather than a line inside Locations, because it is not a
  // fact about a branch: it decides what every money figure in the product
  // MEANS. Eleven of the fourteen production houses hold NULL here as of
  // 2026-09-05 and print "currency not recorded" everywhere (ADR 0117 Q25), and
  // until this register there was no control anywhere that could change it.
  { id: 'currency', label: 'Currency', title: 'Reporting currency', kind: 'restaurant', group: 'house', order: 5,
    description: 'The money this house states its own totals in. Nothing is ever converted.' },
  // Its own register for the same reason the currency has one: it is a fact
  // about the HOUSE that decides whether a money figure may be printed at all.
  // The founder, 2026-09-05 batch 59, answering the commodity plan's Q5: "Twice
  // a year, and the house types its carrying cost." Measured over 440 recorded
  // FAO months, the whole gain from buying ahead on a commodity alert is spent
  // by a carrying cost of about one percent a month, and nothing in this
  // product had ever asked a house for that number.
  { id: 'carrying-cost', label: 'Carrying cost', title: 'What holding stock costs', kind: 'restaurant', group: 'house', order: 6,
    description: 'What a month of holding stock costs this house, as a percent of its value. Until it is stated, no alert here prints a saving.' },
  // The house's consent for its /ask questions (ADR 0145, founder 2026-09-21,
  // "Same as the wine pool (Recommended)": an owner opt-out per house). Under
  // The house because it is the house's answer, given by its owner.
];

/* ── Sketch 109A — the interview, organised by certainty ──────────────────
 *
 * The founder's locked pick (ADR 0160, 2026-09-17): "A, the interview, with
 * two grafts" — C's *read by* line under every answer, and B's day sheet as
 * the hours editor. Direction A replaces the old five intent groups (house /
 * buying / autonomy / yours / record, above — kept only because `SectionSpec`
 * still carries `group`/`order` for `KEPT_NOTE` and a few internal callers)
 * with SEVEN groups in the sketch's fixed interview order (I–VII), all shown
 * on one continuously scrolling page rather than one register at a time. A
 * heading is a label; which register renders under it is decided in
 * `SettingsNext.tsx`, not derived here — the mapping is not 1:1 with the old
 * five groups (features/notifications split across "What it may do on its
 * own" and "Yours"; services/pos/email/calendar collapse to one pointer row
 * when `/connections` is live, per the existing COLLAPSED_SECTIONS rule).
 */
export type InterviewGroupId = 'house' | 'carries' | 'buys' | 'own' | 'who' | 'yours' | 'record';

export interface InterviewGroupSpec {
  id: InterviewGroupId;
  /** I–VII, as the sketch prints it. */
  roman: string;
  title: string;
  hint: string;
  /** Anchor id, matching `direction-a.html`'s own (`a-house`, `a-carries`, …). */
  anchor: string;
}

/**
 * Text only — `roman` and `anchor` are both mechanical functions of `id` and
 * position (see `INTERVIEW_GROUPS` below), not independent facts, so a
 * literal here never asserts a value the source doesn't already carry.
 * `check_no_seeded_defaults.py` rule S1 reads a module-level array of
 * `id`-bearing objects with a third key outside its descriptor vocabulary as
 * a table of rows; `roman`/`anchor` are exactly that kind of derived key, so
 * they are computed, not hand-carried per entry.
 */
const INTERVIEW_GROUP_TEXT: ReadonlyArray<Pick<InterviewGroupSpec, 'id' | 'title' | 'hint'>> = [
  { id: 'house', title: 'The house',
    hint: 'Kept on the restaurant. Everyone who works here gets the same answer.' },
  { id: 'carries', title: 'What it carries',
    hint: 'Which of the seven drinks registers this house keeps.' },
  { id: 'buys', title: 'How it buys',
    hint: "What each vendor told the house, and what the house's own orders can support." },
  { id: 'own', title: 'What it may do on its own',
    hint: 'The mandates the house has given the system.' },
  { id: 'who', title: 'Who is here',
    hint: 'Who can reach this house, and what each may change.' },
  { id: 'yours', title: 'Yours',
    hint: 'Kept on your account or in this browser. Nobody else here sees these.' },
  { id: 'record', title: 'The record',
    hint: 'A log, not a question — not counted in the tally.' },
];

/** I, II, III, … — the sketch's fixed interview order, from position alone. */
function romanForPosition(position: number): string {
  const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
  return NUMERALS[position] ?? String(position + 1);
}

export const INTERVIEW_GROUPS: InterviewGroupSpec[] = INTERVIEW_GROUP_TEXT.map((g, i) => ({
  ...g,
  roman: romanForPosition(i),
  anchor: `a-${g.id}`,
}));

export function interviewGroup(id: InterviewGroupId): InterviewGroupSpec {
  return INTERVIEW_GROUPS.find((g) => g.id === id) as InterviewGroupSpec;
}

/**
 * Every existing `?tab=` bookmark still has to land somewhere true. The page
 * no longer swaps panels, so a deep link now scrolls to the interview group
 * that carries that register, rather than opening it alone — `st-format.ts`
 * remains the one place a register's position is declared.
 */
export const TAB_TO_ANCHOR: Record<SectionId, string> = {
  team: 'a-who',
  services: 'a-house',
  email: 'a-house',
  notifications: 'a-yours',
  locations: 'a-house',
  measurement: 'a-yours',
  map: 'a-yours',
  features: 'a-own',
  pos: 'a-house',
  calendar: 'a-house',
  cellar: 'a-carries',
  'vendor-terms': 'a-buys',
  thresholds: 'a-buys',
  ledger: 'a-record',
  currency: 'a-house',
  'carrying-cost': 'a-house',
  // Matches where `SettingsNext.tsx` actually mounts each special-cased block:
  // `id="st-section-hours"` / `id="st-section-ask-training"` inside `group.id === 'house'`, `id="st-section-digest"`
  // inside `group.id === 'own'`. Not consulted by the deep-link scroll effect
  // itself (that only needs `isSectionId` + the DOM id), but `Record<SectionId,
  // string>` requires every key once 'hours'/'digest'/'ask-training' join `SectionId`.
  hours: 'a-house',
  digest: 'a-own',
  'ask-training': 'a-house',
};

/* ── THE COLLAPSE (founder, 2026-09-04) ──────────────────────────────────
 *
 * "Move the registers and collapse the four tabs."
 *
 * `services`, `pos`, `email` and `calendar` are all connections, and ADR 0114
 * justified `/connections` on a surface count that FELL. Until this landed the
 * count had RISEN — a new route plus fourteen tabs. So when
 * `mudavym_design_connections` is on, those four leave this page and one line
 * points at the surface that carries them.
 *
 * The ids do NOT leave `SECTION_IDS`. `isSectionId` must keep recognising them
 * so `?tab=pos` can be RECOGNISED and redirected; dropping them from the id set
 * would turn every existing bookmark into an unrecognised parameter that
 * silently opened Team, which is the failure mode this table exists to avoid.
 */
export const COLLAPSED_SECTIONS = ['services', 'pos', 'email', 'calendar'] as const;

export type CollapsedSectionId = (typeof COLLAPSED_SECTIONS)[number];

/**
 * Where each collapsed tab's `?tab=` deep link lands on `/connections`.
 *
 * The anchors are declared in `connections/next/ConnectionsNext.tsx`
 * (`REGISTER_ANCHORS`) and each is an id on the element that draws that
 * register. `services` goes to the personal-grants register, not to Register I:
 * the Services tab was the OAuth catalogue — "which apps YOU have connected" —
 * and Register III is where those are listed.
 */
export const CONNECTIONS_ANCHOR: Record<CollapsedSectionId, string> = {
  services: 'grants',
  pos: 'till',
  email: 'sender',
  calendar: 'feed',
};

export function isCollapsedSection(id: string | null): id is CollapsedSectionId {
  return id !== null && (COLLAPSED_SECTIONS as readonly string[]).includes(id);
}

/** The four are dropped only when `/connections` is actually routed. */
export function sectionsFor(connectionsOn: boolean): SectionSpec[] {
  return connectionsOn
    ? SECTIONS.filter((s) => !isCollapsedSection(s.id))
    : SECTIONS;
}

export function isSectionId(v: string | null): v is SectionId {
  return v !== null && (SECTION_IDS as readonly string[]).includes(v);
}

export function sectionSpec(id: SectionId): SectionSpec {
  // SECTIONS is generated from SECTION_IDS' own members, so this cannot miss.
  return SECTIONS.find((s) => s.id === id) as SectionSpec;
}

const NUMBER_WORDS = [
  'none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
];

/** A count in words, or the digits when the count outruns the vocabulary. */
export function word(v: number): string {
  return NUMBER_WORDS[v] ?? String(v);
}

/**
 * "Ten kept for this restaurant, three on your account, one in this browser."
 *
 * Counts the registers actually on the page, so the collapse changes the
 * sentence rather than leaving a tally that describes four tabs the reader
 * cannot see. A clause is dropped entirely when its count reaches zero — "none
 * on your account" reads as a finding, and the true statement is silence.
 */
export function keptTally(connectionsOn = false): string {
  const live = sectionsFor(connectionsOn);
  const n = (k: Kept) => live.filter((s) => s.kind === k).length;
  const parts: string[] = [];
  if (n('restaurant') > 0) parts.push(`${word(n('restaurant'))} kept for this restaurant`);
  if (n('account') > 0) parts.push(`${word(n('account'))} on your account`);
  if (n('browser') > 0) parts.push(`${word(n('browser'))} in this browser only`);
  return parts.join(', ');
}

/* ── The vendor-terms vocabulary ─────────────────────────────────────────── */

/** "23 of 118" — a share that always shows its denominator. */
export function fmtShare(part: number, whole: number): string {
  if (!Number.isFinite(whole) || whole <= 0) return EM;
  return `${part} of ${whole}`;
}

/* ── Errors ──────────────────────────────────────────────────────────────── */

/** HTTP status of a failed apiClient call, or null when there wasn't one. */
export function httpStatus(e: unknown): number | null {
  const s = (e as { response?: { status?: number } } | null)?.response?.status;
  return typeof s === 'number' ? s : null;
}

export function errText(e: unknown): string {
  return getErrorMessage(e);
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

/** "expires in 5 days" / "expired" — an invite's own clock. */
export function fmtExpiry(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return 'expired';
  if (days === 0) return 'expires today';
  return days === 1 ? 'expires tomorrow' : `expires in ${days} days`;
}

/* ── Flag names ──────────────────────────────────────────────────────────── */

/**
 * A human title for a registry flag key, DERIVED rather than tabulated, so a
 * flag added to `feature-flag-registry.ts` tomorrow gets a readable name here
 * without this page being edited (and without this page inventing a claim
 * about what it does — that copy is only written where it is known).
 */
export function titleFromFlagKey(key: string): string {
  const bare = key.replace(/^mudavym_design_/, '').replace(/^enable_/, '');
  const words = bare.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isRedesignFlag(key: string): boolean {
  return key.startsWith('mudavym_design_');
}
