/**
 * RecommendationsNext formatting + the page's three filing axes.
 *
 * House honesty rule: an unknown is an em dash, never a zero and never a
 * guess. Nothing in this file invents a figure — the two mappings below
 * (category → stake, rule → hand) are CLASSIFICATIONS of a rule that already
 * fired, not measurements, and both keep an explicit "unfiled" branch so an
 * unrecognised category is visible rather than silently binned.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

/**
 * Fraunces — the house serif, injected once (copied from the dashboard's
 * fonts.ts on purpose: pages do not import each other's helpers). Georgia
 * carries the text until the webfont lands, so this can never break the page.
 */
const FONT_LINK_ID = 'mudavym-fraunces';
export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/** A finite number or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/* ── Axis 1: the stake — what the entry would change ─────────────────────── */

export type StakeId = 'money' | 'stock' | 'vendors' | 'floor' | 'unfiled';

/** Register order — the book's sections, top to bottom. */
export const STAKE_ORDER: StakeId[] = ['money', 'stock', 'vendors', 'floor', 'unfiled'];

export const STAKE_LABEL: Record<StakeId, string> = {
  money: 'Money',
  stock: 'Stock',
  vendors: 'Vendors',
  floor: 'The floor',
  unfiled: 'Unfiled',
};

/** The register's own gloss — what "acting on this" would actually move. */
export const STAKE_BLURB: Record<StakeId, string> = {
  money: 'money taken across the pass',
  stock: 'bottles at risk on the shelf',
  vendors: 'what you pay and who you pay it to',
  floor: 'how the shift is run',
  unfiled: 'a rule category this page has no register for',
};

/**
 * Category → stake. The eight categories the rule engine emits
 * (`analytics/recommendations.service.ts`: sales · inventory · efficiency ·
 * risk · purchasing · staff · basket · goals) filed by consequence. Anything
 * else lands in `unfiled` ON PURPOSE: a new rule category must show up as
 * unfiled rather than be absorbed into a register it was never sorted into.
 */
const CATEGORY_STAKE: Record<string, StakeId> = {
  sales: 'money',
  basket: 'money',
  goals: 'money',
  inventory: 'stock',
  purchasing: 'vendors',
  risk: 'vendors',
  staff: 'floor',
  efficiency: 'floor',
};

export function stakeOf(category: string | null | undefined): StakeId {
  if (!category) return 'unfiled';
  return CATEGORY_STAKE[category] ?? 'unfiled';
}

/* ── Axis 2: urgency — the engine's own word, said plainly ───────────────── */

export type Urgency = 'now' | 'this_week' | 'this_month';

export const URGENCY_LABEL: Record<string, string> = {
  now: 'Tonight',
  this_week: 'This week',
  this_month: 'This month',
};

export const URGENCY_RANK: Record<string, number> = {
  now: 0,
  this_week: 1,
  this_month: 2,
};

export function urgencyLabel(u: string | null | undefined): string {
  if (!u) return EM;
  return URGENCY_LABEL[u] ?? u;
}

/* ── Axis 3: the hand — who does it, and where the work lands ────────────── */

export interface Hand {
  /** Deep link the manager follows to do the work. */
  href: string;
  /** The verb on the control. */
  label: string;
  /** The surface the work lands on — the second half of "your hand, in …". */
  where: string;
}

/**
 * Where "Act" takes you, with the rule carried along so the target page can
 * pick it up (`?rec=…&from=recommendations`). Copied from the legacy page's
 * `actTarget` — this is real routing knowledge, not a new claim.
 */
