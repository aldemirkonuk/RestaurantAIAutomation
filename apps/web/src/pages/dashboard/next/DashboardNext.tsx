/**
 * DashboardNext — the Mudavym redesign of `/` (ADR 0044), built from the
 * founder's 2026-08-29 verdicts:
 *
 *  - the TradeZella-style SALES CALENDAR is the headline (SalesCalendar):
 *    a month grid where each day carries its own result and clicking a day
 *    opens everything that happened on it;
 *  - the serif "Good evening / before service" opening (Fraunces speaks);
 *  - the "Waiting on you" approvals queue;
 *  - honest empty states everywhere, em dash for every unknown, and figures
 *    that are labelled as what they are (vendor spend, never "revenue").
 *
 * Reachable only when `mudavym.design.dashboard` / the feature flag is on —
 * PageGate wraps this tree in the `.mudavym` token scope; the root here
 * carries the class too so the page stands alone in tests and sandboxes.
 * Both grounds ship: paper by default, Warm Charcoal under the app's dark
 * theme (`.dark .mudavym`) or an explicit data-ground="charcoal".
 */

import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Wordmark } from '@/components/mudavym';
import { animate, settle } from '@/lib/mudavym';
import { useDashboardSpine } from './useDashboardNextData';
import { ensureFraunces, SERIF } from './fonts';
import KpiRow from './KpiRow';
import SalesCalendar from './SalesCalendar';
import WaitingOnYou from './WaitingOnYou';
import { ActivityPanel, LowStockPanel, WeekAhead } from './RailPanels';
import './dashboard-next.css';

/** Time-of-day voice — the Editorial opening the founder named as liked. */
function voice(now: Date): { greeting: string; service: string } {
  const h = now.getHours();
  if (h >= 5 && h < 11) return { greeting: 'Good morning', service: 'before the doors open' };
  if (h >= 11 && h < 16) return { greeting: 'Good afternoon', service: 'between services' };
  if (h >= 16 && h < 23) return { greeting: 'Good evening', service: 'before service' };
  return { greeting: 'Still up', service: 'after service' };
}

export interface DashboardNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function DashboardNext({ ground }: DashboardNextProps) {
  const { user, activeRestaurantId } = useAuth();
  const spine = useDashboardSpine(activeRestaurantId);
  const headRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ensureFraunces();
  }, []);

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
  const { greeting, service } = voice(now);
  const firstName = user?.name?.split(' ')[0];

  const pendingCount =
    spine.pending === undefined ? undefined : spine.pending === null ? null : spine.pending.length;
  const lowStockCount =
    spine.lowStock === undefined ? undefined : spine.lowStock === null ? null : spine.lowStock.length;

  // The opening sentence only speaks what it actually knows.
  let standing: string;
  if (pendingCount === undefined || lowStockCount === undefined) {
    standing = 'Taking the room’s temperature…';
  } else if (pendingCount === null && lowStockCount === null) {
    standing = 'The gateway is quiet — figures will land as connections return.';
  } else {
    const parts: string[] = [];
    if (pendingCount != null && pendingCount > 0)
      parts.push(`${pendingCount} ${pendingCount === 1 ? 'approval' : 'approvals'}`);
    if (lowStockCount != null && lowStockCount > 0)
      parts.push(`${lowStockCount} low-stock ${lowStockCount === 1 ? 'wine' : 'wines'}`);
    standing =
      parts.length > 0
        ? `${parts.join(' and ')} ${parts.length > 1 || pendingCount! > 1 || (lowStockCount ?? 0) > 1 ? 'are' : 'is'} waiting on you.`
        : 'Nothing is waiting on you.';
  }

  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      className="mudavym min-h-full bg-paper-0 text-inkm-1"
      data-ground={ground}
      style={{ fontFamily: '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif' }}
    >
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:py-8">
        {/* ── the opening — Fraunces speaks ─────────────────────────────── */}
        <header ref={headRef} className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-inkm-3">
            {dateLine} · {service}
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
          </p>
        </header>

        {/* ── the KPI row ───────────────────────────────────────────────── */}
        <KpiRow stats={spine.stats} pendingCount={pendingCount} lowStockCount={lowStockCount} />

        {/* ── headline + rail ───────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <SalesCalendar
            restaurantId={activeRestaurantId}
            alerts={spine.alerts}
            activity={spine.activity}
          />
          <div className="space-y-4">
            <WaitingOnYou pending={spine.pending} onChanged={spine.refetch} />
            <WeekAhead restaurantId={activeRestaurantId} />
            <LowStockPanel items={spine.lowStock} />
            <ActivityPanel items={spine.activity} />
          </div>
        </div>

        {/* ── the signature ─────────────────────────────────────────────── */}
        <footer className="mt-10 flex items-baseline justify-between border-t border-paper-2 pt-4">
          <Wordmark size={14} />
          <p className="text-[11px] text-inkm-3">
            Figures on this page are procurement — money paid to vendors — not sales.
          </p>
        </footer>
      </div>
    </div>
  );
}
