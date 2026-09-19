/**
 * The day-book's own arithmetic: the day rail, the quick search, and the one
 * correction the fold needed.
 *
 * THE FOLD SHOWED A STALE LINE, AND THIS IS THE MEASUREMENT.
 * `lib/notificationStack.ts` collapses repeated low-stock alerts into one line
 * and picks the survivor by `mode: 'max_count'` — the row with the highest
 * wine count wins, whatever its date (`notificationStack.ts:59-65`). On the
 * production book for restaurant 550e8400… on 2026-09-03 that made the
 * surviving burst "50 wines dropped below par", written 11:24, while the
 * newest burst in the same fold was written 16:44 — so the headline line of
 * the page carried an age five hours and twenty minutes older than the news it
 * stood for, and the fresher line was inside the fold with no stamp of its
 * own. A book that reports the oldest of its repeats as the latest word is the
 * "absence reported as health" fault in miniature.
 *
 * The fix does NOT re-implement the stacker — that library is shared and this
 * page does not own it. It asks the stacker itself: two rows belong to the
 * same fold exactly when collapsing the pair yields one line. That uses only
 * the exported function, so it cannot drift from the real keys, and the page
 * then prints the fold's NEWEST stamp beside the winner's own.
 */

import { monthDays } from '@/components/mudavym';
import { collapseStackedNotifications } from '@/lib/notificationStack';
import type { Notification } from '@/services/api/notifications';
import { kindOf, plainText } from './nt-format';

/* ── the fold's freshest member ────────────────────────────────────────── */

export interface FoldFreshness {
  /** Epoch ms of the newest row in the fold; null when nothing is folded. */
  newestAt: number | null;
  /** True when the surviving line is older than the newest of its fold. */
  winnerIsStale: boolean;
}

