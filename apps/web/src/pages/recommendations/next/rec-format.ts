/**
 * RecommendationsNext formatting + the page's three filing axes.
 *
 * House honesty rule: an unknown is an em dash, never a zero and never a
 * guess. Nothing in this file invents a figure — the two mappings below
 * (rule, then category → stake; rule, then category → hand) are
 * CLASSIFICATIONS of a rule that already fired, not measurements. Both read
 * a table's own rows only (`ownRow`), so a stored key such as `constructor`
 * or `__proto__` is an unknown, not a value inherited from `Object.prototype`.
 * [2026-10-06: so do `urgencyLabel` below and the page's goal, cutting,
 * day-book, lever and urgency-rank tables. Until then they read a plain
 * `table[key]`, and a stored `__proto__` rule key (through the goal and
 * cutting refusals) or urgency (through `urgencyLabel`) made the page throw
 * at render, though these two mappings already filed it (ADR 0288).]
 * A rule the stake knows neither by name nor by category is filed under
 * Unfiled, visible rather than silently binned, and the stake says which of
 * the two filed it (ADR 0288). A hand the page knows neither by rule nor by
 * category falls back to Reports.
 */

import { roleAllows, roomFor, type ShellRole } from '@/lib/mudavym/rooms';

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

/** Fraunces — self-hosted; `@font-face` lives in `styles/mudavym.css`
 * (decision 0149 row 9). Georgia is the fallback until it loads. */

/**
 * No-op retained so CatalogView's mount effect still compiles after the
 * Google-Fonts loader was retired for the self-hosted face. Safe to delete
 * once every caller stops importing it.
 */
export function ensureFraunces(): void {}

/** A finite number or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * A table's row for `key`, read from the table's OWN rows only. The tables on
 * this page are object literals, so a plain `table[key]` answers a stored key
 * such as `constructor`, `toString`, `valueOf` or `__proto__` with a value
 * inherited from `Object.prototype`: an entry filed nowhere, a refusal React
 * cannot render, a rank that is not a number (ADR 0288). `Object.prototype.hasOwnProperty.call`, because the
 * web build's `lib` is ES2020 and has no `Object.hasOwn`.
 */
export function ownRow<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
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

/**
 * A register's name as it is printed inside a sentence: lower-case ("Why it
 * would change the floor", "1 more filed under stock, vendors and the
 * floor"). The rail and the "Would change" fact print `STAKE_LABEL` as it
 * is; the section headings name an act (`ACT_LABEL`), not a register. The
 * founder, 2026-10-07 (ADR 0288): "Lower-case
 * mid-sentence (Recommended)".
 *
 * `stakeOf` always returns a register, so only a hand-built entry can carry a
 * stake this table does not know; it is printed as its own word, lower-case,
 * the way `urgencyLabel` prints an unknown urgency, rather than throwing.
 */
export function stakeInSentence(stake: StakeId): string {
  return (ownRow(STAKE_LABEL, stake) ?? String(stake)).toLowerCase();
}

/** The register's own gloss — what "acting on this" would actually move. */
export const STAKE_BLURB: Record<StakeId, string> = {
  money: 'money taken across the pass',
  stock: 'bottles at risk on the shelf',
  vendors: 'what you pay and who you pay it to',
  floor: 'how the shift is run',
  unfiled: 'a rule this page has no register for',
};

/** Where an entry is filed in the register, and the sentence it was read from. */
export interface StakeFiling {
  stake: StakeId;
  /** Why it is filed there — the rule's own words, or the category it fell back on. */
  why: string;
  /** Which of the two filed it, or neither. */
  by: 'rule' | 'category' | 'unfiled';
}

