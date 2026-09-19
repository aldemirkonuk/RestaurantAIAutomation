/**
 * The bell, in the house's hand.
 *
 * WHY THIS IS A NEW COMPONENT AND NOT AN EDIT TO `Header.tsx`
 * ----------------------------------------------------------
 * The legacy header's bell (`components/layout/Header.tsx:129-329`) is already
 * gated: with a Mudavym page up it renders the house `Popover`. But the legacy
 * header is not rendered on any rebuilt page — `DashboardLayout.tsx:110` only
 * re-exports it, and no `pages/<page>/next` tree mounts it — so on a rebuilt page
 * that bell does not exist at all. Lifting it out of `Header.tsx` would mean
 * editing a file another session is holding and breaking ADR 0042's byte-for-
 * byte promise for every legacy page that still renders it. So this is a thin
 * component that reads the same registers through its own hook and leaves the
 * legacy header untouched.
 *
 * WHAT IT DOES DIFFERENTLY FROM THE LEGACY BELL, ON PURPOSE
 * --------------------------------------------------------
 * 1. The badge is the GATEWAY's unread count, not the length of the folded
 *    list the popover happens to hold (Header.tsx:52). A folded list is
 *    shorter than the book by construction, so the old badge under-counted
 *    every time a burst stacked.
 * 2. A count that could not be read is NOT zero. The badge shows a hollow
 *    marker and the popover says which read failed — ADR 0020.
 * 3. A folded line prints BOTH stamps, like the rebuilt page's rows
 *    (`BookRow.tsx:216-226`): the newest in the fold first, the surviving
 *    line's own age beneath it. `pickStackWinner` keeps the biggest burst, not
 *    the latest (`lib/notificationStack.ts:59-65`), so one stamp alone can
 *    show a two-day-old alert as if it were this morning's.
 */

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Popover } from './Sheet';
import { useBellBook, BELL_PAGE, type FoldFreshness } from '../../lib/mudavym/useBellBook';
import {
  ApproveFromBellPanel,
  orderIdOf,
} from '../notifications/ApproveFromBellPanel';
import { stackedNotificationLabel } from '../../lib/notificationStack';
import type { Notification } from '../../services/api/notifications';

const EM = '—';

/**
 * Relative age, in the same words the rebuilt page uses
 * (`pages/notifications/next/nt-format.ts:61-74`; copied, not imported —
 * a shared component may not reach into a page directory).
 */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Stamps({ row, fold }: { row: Notification; fold?: FoldFreshness }) {
  const own = timeAgo(row.timestamp ?? row.createdAt);
  if (!fold?.winnerIsStale || fold.newestAt === null) {
    return <span className="mdv-hdr__stamp">{own}</span>;
  }
  return (
    <span className="mdv-hdr__stamp">
      <span className="mdv-hdr__stamp-lead">{timeAgo(new Date(fold.newestAt).toISOString())}</span>
      <span className="mdv-hdr__stamp-own">this line {own}</span>
    </span>
  );
}