export function handOf(ruleKey: string, category: string): Hand {
  const q = `rec=${encodeURIComponent(ruleKey)}&from=recommendations`;
  const byRule: Record<string, Hand> = {
    stockout_imminent: { href: `/orders?${q}&draft=1`, label: 'Draft the PO', where: 'Orders' },
    dead_stock_capital: { href: `/promotions?${q}`, label: 'Create the promo', where: 'Promotions' },
    plowhorse_repricing: { href: `/reports?${q}`, label: 'Open the menu report', where: 'Reports' },
    puzzle_activation: { href: `/promotions?${q}`, label: 'Feature by-the-glass', where: 'Promotions' },
    vendor_concentration: { href: `/providers?${q}`, label: 'Compare vendors', where: 'Providers' },
    revenue_concentration: { href: `/inventory?${q}`, label: 'Protect top sellers', where: 'Inventory' },
    spend_acceleration: { href: `/orders?${q}`, label: 'Audit open orders', where: 'Orders' },
    pairing_promotion: { href: `/promotions?${q}`, label: 'Promote the pairing', where: 'Promotions' },
    staff_spread: { href: `/team?${q}`, label: 'Open the roster', where: 'Team' },
  };
  const hit = byRule[ruleKey];
  if (hit) return hit;
  if (ruleKey.startsWith('goal_behind'))
    return { href: `/reports?${q}`, label: 'Open the goal', where: 'Reports' };
  const byCategory: Record<string, Hand> = {
    inventory: { href: `/inventory?${q}`, label: 'Open Inventory', where: 'Inventory' },
    purchasing: { href: `/orders?${q}`, label: 'Open Orders', where: 'Orders' },
    risk: { href: `/orders?${q}`, label: 'Review the risk', where: 'Orders' },
    sales: { href: `/reports?${q}`, label: 'Open Reports', where: 'Reports' },
    efficiency: { href: `/reports?${q}`, label: 'Open Reports', where: 'Reports' },
    staff: { href: `/team?${q}`, label: 'Open the roster', where: 'Team' },
    basket: { href: `/promotions?${q}`, label: 'Open Promotions', where: 'Promotions' },
    goals: { href: `/reports?${q}`, label: 'Open Goals', where: 'Reports' },
  };
  return byCategory[category] ?? { href: `/reports?${q}`, label: 'Open Reports', where: 'Reports' };
}

/* ── Time, said only where it is known ───────────────────────────────────── */

function daysBetween(a: number, b: number): number {
  return Math.floor((a - b) / 86_400_000);
}

/**
 * How long an entry has stood, from the disposition store's `updatedAt`.
 * `null` — which is every entry the book has never been touched on — is the
 * em dash, because the feed records no first-fired timestamp (page note §13).
 */
export function fmtStanding(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const d = daysBetween(Date.now(), t);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  if (d < 30) return `${d} days`;
  const m = Math.floor(d / 30);
  return m === 1 ? '1 month' : `${m} months`;
}

/**
 * When a snoozed entry comes back. Real: it is the stored `snoozeUntil`.
 * Rounded UP, unlike `fmtStanding`: "snooze until next week" stores exactly
 * seven days from now, and flooring the remainder would greet the operator
 * with "wakes in 6 days" one millisecond after they set it.
 */
export function fmtWakes(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const now = Date.now();
  if (t <= now) return 'due back';
  const d = Math.ceil((t - now) / 86_400_000);
  if (d <= 0) return 'wakes today';
  if (d === 1) return 'wakes tomorrow';
  return `wakes in ${d} days`;
}

/** Clock time of the read, so the head says WHEN these numbers were true. */
export function fmtReadAt(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return EM;
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Zero-padded entry number for the gutter — a position, not a figure. */
export function entryNo(i: number): string {
  return String(i + 1).padStart(2, '0');
}

/* ── The shape of a failure ──────────────────────────────────────────────── */

/**
 * "Your session expired", "you are not allowed", and "the server broke" are
 * three different facts; the legacy page rendered all three as
 * `Request failed (401)`. Axios carries the status on `response.status`.
 */
export interface FailureVM {
  status: number | null;
  message: string;
  /** 401 — the token is gone or stale. Signing in again fixes it. */
  expired: boolean;
  /** 403 — understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

export function failureOf(err: unknown): FailureVM {
  const status =
    num((err as { response?: { status?: unknown } } | null)?.response?.status) ?? null;
  const body = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data;
  const message =
    (typeof body?.message === 'string' && body.message) ||
    (err as { message?: string } | null)?.message ||
    'the request failed';
  return { status, message, expired: status === 401, forbidden: status === 403 };
}

/** The sentence the page shows for a failure — never an empty list. */
export function failureSentence(f: FailureVM, register: string): string {
  if (f.expired)
    return `Your session has expired — sign in again and ${register} will read. Nothing below is claimed.`;
  if (f.forbidden)
    return `This account is not allowed to read ${register} (403). Nothing below is claimed.`;
  return `${register} could not be read (${f.message}). Nothing below is claimed — this is not an empty book.`;
}