function stampMs(n: Notification): number {
  const t = new Date(n.timestamp ?? n.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * For each folded winner, the newest stamp in its fold.
 *
 * Only winners that actually folded something are probed — on the measured
 * book that is two lines out of a hundred rows, so the pairwise probe costs
 * nothing and the page never has to guess at group membership.
 */
export function foldFreshness(
  raw: Notification[],
  winners: Notification[],
  foldedById: Record<string, number>,
): Record<string, FoldFreshness> {
  const out: Record<string, FoldFreshness> = {};
  for (const w of winners) {
    if (!foldedById[w.id]) continue;
    let newest = stampMs(w);
    for (const r of raw) {
      if (r.id === w.id) continue;
      // Same fold ⟺ the stacker itself collapses the pair to one line.
      if (collapseStackedNotifications([w, r]).items.length !== 1) continue;
      newest = Math.max(newest, stampMs(r));
    }
    out[w.id] = { newestAt: newest, winnerIsStale: newest > stampMs(w) };
  }
  return out;
}

/* ── the day rail ──────────────────────────────────────────────────────── */

export interface DayCell {
  /** `YYYY-MM-DD` in the reader's own timezone — the key the rail selects. */
  key: string;
  /** Lines of that day among the rows actually loaded. Never a server total. */
  onScreen: number;
  /** How many of those are still unread. */
  open: number;
  /**
   * Whether the REGISTER wrote anything that day, as far as this screen can
   * honestly tell. See `dayCells` — `none` is only ever claimed for a day the
   * loaded rows actually cover.
   */
  records: 'yes' | 'none' | 'unknown';
}

/** `YYYY-MM-DD` in local time — the same day the reader would name. */
export function dayKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The ISO window a day key means, in local time, for the gateway's
 * `dateFrom` / `dateTo` — which are `gte(created_at)` and `lte(created_at)`
 * (`notifications.service.ts:815-821`). Local midnight to local end-of-day, so
 * "Tuesday" means the reader's Tuesday and not UTC's.
 */
export function daySpan(key: string): { dateFrom: string; dateTo: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const from = new Date(y, mo, d, 0, 0, 0, 0);
  const to = new Date(y, mo, d, 23, 59, 59, 999);
  if (!Number.isFinite(from.getTime())) return null;
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

export interface DayCellsInput {
  rows: Notification[];
  /** The calendar month on screen, `YYYY-MM`. */
  month: string;
  /** Today, as a local day key — the reader's own today. */
  today: string;
  /**
   * True when the register is being read under a narrowing this screen did not
   * apply itself. A `day` filter makes every OTHER day unreadable from these
   * rows, so nothing may be claimed about them.
   */
  dayFiltered: boolean;
}

/**
 * One calendar month of cells — and the one honest claim this page can make
 * about a blank day.
 *
 * THE COUNTS ARE "ON THIS SCREEN", AND ALWAYS WERE. Only the pages actually
 * read are in `rows`, so `onScreen` is never dressed up as a register total;
 * the register's own figure appears only once a day is selected and read back.
 *
 * THE HATCH IS NEW, AND IT IS EARNED. The gateway returns notifications
 * `order("created_at", { ascending: false })` (`notifications.service.ts:824`)
 * and this page reads pages 1..N contiguously, so the rows on screen are a
 * newest-first PREFIX of the register. That makes one negative claim safe: for
 * any day strictly newer than the oldest loaded row's day, "no rows on screen"
 * means "no rows in the register" — the register cannot be hiding a line
 * between two lines this screen already holds. Those days are `none`, and they
 * hatch.
 *
 * Everything else is `unknown`, and this is the list of everything else:
 *  - days at or older than the oldest loaded row's day (the page boundary can
 *    fall inside a day, so even the oldest day itself is not fully read);
 *  - every day but one while a `day` filter is applied;
 *  - every day when nothing has been loaded at all.
 *
 * A type or status filter does NOT force `unknown`: "no line of this kind that
 * day" is a true statement about a narrower thing, and the strip's own note
 * says which narrowing is in force. Calling that `unknown` would be the
 * opposite error — an absence the page CAN prove, reported as ignorance.
 */
export function dayCells(input: DayCellsInput): DayCell[] {
  const counted = new Map<string, { onScreen: number; open: number }>();
  let oldest: string | null = null;
  for (const r of input.rows) {
    const key = dayKeyOf(r.timestamp ?? r.createdAt);
    if (!key) continue;
    if (oldest === null || key < oldest) oldest = key;
    const cur = counted.get(key) ?? { onScreen: 0, open: 0 };
    cur.onScreen += 1;
    if (String(r.status) === 'unread') cur.open += 1;
    counted.set(key, cur);
  }

  return monthDays(input.month).map((key) => {
    const c = counted.get(key) ?? { onScreen: 0, open: 0 };
    let records: DayCell['records'];
    if (c.onScreen > 0) records = 'yes';
    else if (input.dayFiltered || oldest === null) records = 'unknown';
    else if (key > oldest && key <= input.today) records = 'none';
    else records = 'unknown';
    return { key, onScreen: c.onScreen, open: c.open, records };
  });
}

/* ── quick search ──────────────────────────────────────────────────────── */

/**
 * Search over the book that is on screen — title, message and register.
 *
 * The text searched is the text DRAWN (`plainText`), so a query never has to
 * contain the emoji a producer once stored in a title. It is a client-side
 * narrowing of loaded rows and the page labels it as such, next to the four
 * filters that are the register's own.
 */
export function matchesQuery(n: Notification, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${plainText(n.title)} ${plainText(n.message)} ${kindOf(n.type)} ${n.type ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/* ── the register filter's choices ─────────────────────────────────────── */

/**
 * The registers offered as a type filter, with the `notifications.type` value
 * each one sends.
 *
 * ONLY TYPES A REAL PRODUCER WRITES ARE LISTED, and that is a rule rather than
 * a preference: a filter for a type nothing ever writes is a control that can
 * only ever return an empty book, which is the same shape as the fault this
 * page exists to remove. Each line below was checked against the tree on
 * 2026-09-03:
 *
 *   inventory_low_stock  notifications/low-stock-alerts.service.ts:332
 *   order_pending        communications/scheduled-tasks.service.ts:490
 *   invoice_received     procurement/procurement.service.ts:1747, :2365
 *   draft_ready          services/agent-orchestrator/agents/
 *                        provider_communication_agent.py:738
 *   calendar_reminder    calendar/calendar-reminders.service.ts:457
 *   report               communications/scheduled-tasks.service.ts:266
 *   constraint_triggered provider_communication_agent.py:447,471,504,647
 *   system               team/schedule.service.ts:396 (+5 more)
 *
 * The remaining four arrive with the producers a SIBLING builder is landing in
 * the same wave, and those files are being edited while this one is written, so
 * they are cited by file and symbol rather than by a line number that would be
 * stale before it was committed:
 *
 *   order_delivered      notifications/producers/delivery-recorded.producer.ts
 *   service_closed       notifications/producers/sale-record.producer.ts
 *   goal_reached         notifications/producers/goal-reached.producer.ts
 *   price_change         notifications/producers/market-price.producer.ts
 *   invoice_received     notifications/producers/invoice-confirmed.producer.ts
 *                        (the matching-good case, beside procurement's
 *                        discrepancy case above)
 *
 * DELIBERATELY ABSENT: `ai_suggestion`. It is in `NotificationType`
 * (`notifications/dto/notifications.dto.ts:29`) and nothing anywhere writes it
 * — an enum member is not a producer. It stays in the register map in
 * `nt-format.ts`, so a row of that type would still be drawn under *Advice* if
 * one ever appeared; it is only the filter that refuses to offer it.
 *
 * ALSO ABSENT: a PRIORITY filter. 631 of 663 rows on the live register are
 * `critical`, so it would sort by a constant (page note §9.12).
 */
export const TYPE_CHOICES: Array<{ type: string; label: string; kind: string }> = [
  { type: 'inventory_low_stock', label: 'Stock', kind: 'Stock' },
  { type: 'order_pending', label: 'Orders awaiting approval', kind: 'Orders' },
  { type: 'order_delivered', label: 'Deliveries', kind: 'Deliveries' },
  { type: 'invoice_received', label: 'Invoices', kind: 'Invoices' },
  { type: 'service_closed', label: 'Sales', kind: 'Sales' },
  { type: 'goal_reached', label: 'Goals', kind: 'Goals' },
  { type: 'price_change', label: 'Market price', kind: 'Market' },
  { type: 'draft_ready', label: 'Drafted replies', kind: 'Vendor mail' },
  { type: 'calendar_reminder', label: 'Calendar', kind: 'Calendar' },
  { type: 'report', label: 'Reports', kind: 'Reports' },
  { type: 'constraint_triggered', label: 'Advice', kind: 'Advice' },
  { type: 'system', label: 'System', kind: 'System' },
];
