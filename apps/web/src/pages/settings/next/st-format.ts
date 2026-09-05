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
 * THIS ARRAY IS THE ID SET, NOT THE READING ORDER (changed 2026-09-03). The
 * contents column reads in `GROUPS` order below; ids never move, so no `?tab=`
 * link ever breaks, but a fourteen-item flat list with no headings does not
 * read cleanly and the founder asked for a clean tab bar.
 */
export const SECTION_IDS = [
  'team', 'services', 'email', 'notifications', 'locations',
  'measurement', 'map', 'features', 'pos', 'calendar', 'cellar',
  'vendor-terms', 'thresholds', 'ledger',
  // Appended, never inserted, for the same reason `cellar` was: an id's
  // position is not its identity, but a bookmark is, and `?tab=` is the id.
  'currency',
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
];

/**
 * The contents column, grouped by what a person came here to do.
 *
 * Fourteen numbered rows in one flat list is a list you scan rather than read.
 * Linear's settings redesign groups its own into "Account · Features ·
 * Administration · Your teams" — personal settings, workspace-level feature
 * configuration, admin-only workspace governance, and per-team settings
 * (https://linear.app/changelog/2024-12-18-personalized-sidebar), and the
 * standard advice that follows is to cluster by USER INTENT rather than by
 * internal structure. Stripe's 2023 Dashboard navigation went the same way,
 * adding grouped sections plus pinned and recently-visited shortcuts
 * (https://support.stripe.com/questions/dashboard-update-may-2024).
 *
 * So the grouping here is by intent, NOT by where the value is kept — which is
 * the internal fact, and is still printed under every open register's heading
 * by `KEPT_NOTE`. The one place storage does surface in the contents column is
 * the "Yours" group's own subtitle, because "this is not shared with the house"
 * is something a person needs before they open the register, not after.
 */
export interface SectionGroup {
  id: GroupId;
  title: string;
  /** One line under the group heading. Kept short — it is a signpost. */
  hint: string;
  members: SectionId[];
}

/**
 * The five headings, and nothing else.
 *
 * A heading is a label, not a row: which registers live under it is derived
 * from each `SectionSpec`'s own `group` and `order` below, so there is exactly
 * one place a register's position is declared and the two cannot drift.
 */
const GROUP_HEADINGS: Array<{ id: GroupId; title: string; hint: string }> = [
  {
    id: 'house',
    title: 'The house',
    hint: 'Who works here, where here is, and how it signs its name.',
  },
  {
    id: 'buying',
    title: 'How it buys',
    hint: 'The terms it trades on and who may commit to them.',
  },
  {
    id: 'autonomy',
    title: 'What it does on its own',
    hint: 'The switches that let the system act without being asked.',
  },
  {
    id: 'yours',
    title: 'Yours',
    hint: 'Kept on your account or in this browser. Nobody else here sees these.',
  },
  {
    id: 'record',
    title: 'The record',
    hint: 'What was changed, by whom.',
  },
];

export const GROUPS: SectionGroup[] = GROUP_HEADINGS.map((g) => ({
  ...g,
  members: SECTIONS.filter((s) => s.group === g.id)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id),
}));

/**
 * Reading order, flattened. Derived from `GROUPS` so the numbers in the
 * contents column and the "Register N of M" line cannot drift apart.
 */
export const READING_ORDER: SectionId[] = GROUPS.flatMap((g) => g.members);

/** 1-based position in the contents column. */
export function readingIndex(id: SectionId): number {
  return READING_ORDER.indexOf(id) + 1;
}

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

export function groupsFor(connectionsOn: boolean): SectionGroup[] {
  if (!connectionsOn) return GROUPS;
  return GROUPS.map((g) => ({
    ...g,
    members: g.members.filter((id) => !isCollapsedSection(id)),
  })).filter((g) => g.members.length > 0);
}

export function readingOrderFor(connectionsOn: boolean): SectionId[] {
  return groupsFor(connectionsOn).flatMap((g) => g.members);
}

export function readingIndexFor(connectionsOn: boolean, id: SectionId): number {
  return readingOrderFor(connectionsOn).indexOf(id) + 1;
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
