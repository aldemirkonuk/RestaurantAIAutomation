/**
 * StaffHome — what `/` is for a person on the floor (N-11, design review
 * 2026-11-18). The owner's desk (a month calendar, approvals, a week ahead)
 * is not the daily user's page: staff open the app to count, to receive, and
 * to ask. So the page is three 56 px actions and the bottles that are running
 * low, each row a 56 px target that recounts on a right swipe.
 *
 * Reading rules kept from the desk: a failed read says so in words (never a
 * quiet empty list), and an unknown count is an em dash, never a zero.
 *
 * Motion: the row follows the finger by `transform` only, and springs back on
 * the `tuck` token. Under `prefers-reduced-motion` the row does not travel at
 * all; the swipe still commits, and a plain tap on the row does the same thing.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, MessageCircle, PackageCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { openAskAi } from '@/components/askai/events';
import { animate, prefersReducedMotion, tuck } from '@/lib/mudavym';
import { formatNumber } from '@/lib/utils';
import type { InventoryItem } from '@/services/api/types';
import { useDashboardSpine } from './useDashboardNextData';
import { lowStockView } from './RailPanels';
import { SERIF } from './fonts';
import { DASH } from './format';
import { swipeCommits, swipeState, swipeTravel } from './staffSwipe';
import './staff-home.css';

/** The inventory page's deep link: it opens with the search already typed. */
export function recountHref(name: string | null): string {
  return name ? `/inventory?wine=${encodeURIComponent(name)}` : '/inventory';
}

function SwipeRow({ item }: { item: ReturnType<typeof lowStockView> }) {
  const navigate = useNavigate();
  const frontRef = useRef<HTMLAnchorElement | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const href = recountHref(item.name);

  const setTravel = (px: number) => {
    const el = frontRef.current;
    if (!el) return;
    el.style.transform = px === 0 ? '' : `translateX(${px}px)`;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragged.current = false;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (swipeState(dx, dy) === 'follow') {
      dragged.current = true;
      // A person who asked for no motion gets no travel; the swipe still counts.
      if (!prefersReducedMotion()) setTravel(swipeTravel(dx));
    }
  };

  const finish = (e: ReactPointerEvent<HTMLAnchorElement>, cancelled: boolean) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const commit = !cancelled && swipeCommits(dx, dy);
    const el = frontRef.current;
    const from = swipeTravel(dx);
    if (el && from > 0 && !prefersReducedMotion()) {
      animate(
        el,
        [{ transform: `translateX(${from}px)` }, { transform: 'translateX(0px)' }],
        tuck,
      )?.addEventListener('finish', () => setTravel(0));
    }
    setTravel(0);
    if (commit) navigate(href);
  };

  return (
    <li className="sh-row" data-testid="staff-low-row">
      <span className="sh-row__back" aria-hidden>
        Recount
      </span>
      <Link
        ref={frontRef}
        to={href}
        className="sh-row__front"
        // A link is draggable by default: a mouse or pen drag along the row
        // starts the browser's own link drag, which cancels the pointer
        // before the swipe can finish (walked 2026-11-18, r60).
        draggable={false}
        aria-label={`${item.name ?? 'Unnamed wine'}, ${item.stock == null ? 'count not known' : `${formatNumber(item.stock)} left`}. Recount.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onClick={(e) => {
          // A drag that ended on the row is not also a tap.
          if (dragged.current) {
            e.preventDefault();
            dragged.current = false;
          }
        }}
      >
        <span className="sh-row__name">
          {item.name ?? 'Unnamed wine'}
          {item.vintage ? <span className="sh-row__vintage"> {item.vintage}</span> : null}
        </span>
        <span className="sh-row__count" data-empty={item.stock === 0 ? 'true' : undefined}>
          {item.stock == null ? DASH : formatNumber(item.stock)}
          <span className="sh-row__min"> / min {item.min == null ? DASH : formatNumber(item.min)}</span>
        </span>
      </Link>
    </li>
  );
}

export function StaffLowStock({ items }: { items: InventoryItem[] | null | undefined }) {
  const rows = (items ?? [])
    .map(lowStockView)
    .sort((a, b) => (a.stock ?? 0) - (a.min ?? 0) - ((b.stock ?? 0) - (b.min ?? 0)));

  return (
    <section aria-label="Running low" className="sh-low">
      <h2 className="sh-low__title">Running low</h2>
      {items === undefined && (
        <div aria-hidden>
          <div className="dn-skel sh-skel" />
          <div className="dn-skel sh-skel" />
        </div>
      )}
      {items === null && <p className="sh-note">{DASH} Stock levels couldn’t be reached just now.</p>}
      {items != null && items.length === 0 && <p className="sh-note">Nothing is running low. The cellar holds.</p>}
      {rows.length > 0 && (
        <>
          <p className="sh-hint">Swipe a row right, or tap it, to recount.</p>
          <ul className="sh-list">
            {rows.slice(0, 8).map((it) => (
              <SwipeRow key={it.id} item={it} />
            ))}
          </ul>
          {rows.length > 8 && (
            <Link to="/inventory" className="sh-more">
              and {rows.length - 8} more below minimum
            </Link>
          )}
        </>
      )}
    </section>
  );
}

export default function StaffHome() {
  const { user, activeRestaurantId } = useAuth();
  const spine = useDashboardSpine(activeRestaurantId);
  const firstName = user?.name?.split(' ')[0];
  const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="mudavym sh-page min-h-screen bg-paper-0 text-inkm-1">
      <div className="sh-wrap">
        <header className="sh-head">
          <p className="sh-date">{dateLine}</p>
          <h1 className="sh-title" style={{ fontFamily: SERIF }}>
            {firstName ? `Hello, ${firstName}` : 'Hello'}
            <span className="text-seal">.</span>
          </h1>
        </header>

        <nav aria-label="What to do" className="sh-actions">
          <Link to="/inventory" className="sh-action">
            <ClipboardList size={20} strokeWidth={1.75} aria-hidden />
            <span>Count</span>
          </Link>
          <Link to="/receiving" className="sh-action">
            <PackageCheck size={20} strokeWidth={1.75} aria-hidden />
            <span>Receive</span>
          </Link>
          <button type="button" className="sh-action" onClick={() => openAskAi()}>
            <MessageCircle size={20} strokeWidth={1.75} aria-hidden />
            <span>Ask</span>
          </button>
        </nav>

        <StaffLowStock items={spine.lowStock} />
      </div>
    </div>
  );
}