/**
 * Rule → stake, for the rules whose category does not say what acting on them
 * would change (ADR 0288).
 *
 * The register's promise is "what acting on an entry would change". The
 * engine's category is a different fact — which family of analysis found the
 * entry — and for four rules the two disagree. The founder ruled on each:
 *
 *  - `plowhorse_repricing` and `puzzle_activation` are `efficiency` in
 *    `recommendations.service.ts`, and the category once filed both under The
 *    floor, so with Money pressed "Price it" left out a price change (AW28).
 *    2026-10-04: "Money / Stock (Recommended)" — the price change under Money,
 *    the bottle moved under Stock.
 *  - `revenue_concentration` is `risk`, which files under Vendors, but it
 *    changes how deep the top sellers' stock runs. 2026-10-04:
 *    "Stock (Recommended)".
 *  - `weekday_gap` is `sales`, which files under Money, but it leads with
 *    putting staff training, deliveries and counts on a named day. 2026-10-04:
 *    "The floor (Recommended)" — filed by its leading clause, as its act is.
 *
 * Each `why` quotes the rule's own `recommendation` sentence, the way
 * `rec-docket.ts` `RULE_ACT` does for acts.
 *
 * The category is NOT changed in the engine: it feeds the goal levers
 * (`rec-daybook.ts`) and the hand's category fallback (`handOf`, below).
 */
const RULE_STAKE: Record<string, { stake: StakeId; why: string }> = {
  plowhorse_repricing: {
    stake: 'money',
    why: 'The rule says “Raise those prices 5–8% or renegotiate cost on the next PO”. A price change moves what each bottle and glass brings in. The engine calls the rule efficiency; it is filed here by name, on the founder’s word (2026-10-04, ADR 0288).',
  },
  puzzle_activation: {
    stake: 'stock',
    why: 'The rule says “Put one puzzle wine by-the-glass this week”. It moves a bottle that is standing still on the shelf. The engine calls the rule efficiency; it is filed here by name, on the founder’s word (2026-10-04, ADR 0288).',
  },
  revenue_concentration: {
    stake: 'stock',
    why: 'The rule says “Protect the top sellers’ stock first (raise their service level to 98%)”. It changes how deep the stock runs on the wines the room actually drinks, not which vendor is paid. The engine calls the rule risk; it is filed here by name, on the founder’s word (2026-10-04, ADR 0288).',
  },
  weekday_gap: {
    stake: 'floor',
    why: 'The rule leads with “Move staff training, deliveries, and inventory counts to <weakest day>”. Putting the team’s work on a named day changes how the floor runs its week. Its second half, a day-only offer, would change money; it is filed by the clause it leads with, as its act is. The engine calls the rule sales; it is filed here by name, on the founder’s word (2026-10-04, ADR 0288).',
  },
};

/**
 * Category → stake, for every rule not filed by name. The rule engine
 * (`analytics/recommendations.service.ts`) emits nine categories: sales ·
 * inventory · pricing · risk · purchasing · staff · basket · goals ·
 * efficiency. The first eight are filed here by consequence.
 *
 * `efficiency` is deliberately absent. Both of its rules are filed by name
 * above, and a NEW efficiency rule must land in `unfiled` rather than be
 * absorbed into a register nobody sorted it into — which is exactly how AW28
 * happened. Anything else unknown lands in `unfiled` ON PURPOSE too.
 */
const CATEGORY_STAKE: Record<string, StakeId> = {
  sales: 'money',
  basket: 'money',
  goals: 'money',
  inventory: 'stock',
  purchasing: 'vendors',
  risk: 'vendors',
  staff: 'floor',
  // ADR 0193: price advice toward the house's target margin moves money.
  pricing: 'money',
};

/**
 * Where the register files an entry, and why. The rule is read from the key
 * with `readKey`, so a row on the Snoozed, Dismissed or History leaves —
 * whose stored key may be the composite `rule#subject#grain` (ADR 0191) —
 * files exactly as the standing entry does. Both tables are read by their own
 * rows only (`ownRow`).
 */
