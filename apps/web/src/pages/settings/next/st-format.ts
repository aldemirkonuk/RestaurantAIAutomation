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

export const EM = '—';

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
 * (`pages/Settings.tsx:66`). `cellar` is added at the end rather than inserted,
 * for the same reason.
 */
export const SECTION_IDS = [
  'team', 'services', 'email', 'notifications', 'locations',
  'measurement', 'map', 'features', 'pos', 'calendar', 'cellar',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

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
}

export const SECTIONS: SectionSpec[] = [
  { id: 'team', label: 'Team', title: 'Team', kind: 'restaurant',
    description: 'Who can reach this restaurant, and what each of them may change.' },
  { id: 'services', label: 'Services', title: 'Services & permissions', kind: 'account',
    description: 'What the product is allowed to do with your data, and which apps you have connected.' },
  { id: 'email', label: 'Email', title: 'Email sign-off', kind: 'restaurant',
    description: 'The name every vendor email is signed with.' },
  { id: 'notifications', label: 'Notifications', title: 'Notifications', kind: 'account',
    description: 'Which alerts leave the building, and through which door.' },
  { id: 'locations', label: 'Locations', title: 'Locations & chains', kind: 'restaurant',
    description: 'The branches on this account and how they group.' },
  { id: 'measurement', label: 'Measurement', title: 'Measurement & recipes', kind: 'browser',
    description: 'Units, the default glass pour, and whether recipes are tracked.' },
  { id: 'map', label: 'Map', title: 'Map', kind: 'account',
    description: 'How wide Find distributors frames you when it opens.' },
  { id: 'features', label: 'Features', title: 'Features', kind: 'restaurant',
    description: 'The switches that change what the system does on its own.' },
  { id: 'pos', label: 'POS', title: 'Point of sale', kind: 'restaurant',
    description: 'The till connection and what it has actually sent.' },
  { id: 'calendar', label: 'Calendar', title: 'Calendar subscription', kind: 'restaurant',
    description: 'The feed another calendar can read.' },
  { id: 'cellar', label: 'Cellar', title: 'Cellar registers', kind: 'restaurant',
    description: 'Which drinks registers this house actually carries.' },
];

export function isSectionId(v: string | null): v is SectionId {
  return v !== null && (SECTION_IDS as readonly string[]).includes(v);
}

export function sectionSpec(id: SectionId): SectionSpec {
  // SECTIONS is generated from SECTION_IDS' own members, so this cannot miss.
  return SECTIONS.find((s) => s.id === id) as SectionSpec;
}

/** "Seven kept for this restaurant, three on your account, one in this browser." */
export function keptTally(): string {
  const n = (k: Kept) => SECTIONS.filter((s) => s.kind === k).length;
  const word = (v: number) =>
    ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'][v] ?? String(v);
  return `${word(n('restaurant'))} kept for this restaurant, ${word(n('account'))} on your account, ${word(n('browser'))} in this browser only`;
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

/** Relative "last written" for a provenance line. EM when there is no date. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Absolute date, for a `title=` on the relative one. */
export function fmtExact(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleString() : undefined;
}

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
