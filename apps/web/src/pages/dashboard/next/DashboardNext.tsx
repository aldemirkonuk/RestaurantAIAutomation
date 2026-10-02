/**
 * DashboardNext — the Mudavym redesign of `/` (ADR 0044), built from the
 * founder's 2026-08-29 verdicts:
 *
 *  - the TradeZella-style SALES CALENDAR is the headline (SalesCalendar):
 *    a month grid where each day carries its own result and clicking a day
 *    opens everything that happened on it;
 *  - the serif "Good evening" opening (Fraunces speaks);
 *  - the "Waiting on you" approvals queue;
 *  - honest empty states everywhere, em dash for every unknown, and figures
 *    that are labelled as what they are (vendor spend, never "revenue").
 *
 * Live for every house since ADR 0149 row 36 (2026-09-17, "16 locked
 * pages"): `dashboard` is in `LIVE_PAGES`, so `useMudavymDesign` resolves this
 * page in code and `mudavym_design_dashboard` is no longer read (the QA
 * `localStorage["mudavym.design.dashboard"]` override still forces legacy on
 * one browser, for comparison). The root here carries the `.mudavym` token
 * scope itself, so the page stands alone in tests and sandboxes (PageGate
 * adds no second scope).
 *
 * The ground is Warm Charcoal in EVERY app theme (founder, 2026-09-12): the
 * `.mudavym` scope paints the decided ground and the light/dark toggle does
 * not reach into it. The page does NOT follow the user's theme; the rest of
 * the app still does.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Wordmark } from '@/components/mudavym';
import { DayLine } from '@/components/mudavym/DayLine';
import { animate, settle } from '@/lib/mudavym';
import { houseZoneOf, useDashboardSpine } from './useDashboardNextData';
import { hourIn } from './format';
import { SERIF } from './fonts';
import KpiRow from './KpiRow';
import SalesCalendar from './SalesCalendar';
import WaitingOnYou from './WaitingOnYou';
import OneTapPanel from './OneTapPanel';
import { ActivityPanel, LowStockPanel, WeekAhead } from './RailPanels';
import { TryAgain } from './TryAgain';
import './dashboard-next.css';

/**
 * Time-of-day voice — the Editorial opening the founder named as liked. Read
 * on the house's clock (DASH-W20), the one the figures below are kept in.
 *
 * DASH-W25 (P5): the greeting only. It used to add where the house stood in
 * its service ("before service" at 16:00–23:00), guessed from the hour alone —
 * so a house open 12:00–23:00 read "before service" mid-shift. The day line
 * below states the house's real hours; the opening no longer guesses them.
 */
function greetingFor(now: Date, zone: string | null): string {
  const h = hourIn(now, zone);
  if (h >= 5 && h < 11) return 'Good morning';
  if (h >= 11 && h < 16) return 'Good afternoon';
  if (h >= 16 && h < 23) return 'Good evening';
  return 'Still up';
}

export interface DashboardNextProps {
  /**
   * State the ground out loud. Charcoal is now the `.mudavym` default in every
   * theme, so this changes nothing on its own — it is kept because a surface
   * may want to name its ground, and because `[data-ground="charcoal"]` is a
   * hook other rules hang off (see DoorNext).
   */
  ground?: 'charcoal';
}