export function stakeFilingOf(
  ruleKey: string | null | undefined,
  category: string | null | undefined,
): StakeFiling {
  const ruleId = readKey(ruleKey ?? '').ruleId;
  const named = ownRow(RULE_STAKE, ruleId);
  if (named) return { stake: named.stake, why: named.why, by: 'rule' };
  const byCategory = category ? ownRow(CATEGORY_STAKE, category) : undefined;
  if (category && byCategory)
    return {
      stake: byCategory,
      why: `Filed from the rule’s category, ${category}, which this page reads as ${STAKE_BLURB[byCategory]}. No register is written for this rule by name.`,
      by: 'category',
    };
  return {
    stake: 'unfiled',
    why: category
      ? `This page has no register for the rule ${ruleId || EM} or for its category, ${category}. It is shown under ${stakeInSentence('unfiled')} rather than sorted by guesswork.`
      : `This page has no register for the rule ${ruleId || EM}, and it carried no category to file it by. It is shown under ${stakeInSentence('unfiled')} rather than sorted by guesswork.`,
    by: 'unfiled',
  };
}

export function stakeOf(
  ruleKey: string | null | undefined,
  category: string | null | undefined,
): StakeId {
  return stakeFilingOf(ruleKey, category).stake;
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
  return ownRow(URGENCY_LABEL, u) ?? u;
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
    vendor_concentration: { href: `/vendors?${q}`, label: 'Compare vendors', where: 'Vendors' },
    revenue_concentration: { href: `/inventory?${q}`, label: 'Protect top sellers', where: 'Inventory' },
    spend_acceleration: { href: `/orders?${q}`, label: 'Audit open orders', where: 'Orders' },
    pairing_promotion: { href: `/promotions?${q}`, label: 'Promote the pairing', where: 'Promotions' },
    staff_spread: { href: `/team?${q}`, label: 'Open the roster', where: 'Team' },
    // ADR 0193: each advised price is accepted with one tap on its own row,
    // under "Your price" on Inventory; the target itself lives in Settings.
    margin_to_target: { href: `/inventory?${q}`, label: 'Review your prices', where: 'Inventory' },
    margin_advice_blind: { href: `/inventory?${q}`, label: 'See which wines', where: 'Inventory' },
    margin_target_unset: { href: `/settings?tab=target-margin&${q}`, label: 'Set your target', where: 'Settings' },
    // ADR 0193 round 3: the locks live on /menu, under Locked prices.
    price_locks_to_review: { href: `/menu?${q}#locked-prices`, label: 'Look at the locks', where: 'Menu' },
  };
  const hit = ownRow(byRule, ruleKey);
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
  return ownRow(byCategory, category) ?? { href: `/reports?${q}`, label: 'Open Reports', where: 'Reports' };
}

/** A hand as the person looking at the card holds it. */
export interface HandHeld {
  /**
   * This person may open the room the work lands in. Only then is the Act
   * control drawn, and only then does `act` navigate.
   */
  yours: boolean;
  /** The "Whose hand" fact: "Yours, in Orders", or "A manager’s, in Promotions". */
  words: string;
  /** Who may open the room, in words, when this person may not; null when they may. */
  opens: string | null;
}

/**
 * Whose hand the work is in, for THIS person (founder item 87, 2026-09-28,
 * OD-176, ADR 0191: "Show card, hand to manager (Recommended)"). A staff
 * member keeps a Promotions-bound card, but the card says it is a manager's
 * and offers no Act, because `GET /promotions` refuses staff
 * (ADR-0124-PROMOTIONS-ROLE-GATE). The gate is read from the shell's rooms
 * table (`rooms.ts` `minRole`, through `roleAllows`), not restated here, so
 * the card and the rail cannot disagree about who may open a room. A null
 * role, or one the shell does not know, clears no gate: it fails closed.
 * Today Promotions is the only hand-off target the table gates
 * (`rec-format.test.ts` pins that).
 */