export function HouseBell() {
  const [open, setOpen] = useState(false);
  /**
   * THE HAND-OFF (founder, 2026-09-04; built 2026-09-06, packet 2).
   *
   * The bell is a menu and the seal never sits in one — a popover is dismissed
   * by clicking anywhere, so a commitment reached inside it is one stray click
   * from being half-made. A line that names an order offers "Approve it", the
   * popover CLOSES, and the panel opens in a room that cannot be dismissed by
   * accident.
   */
  const [approving, setApproving] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const book = useBellBook(open);

  const { register, unread, unreadNote, foldedCount, foldedById, folds, items, hasMore } = book;

  /* The badge. Three states and no fourth: a number the register gave, a
     hollow marker for "not read", and nothing at all for a real zero. */
  const badge =
    unread === null ? (
      <span className="mdv-hdr__badge mdv-hdr__badge--unknown" aria-hidden />
    ) : unread > 0 ? (
      <span className="mdv-hdr__badge">{unread}</span>
    ) : null;

  const triggerLabel =
    unread === null
      ? 'Notifications — the unread count could not be read'
      : unread > 0
        ? `Notifications (${unread} unread)`
        : 'Notifications (nothing unread)';

  /* The eyebrow says how much of the book this is, in the register's own
     figures. Never a derived guess: an unknown prints as an em dash. */
  const shown = items.length;
  const eyebrow =
    register.state === 'ready'
      ? [
          `${unread === null ? EM : unread} unread`,
          foldedCount > 0 ? `${shown} lines after folding ${foldedCount}` : null,
          hasMore ? `newest ${BELL_PAGE} shown` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'The bell';

  return (
    <div className="mdv-hdr__slot">
      <button
        ref={triggerRef}
        type="button"
        className="mdv-hdr__btn mdv-hdr__btn--bell"
        onClick={() => setOpen((o) => !o)}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={17} strokeWidth={1.75} aria-hidden />
        {badge}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label="Notifications"
        width={350}
        eyebrow={eyebrow}
        title="Notifications"
        showClose={false}
        action={
          register.state === 'ready' && items.length > 0 ? (
            <button type="button" className="mdv-link" onClick={book.markAllRead}>
              Rule all off
            </button>
          ) : null
        }
        footer={
          <span className="mdv-hdr__bellfoot">
            <button
              type="button"
              className="mdv-link"
              onClick={() => {
                navigate('/notifications');
                setOpen(false);
              }}
            >
              Read the whole book
            </button>
            {unreadNote ? <span className="mdv-hdr__note">{unreadNote}</span> : null}
          </span>
        }
      >
        {book.actionNote ? (
          <p className="mdv-note" role="status">
            {book.actionNote}
          </p>
        ) : null}

        {register.state === 'loading' ? (
          <p className="mdv-quiet">Reading the register…</p>
        ) : register.state === 'unreadable' ? (
          <p className="mdv-note" role="status">
            {register.failure.forbidden
              ? `Your account is not allowed to read this house’s notifications (${register.failure.status ?? 'refused'}). This is not an empty book — it is a closed one.`
              : `The notifications register could not be read (${register.failure.message}). Nothing below is a claim that the house is quiet.`}
          </p>
        ) : items.length === 0 ? (
          unread !== null && unread > 0 ? (
            <p className="mdv-note" role="status">
              The count says {unread} unread, but the register returned no lines. The two do not
              agree, so neither is shown as fact.
            </p>
          ) : (
            <p className="mdv-quiet">Nothing unread. The bell is quiet.</p>
          )
        ) : (
          items.map((n) => {
            const sub = stackedNotificationLabel(n, foldedById[n.id]);
            /* Only a line that NAMES an order gets the hand-off. No producer
               writes an order id onto a notification today (notifications.md
               §9), so this control is rare rather than decorative — a button
               that opened an empty room would be the fault, not its absence. */
            const orderId = orderIdOf(n.metadata);
            return (
              <div key={n.id}>
              <button
                type="button"
                className="mdv-item mdv-hdr__bellrow"
                data-active={n.status === 'unread'}
                onClick={() => {
                  book.markRead(n.id);
                  navigate('/notifications', { state: { selectedNotificationId: n.id } });
                  setOpen(false);
                }}
              >
                <span
                  className="mdv-dot"
                  aria-hidden
                  style={n.status === 'unread' ? { background: 'var(--seal)' } : undefined}
                />
                <span className="mdv-item__text">
                  <span className="mdv-item__label mdv-hdr__wrap">{n.title}</span>
                  {sub && <span className="mdv-item__sub">{sub}</span>}
                </span>
                <Stamps row={n} fold={folds[n.id]} />
              </button>
              {orderId ? (
                <button
                  type="button"
                  className="mdv-link"
                  data-testid="bell-approve-open"
                  onClick={() => {
                    // The popover closes FIRST. A panel opened over a live
                    // menu leaves the menu's dismiss-on-any-click behind it.
                    setOpen(false);
                    setApproving(orderId);
                  }}
                >
                  Approve it
                </button>
              ) : null}
              </div>
            );
          })
        )}
      </Popover>

      {/* The room the bell hands off to. Outside the Popover on purpose: it
          must outlive the menu that opened it. */}
      <ApproveFromBellPanel
        open={approving !== null}
        orderId={approving}
        onClose={() => setApproving(null)}
        onApproved={() => book.refresh()}
      />
    </div>
  );
}

export default HouseBell;