export default function DashboardNext({ ground }: DashboardNextProps) {
  const { user, activeRestaurantId, activeRole } = useAuth();
  const spine = useDashboardSpine(activeRestaurantId);
  // DASH-W22 (founder, 2026-10-01, "A: hide amounts for staff"): staff see
  // counts, not money. The gateway is the guard — it withholds the spend for
  // that role and says so in `amounts` — so its word wins; the role only
  // covers a gateway too old to say, and the approvals queue, whose order
  // routes still carry prices.
  // DASH-G5 (founder, 2026-10-01, "Hide money, this PR"): a role the page does
  // not know yet sees no money — only a known owner or manager does — so a
  // failed role read can never open the prices to staff.
  const statsAmounts = (spine.stats as { amounts?: string } | null | undefined)?.amounts;
  const roleSeesAmounts = activeRole === 'owner' || activeRole === 'manager';
  const seesAmounts = statsAmounts !== 'withheld' && roleSeesAmounts;
  const headRef = useRef<HTMLElement | null>(null);

  // One quiet entrance for the opening line — settle, 6px, once.
  useEffect(() => {
    if (!headRef.current) return;
    animate(
      headRef.current,
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { easing: settle.easing, ms: 420 },
    );
  }, []);

  const now = useMemo(() => new Date(), []);
  const zone = houseZoneOf(spine.stats);
  const greeting = greetingFor(now, zone);
  const firstName = user?.name?.split(' ')[0];

  const pendingCount =
    spine.pending === undefined ? undefined : spine.pending === null ? null : spine.pending.length;
  const lowStockCount =
    spine.lowStock === undefined ? undefined : spine.lowStock === null ? null : spine.lowStock.length;

  // The opening sentence only speaks what it actually knows. DASH-W19: what
  // it could not read it names, in the house's words, and offers to read again.
  let standing: string;
  const unread: string[] = [];
  if (pendingCount === undefined || lowStockCount === undefined) {
    standing = 'Taking the room’s temperature…';
  } else if (pendingCount === null && lowStockCount === null) {
    standing = 'The house’s figures couldn’t be reached just now.';
    if (spine.stats === null) unread.push('the totals');
  } else {
    const parts: string[] = [];
    if (pendingCount != null && pendingCount > 0)
      parts.push(`${pendingCount} ${pendingCount === 1 ? 'approval' : 'approvals'}`);
    if (lowStockCount != null && lowStockCount > 0)
      parts.push(`${lowStockCount} low-stock ${lowStockCount === 1 ? 'item' : 'items'}`);
    if (pendingCount === null) unread.push('the approvals');
    if (lowStockCount === null) unread.push('stock levels');
    if (spine.stats === null) unread.push('the totals');
    // "Nothing is waiting on you" is only true when both halves answered.
    standing =
      parts.length > 0
        ? `${parts.join(' and ')} ${parts.length > 1 || pendingCount! > 1 || (lowStockCount ?? 0) > 1 ? 'are' : 'is'} waiting on you.`
        : pendingCount === null
          ? 'No item is running low.'
          : lowStockCount === null
            ? 'No approvals are waiting.'
            : 'Nothing is waiting on you.';
    if (unread.length > 0) {
      const list = unread.length === 1 ? unread[0] : `${unread.slice(0, -1).join(', ')} and ${unread[unread.length - 1]}`;
      standing += ` ${list.charAt(0).toUpperCase()}${list.slice(1)} couldn’t be reached just now.`;
    }
  }
  const canRetry = pendingCount === null || lowStockCount === null || spine.stats === null;

  let dateLine: string;
  try {
    dateLine = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: zone ?? undefined,
    });
  } catch {
    dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // `min-h-screen`, NOT `min-h-full`. DashboardLayout's <main> is itself
  // `min-h-screen` with no resolved height on the chain above it
  // (components/layout/DashboardLayout.tsx:85), so a percentage minimum
  // resolves against a content-sized parent: measured, this child came out at
  // 18.5px against a 563px viewport, leaving the light app shell showing below
  // a charcoal band — a seam across the first page a manager lands on. Every
  // other Next page states the viewport minimum directly; this one now matches.
  return (
    <div
      className="mudavym min-h-screen bg-paper-0 text-inkm-1"
      data-ground={ground}
      style={{ fontFamily: '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif' }}
    >
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:py-8">
        {/* ── the opening — Fraunces speaks ─────────────────────────────── */}
        <header ref={headRef} className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-inkm-4">
            {dateLine}
          </p>
          <h1
            className="mt-1 text-[32px] font-normal leading-tight text-inkm-1 sm:text-[38px]"
            style={{ fontFamily: SERIF, fontWeight: 420 }}
          >
            {greeting}
            {firstName ? `, ${firstName}` : ''}
            <span className="text-seal">.</span>
          </h1>
          <p className="mt-1 text-[15px] text-inkm-2" style={{ fontFamily: SERIF, fontStyle: 'italic' }}>
            {standing}
            {canRetry && <TryAgain onRetry={spine.refetch} />}
          </p>
        </header>

        {/* ── the day line (sketch 119 §E) ──────────────────────────────── */}
        {/* A PAGE element, self-gated by the shell flag — renders nothing
            when the shell is off. The page's own first line, above the KPI
            row, per the founder's 2026-09-21 pick. */}
        <DayLine />

        {/* ── the KPI row ───────────────────────────────────────────────── */}
        <KpiRow
          stats={spine.stats}
          pendingCount={pendingCount}
          lowStockCount={lowStockCount}
          seesAmounts={seesAmounts}
        />

        {/* ── headline + rail ───────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <SalesCalendar
            restaurantId={activeRestaurantId}
            zone={zone}
            seesAmounts={seesAmounts}
            alerts={spine.alerts}
            activity={spine.activity}
          />
          <div className="space-y-4">
            <WaitingOnYou
              pending={spine.pending}
              onChanged={spine.refetch}
              restaurantId={activeRestaurantId}
              seesAmounts={seesAmounts}
            />
            {/* Directly under the approvals queue, by the founder's decision of
                2026-09-03: an action the house raised is a cousin of an order
                waiting to be sealed, and belongs beside it rather than inside
                the day-book at /notifications. */}
            <OneTapPanel restaurantId={activeRestaurantId} />
            <WeekAhead restaurantId={activeRestaurantId} zone={zone} />
            <LowStockPanel items={spine.lowStock} onRetry={spine.refetch} />
            <ActivityPanel items={spine.activity} />
          </div>
        </div>

        {/* ── the signature ─────────────────────────────────────────────── */}
        <footer className="mt-10 border-t border-paper-2 pt-4">
          <div className="flex items-baseline justify-between">
            <Wordmark size={14} />
            {/* Only where money is drawn; a staff page carries counts. */}
            {seesAmounts && (
              <p className="text-[11px] text-inkm-4">
                Figures on this page are procurement — money paid to vendors — not sales.
              </p>
            )}
          </div>
          {/* The note-control experiment's standing count used to sit here
              (ADR 0127 option 8, :120-121). It is a count for the founder, not a line a manager
              needs before service, so it moves to /logs, the operator page
              (founder, 2026-10-01, DASH-W5). `noteCloseReportLine` is unchanged
              for that page to use. */}
        </footer>
      </div>
    </div>
  );
}