export function heldBy(hand: Hand, role: ShellRole): HandHeld {
  const min = roomFor((hand.href ?? '').split(/[?#]/)[0])?.minRole;
  if (roleAllows(role, min)) return { yours: true, words: `Yours, in ${hand.where}`, opens: null };
  return min === 'owner'
    ? { yours: false, words: `An owner’s, in ${hand.where}`, opens: 'an owner' }
    : { yours: false, words: `A manager’s, in ${hand.where}`, opens: 'an owner or manager' };
}

/* ── The scope of a dismissal ────────────────────────────────────────────── */

/**
 * The three scopes, and the words for each.
 *
 * The KEYS are built by the gateway (`analytics/insights/suppression.ts`) and
 * arrive on every entry — this page never constructs one, because "the same
 * insight" has to mean exactly one thing on both sides of the wire. What lives
 * here is only the reading: given a key or a scope, what does the manager see
 * on screen, and what are they promising to never see again.
 */
export type SuppressionScope = 'insight' | 'subject' | 'rule';

export const SCOPE_ORDER: SuppressionScope[] = ['insight', 'subject', 'rule'];

export interface SuppressionVM {
  key: string;
  scope: SuppressionScope;
  keys: Record<SuppressionScope, string>;
}

/** A subject and a period, read back out of a key. Display only. */
export function readKey(key: string): {
  ruleId: string;
  subject: string | null;
  grain: string | null;
} {
  const [ruleId = '', subject = '*', grain = '*'] = key.split('#');
  return {
    ruleId,
    subject: subject === '*' ? null : subject,
    grain: grain === '*' ? null : grain,
  };
}

/** The date a grain names ("d:2026-09-02" → "2026-09-02"), or null. */
export function dateOfGrain(grain: string | null | undefined): string | null {
  if (!grain) return null;
  const m = /^[a-z]+\d*:(\d{4}-\d{2}-\d{2})$/.exec(grain);
  return m ? m[1] : null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * "2026-09-02" → "Wed 2 Sep". An unparseable date is an em dash, never today.
 *
 * Written out rather than delegated to `toLocaleDateString`: this string is
 * part of a promise the manager is asked to agree to ("never show me this
 * finding for Wed 2 Sep"), and Intl's short month drifts with the ICU version
 * shipped by the runtime — the same date reads "Sep" in one browser and "Sept"
 * in another. A date in a promise has to be the same date everywhere.
 * Read in UTC, matching the business-date key the gateway stores.
 */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return EM;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return EM;
  const t = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return EM;
  return `${DAY_NAMES[t.getUTCDay()]} ${t.getUTCDate()} ${MONTH_NAMES[t.getUTCMonth()]}`;
}

/**
 * A FIRING, read back (ADR 0191 round 3 — the founder: "Each firing is one
 * card"). A rule that names no subject and no period is keyed by the period
 * it fired in — `fire:day:2026-09-21`, `fire:week:2026-W39`,
 * `fire:month:2026-09` (the gateway's `firingGrain`) — so a one-card dismiss
 * or done hides this firing and the card returns when the rule fires again.
 * Null for any other grain. Display only; the page never builds a key.
 */
export function firingOf(
  grain: string | null | undefined,
): { period: 'day' | 'week' | 'month'; words: string } | null {
  if (!grain) return null;
  let m = /^fire:day:(\d{4}-\d{2}-\d{2})$/.exec(grain);
  if (m) return { period: 'day', words: fmtDay(m[1]) };
  m = /^fire:week:(\d{4})-W(\d{2})$/.exec(grain);
  if (m) {
    // The Monday of an ISO week: week 1 holds 4 January.
    const year = Number(m[1]);
    const week = Number(m[2]);
    const jan4 = Date.UTC(year, 0, 4);
    const jan4Weekday = new Date(jan4).getUTCDay() || 7;
    const monday = new Date(jan4 + ((week - 1) * 7 - (jan4Weekday - 1)) * 86_400_000);
    return { period: 'week', words: `the week of ${fmtDay(monday.toISOString())}` };
  }
  m = /^fire:month:(\d{4})-(\d{2})$/.exec(grain);
  if (m) {
    const month = MONTH_NAMES[Number(m[2]) - 1];
    return month ? { period: 'month', words: `${month} ${m[1]}` } : null;
  }
  return null;
}

/**
 * The label on a scope choice, for THIS entry.
 *
 * A scope the entry cannot support is not offered — a rule that names no
 * weekday cannot be silenced "for Wednesdays", and a control that pretended
 * otherwise would be the fake button the house rule forbids.
 */
export function scopeLabel(
  scope: SuppressionScope,
  subject: string | null,
  day: string | null,
  firing: { words: string } | null = null,
): string {
  if (scope === 'insight' && firing) return `This firing only — ${firing.words}`;
  if (scope === 'insight')
    return day ? `This exact finding — ${fmtDay(day)}` : 'This exact finding';
  if (scope === 'subject')
    return subject ? `Every ${subject}, for this rule` : 'This subject, for this rule';
  return 'This rule entirely, for this restaurant';
}

/** What the manager is promising never to see again. Said in full. */
export function scopePromise(
  scope: SuppressionScope,
  subject: string | null,
  day: string | null,
  rule: string,
  firing: { words: string } | null = null,
): string {
  if (scope === 'insight' && firing)
    return `this firing of it — ${firing.words}. It comes back when the rule fires again with new numbers`;
  if (scope === 'insight')
    return day
      ? `this one finding about ${subject ?? 'this'} on ${fmtDay(day)} — the same rule will still be read on every other day`
      : `this one finding — the same rule will still be read on other subjects and other days`;
  if (scope === 'subject')
    return `every ${subject ?? 'reading of this subject'} this rule ever finds — other subjects keep reporting`;
  return `anything the rule ${rule} finds, on any day and any subject, until you return it`;
}

/**
 * The sentence a dismissed entry carries on the Dismissed and History leaves:
 * what is silenced, and where to undo it. Read from the stored key, so it
 * describes what was ACTUALLY written, not what the sheet offered.
 */
export function dismissalSentence(storedKey: string): string {
  const { ruleId, subject, grain } = readKey(storedKey);
  const firing = firingOf(grain);
  if (firing)
    return `Silenced: one firing of the rule ${ruleId} — ${firing.words}. It comes back when the rule fires again.`;
  const day = dateOfGrain(grain);
  if (subject && day)
    return `Silenced: this one finding about ${subject} on ${fmtDay(day)}. The rule still reads every other day.`;
  if (subject)
    return `Silenced: every ${subject} this rule finds. Other subjects still report.`;
  return `Silenced: the rule ${ruleId}, entirely — every subject, every day.`;
}

/**
 * The receipt under an entry — sketch 120 item 3: "the built page already
 * writes a one-line note with Undo; this makes it a RULED RECEIPT under the
 * entry it belongs to, saying exactly what was stored and what was not."
 *
 * Deliberately derived from the entry's own STORED state, not from a
 * transient "last action" cache: a receipt is a permanent record, and one
 * built from `status`/`pinned`/`snoozeUntil` reads true after a reload, not
 * only in the second after the click. The page-level toast (`data.note` /
 * `data.undo`) still exists for the immediate announcement; this is what
 * stays after it clears.
 *
 * Returns zero or more lines — never a single string — because "watched" and
 * "pinned" are independent of the disposition and of each other; an entry can
 * carry any combination.
 *
 * Deliberately silent on `status === 'dismissed'`: that leaf's own fuller
 * sentence (`dismissalSentence`, rendered directly in `Entry.tsx` from the
 * row's real stored key) already covers it, and `e.ruleKey` here is not
 * guaranteed to be that composite key outside the dismissed/history leaves.
 * A prior version called `dismissalSentence(e.ruleKey)` here too; it was
 * unreachable only because the render site happens to gate on the same leaf
 * check, and would have misreported a narrowly-scoped dismissal as silencing
 * the whole rule if that gating were ever loosened. See
 * `rec-format.test.ts` for the case that would fail without this.
 */
export function receiptFor(
  e: {
    ruleKey: string;
    status: 'active' | 'dismissed' | 'snoozed' | 'done';
    acted: boolean;
    pinned: boolean;
    snoozeUntil?: string | null;
  },
  watching: boolean,
  /** A *Brief the floor* entry — its "acted" is the briefing (sketch 122 Q7). */
  briefing = false,
): string[] {
  const lines: string[] = [];
  if (e.status === 'snoozed') {
    lines.push(`Snoozed — ${fmtWakes(e.snoozeUntil)}. Marked on the ribbon's strip.`);
  } else if (e.status === 'done') {
    lines.push('Sealed as ruled off. No outcome is measured yet — 094c’s roadmap.');
  } else if (e.acted) {
    lines.push(
      briefing
        ? 'Marked as briefed. Still standing — briefing does not remove it from the book.'
        : 'Recorded as acted. Still standing — acting does not remove it from the book.',
    );
  }
  if (watching) lines.push('Watched by a goal.');
  if (e.pinned) {
    lines.push(
      'Pinned. It leads the post too — the digest carries pinned entries first.',
    );
  }
  return lines;
}

/* ── Time, said only where it is known ───────────────────────────────────── */

function daysBetween(a: number, b: number): number {
  return Math.floor((a - b) / 86_400_000);
}

function elapsed(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = daysBetween(Date.now(), t);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  if (d < 30) return `${d} days`;
  const m = Math.floor(d / 30);
  return m === 1 ? '1 month' : `${m} months`;
}

/**
 * How long an entry has stood.
 *
 * Until 2026-09-03 this was an em dash on every untouched entry, because the
 * feed carried no first-fired timestamp — while `recommendation_impressions`
 * had been recording the answer since 2026-08-17 and nothing read it. The
 * gateway now attaches `firstSeenAt = the first time this rule was ever shown`
 * (`recommendations.service.ts` `attachFirstSeen`), and THAT is the number
 * here. `updatedAt` is the fallback and is a different fact — when the
 * disposition store last touched the entry — so the page says which it is
 * showing rather than letting the two read as one.
 */
export function standingOf(entry: {
  firstSeenAt?: string | null;
  updatedAt?: string | null;
}): { text: string; basis: 'first-seen' | 'touched' | 'unknown' } {
  if (entry.firstSeenAt) {
    const t = elapsed(entry.firstSeenAt);
    if (t) return { text: t, basis: 'first-seen' };
  }
  if (entry.updatedAt) {
    const t = elapsed(entry.updatedAt);
    if (t) return { text: t, basis: 'touched' };
  }
  return { text: EM, basis: 'unknown' };
}

export const STANDING_BASIS: Record<
  'first-seen' | 'touched' | 'unknown',
  string
> = {
  'first-seen': 'since it was first shown to you',
  touched: 'since the book last recorded a decision on it — not when it first fired',
  unknown: 'nothing has recorded when this entry first fired',
};

/**
 * How long an entry has stood, from the disposition store's `updatedAt` alone.
 * Kept for the snoozed/dismissed leaves, whose rows come from the actions
 * table and carry no impression history.
 */
export function fmtStanding(iso: string | null | undefined): string {
  if (!iso) return EM;
  return elapsed(iso) ?? EM;
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

/**
 * The dismissal reasons — the gateway's closed label set. One list for the
 * whole web app (`@/lib/recommendationState`), re-exported for this page.
 */
export {
  DISMISS_CHOICES,
  DISMISS_REASONS,
  NOT_NOW_DAYS,
  NOT_YOUR_ACT_SAID,
  mayActForTheHouse,
  maySnoozeForEveryone,
  notYourActOf,
  paperMissOf,
  patchForChoice,
  type DismissChoiceId,
} from '@/lib/recommendationState';

/**
 * The key a state write about THIS item goes to — snooze, done, a one-item
 * dismiss (ADR 0191: one shared per-item state). The gateway built it
 * (`suppression.key`, the exact finding); a row read back from the actions
 * table has none, and its own `ruleKey` IS the stored key. Pin, rating,
 * assignment and acted-on stay on the rule's own row, as before.
 */
export function itemKeyOf(e: {
  ruleKey: string;
  suppression?: { key: string } | null;
}): string {
  return e.suppression?.key ?? e.ruleKey;
}

/**
 * The snooze vocabulary — `value` is the number of days the label already
 * says out loud, and nothing here describes the tenant (descriptor keys,
 * per `scripts/check_no_seeded_defaults.py` S1). Shared by the feed's entry
 * and the catalogue's live items, so a snooze means one thing on both.
 */
export const SNOOZE_CHOICES: ReadonlyArray<{ id: string; label: string; value: number }> = [
  { id: 'tomorrow', label: 'Until tomorrow', value: 1 },
  { id: 'week', label: 'Until next week', value: 7 },
  { id: 'month', label: 'Until next month', value: 30 },
];

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
