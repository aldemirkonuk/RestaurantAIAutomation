/**
 * NotificationsNext — the Mudavym redesign of `/notifications`, behind
 * `mudavym_design_notifications` (ADR 0044 p4 wave).
 *
 * The verdict, quoted (MAKEOVER-VERDICTS.md:75-82):
 *
 *   "`/notifications` needs re-transformations. Neither drawn direction is the
 *    answer… What survives as *inspiration only*: Federation's density — it
 *    shows more of what is actually happening — and Editorial's way of
 *    **subduing the already-handled** items so the page quiets down as it is
 *    worked. The handling of the problem was called *'really good'*; the
 *    execution was not enough."
 *
 * THE STRUCTURE THAT ENFORCES IT — one book, three registers, one direction of
 * travel. A line is never removed from the page by working it; it moves down.
 *
 *   1. Needs a hand      — unread lines, oldest first, full ink.
 *   2. What the house did on its own — the `--calm` band: dashed, unsent,
 *      author named, a human control beside it (approve · undo).
 *   3. Ruled off         — under the double rule, subdued to ink-3.
 *
 * Density is spent on the collapsed line (register · title · the row's own
 * message · folded duplicates · age) and on the rail's per-register tally,
 * not on decoration. Quiet is spent on band 3.
 *
 * HONESTY (ADR 0020, and the page's own §12 defect list). The legacy page
 * discarded `error` at `pages/Notifications.tsx:157`, so a 500 or a 401
 * rendered as an empty inbox forever while the poll retried in silence — a
 * watchdog that could not say it was blind. Here every register carries
 * loading / unreadable / ready, a refusal is told apart from a breakage, and
 * the book states how much of itself it is showing (the gateway pages at 100
 * and the legacy client threw the envelope away).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Seal, Wordmark } from '@/components/mudavym';
import { animate, ink, settle, springs, tally, useReducedMotion } from '@/lib/mudavym';
import type { Notification } from '@/services/api/notifications';
import BookRow from './BookRow';
import { HouseBand, OneTapDesk } from './HouseBand';
import { EM, KIND_ORDER, MONO, SANS, SERIF, ensureFraunces, isHouseActed, kindOf } from './nt-format';
import { POLL_MS, useNotificationsNextData } from './useNotificationsNextData';

/* ── figures arrive on the tally spring; an unknown never counts ────────── */

function tallyAt(t: number): number {
  const s = springs.tally.samples;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const pos = t * (s.length - 1);
  const i = Math.floor(pos);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
}

function Tally({ value }: { value: number | null }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(value);
  const from = useRef<number | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (value === null) {
      from.current = null;
      setShown(null);
      return;
    }
    const start = from.current ?? 0;
    from.current = value;
    if (reduced || start === value) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = tallyAt((now - t0) / tally.ms);
      setShown(start + (value - start) * p);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else setShown(value);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, reduced]);

  return (
    <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
      {shown === null ? EM : String(Math.round(shown))}
    </span>
  );
}

/**
 * The page's only stylesheet. Durations and easings are interpolated FROM the
 * tokens, so what runs on screen is the token and not a copy of it.
 *
 * Ink choice, measured rather than felt: `--ink-3` is 4.37:1 on `--paper-0`
 * and 4.07:1 on `--paper-1` — under AA for text this size — so every secondary
 * string on this page is `--ink-4` instead (6.05:1 paper / 7.46:1 charcoal)
 * and `--ink-3` is not used anywhere in this directory — grep it. Subduing a
 * ruled-off line is done with weight and the ink-1 → ink-4 step, not by
 * dropping under the contrast floor. Chip labels are ink or the seal, never a
 * semantic hue: the register chip is `--ink-4`, the calm chip `--seal-deep`
 * (7.80:1 paper / 9.46:1 charcoal).
 */
const PAGE_CSS = `
.nt-expand { display: grid; grid-template-rows: 0fr; transition: grid-template-rows ${settle.ms}ms ${settle.easing} }
.nt-expand[data-open='true'] { grid-template-rows: 1fr }
.nt-expand > * { min-height: 0; overflow: hidden }
.nt-ink { transition: border-color ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing} }
.nt-line { border-bottom: 1px solid var(--paper-2) }
.nt-line:hover { background: var(--paper-1) }
.nt-line[data-subdued='true']:hover { background: transparent }
.nt-chev { display: inline-block; font-size: 14px; color: var(--ink-4); transition: transform ${settle.ms}ms ${settle.easing} }
.nt-chev[data-open='true'] { transform: rotate(90deg) }
.nt-rule2 { border-top: 1px solid var(--ink-4); box-shadow: 0 3px 0 -2px var(--ink-4) }
.nt-skel { background: var(--paper-2); border-radius: 3px }
@media (prefers-reduced-motion: reduce) {
  .nt-expand, .nt-ink, .nt-chev { transition: none !important }
}
`;

export interface NotificationsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function NotificationsNext({ ground }: NotificationsNextProps) {
  const data = useNotificationsNextData();
  const location = useLocation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRuledOff, setShowRuledOff] = useState(false);
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
      settle,
    );
  }, []);

  // The header bell hands over one line to open (Header.tsx:191,226).
  const wanted = (location.state as { selectedNotificationId?: string } | null)
    ?.selectedNotificationId;
  useEffect(() => {
    if (wanted) setOpenId(wanted);
  }, [wanted]);

  const bands = useMemo(() => {
    const items = data.stack.items;
    const drafts: Notification[] = [];
    const needs: Notification[] = [];
    const ruled: Notification[] = [];
    for (const n of items) {
      const status = String(n.status);
      if (status === 'unread' && !data.setAside.has(n.id)) {
        if (isHouseActed(n)) drafts.push(n);
        else needs.push(n);
      } else if (status !== 'unread') {
        ruled.push(n);
      }
    }
    const age = (n: Notification) => new Date(n.timestamp ?? n.createdAt).getTime() || 0;
    needs.sort((a, b) => age(a) - age(b)); // oldest first — the sidebar's promise
    ruled.sort((a, b) => age(b) - age(a));
    drafts.sort((a, b) => age(a) - age(b));
    return { drafts, needs, ruled };
  }, [data.stack.items, data.setAside]);

  const registerTally = useMemo(() => {
    const counts = new Map<string, { open: number; all: number }>();
    for (const n of data.stack.items) {
      const k = kindOf(n.type);
      const cur = counts.get(k) ?? { open: 0, all: 0 };
      cur.all += 1;
      if (String(n.status) === 'unread') cur.open += 1;
      counts.set(k, cur);
    }
    return KIND_ORDER.map((k) => ({ kind: k, ...(counts.get(k) ?? { open: 0, all: 0 }) })).filter(
      (r) => r.all > 0,
    );
  }, [data.stack.items]);

  const ready = data.book.register.state === 'ready';
  const failure = data.book.register.state === 'unreadable' ? data.book.register.failure : null;
  const houseActions =
    data.actions.state === 'ready'
      ? data.actions.rows.filter((a) => a.status === 'pending' && !a.userId)
      : [];
  const myActions =
    data.actions.state === 'ready'
      ? data.actions.rows.filter((a) => a.status === 'pending' && !!a.userId)
      : [];

  const onPage = ready ? data.stack.items.length : null;
  const needCount = ready ? bands.needs.length + bands.drafts.length : null;

  let standing: string;
  if (failure) {
    standing = failure.forbidden
      ? 'This account is not allowed to read the book. Nothing below is claimed — the house may be busy or calm, and this page cannot tell you which.'
      : `The book could not be read (${failure.message}). Nothing below is claimed — an unread page is not a quiet house.`;
  } else if (!ready) {
    standing = 'Opening the book…';
  } else if ((needCount ?? 0) === 0) {
    standing = 'Nothing is waiting on you. Every line in the book has been ruled off.';
  } else {
    standing = `${needCount} ${needCount === 1 ? 'line needs' : 'lines need'} a hand.`;
  }

  const dateLine = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      className="mudavym min-h-full"
      data-ground={ground}
      style={{ background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}
    >
      <style>{PAGE_CSS}</style>
      <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
        <header ref={headRef} className="mb-5">
          <Wordmark size={13} />
          <p className="mt-1 text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-4)' }}>
            {dateLine} · the house’s day-book
          </p>
          <h1
            className="mt-1 text-[30px] leading-tight sm:text-[36px]"
            style={{ fontFamily: SERIF, fontWeight: 420, letterSpacing: '-0.015em' }}
          >
            What the house noticed<span style={{ color: 'var(--seal)' }}>.</span>
          </h1>
          <p
            className="mt-1 text-[14.5px]"
            style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'var(--ink-2)' }}
          >
            {standing}
          </p>
        </header>

        {failure && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
          >
            <span className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
              {failure.forbidden
                ? `The notifications register refused this account (${failure.status ?? 'refused'}). Retrying will not change that — an owner or manager account can read it.`
                : `The notifications register could not be read (${failure.message}). The book is unknown, not empty.`}
            </span>
            {!failure.forbidden && (
              <button
                type="button"
                onClick={data.refresh}
                className="nt-ink rounded-lg px-3 py-1.5 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                style={{
                  border: '1px solid var(--seal-ring)',
                  background: 'transparent',
                  color: 'var(--seal-deep)',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {data.failureNote && (
          <p
            role="status"
            className="mb-3 text-[12px]"
            style={{ color: 'var(--ink-2)', fontFamily: SANS }}
          >
            {data.failureNote}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── the book ──────────────────────────────────────────────── */}
          <div>
            <section aria-labelledby="nt-needs">
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id="nt-needs"
                  className="text-[11px] uppercase tracking-[0.14em]"
                  style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
                >
                  Needs a hand
                </h2>
                {bands.needs.length > 0 && (
                  <button
                    type="button"
                    onClick={data.markAllRead}
                    title="Every unread line in THIS restaurant's book, including pages not on screen. No other restaurant is touched."
                    className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                    style={{
                      border: '1px solid var(--paper-2)',
                      background: 'transparent',
                      color: 'var(--ink-2)',
                      cursor: 'pointer',
                    }}
                  >
                    Rule off every open line
                  </button>
                )}
              </div>

              {!ready && !failure && (
                <div className="mt-2 space-y-1.5">
                  <div className="nt-skel h-11" aria-hidden />
                  <div className="nt-skel h-11 w-5/6" aria-hidden />
                  <div className="nt-skel h-11 w-4/6" aria-hidden />
                </div>
              )}

              {ready && bands.needs.length === 0 && (
                <p className="mt-2 text-[12px] italic" style={{ color: 'var(--ink-4)' }}>
                  Nothing here. New lines land at the top of this band the moment they are written.
                </p>
              )}

              {failure && (
                <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-4)' }}>
                  This band is empty because the register could not be read — not because nothing
                  needs a hand.
                </p>
              )}

              <ul className="mt-2" style={{ borderTop: '1px solid var(--paper-2)' }}>
                {bands.needs.map((n) => (
                  <BookRow
                    key={n.id}
                    row={n}
                    folded={data.stack.foldedById[n.id] ?? 0}
                    open={openId === n.id}
                    onToggle={() => setOpenId(openId === n.id ? null : n.id)}
                    onRuleOff={() => data.markRead(n.id)}
                    onSetAside={() => data.putAside(n.id)}
                    onArchive={() => data.archive(n.id)}
                    onDelete={() => data.remove(n.id)}
                  />
                ))}
              </ul>
            </section>

            <HouseBand
              drafts={bands.drafts}
              houseActions={houseActions}
              actions={data.actions}
              bookUnreadable={failure !== null}
              onRuleOff={data.markRead}
              onExecute={data.executeAction}
              onCancel={data.cancelAction}
            />

            {/* ── the double rule: the account is ruled off ─────────────── */}
            <section aria-labelledby="nt-ruled" className="mt-7">
              <div className="nt-rule2" />
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <h2
                  id="nt-ruled"
                  className="text-[11px] uppercase tracking-[0.14em]"
                  style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
                >
                  Ruled off
                </h2>
                <button
                  type="button"
                  onClick={() => setShowRuledOff((s) => !s)}
                  aria-expanded={showRuledOff}
                  className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                  style={{
                    border: '1px solid var(--paper-2)',
                    background: 'transparent',
                    color: 'var(--ink-2)',
                    cursor: 'pointer',
                  }}
                >
                  {showRuledOff ? 'Close the account' : `Show ${ready ? bands.ruled.length : EM}`}
                </button>
              </div>
              <div className="nt-expand" data-open={showRuledOff}>
                <div>
                  {ready && bands.ruled.length === 0 ? (
                    <p className="mt-2 text-[12px] italic" style={{ color: 'var(--ink-4)' }}>
                      Nothing has been ruled off on this page yet.
                    </p>
                  ) : (
                    <ul className="mt-2" style={{ borderTop: '1px solid var(--paper-2)' }}>
                      {bands.ruled.map((n) => (
                        <BookRow
                          key={n.id}
                          row={n}
                          folded={data.stack.foldedById[n.id] ?? 0}
                          open={openId === n.id}
                          onToggle={() => setOpenId(openId === n.id ? null : n.id)}
                          subdued
                          onReopen={() => data.markUnread(n.id)}
                          onDelete={() => data.remove(n.id)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {data.setAside.size > 0 && (
              <p className="mt-4 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
                {data.setAside.size} {data.setAside.size === 1 ? 'line is' : 'lines are'} set aside
                on this browser only — the server was not told, and another device still shows
                {data.setAside.size === 1 ? ' it' : ' them'}.{' '}
                <button
                  type="button"
                  onClick={data.restoreAside}
                  className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                  style={{ background: 'none', border: 'none', color: 'var(--seal-deep)', cursor: 'pointer' }}
                >
                  Put them back
                </button>
              </p>
            )}
          </div>

          {/* ── the rail ──────────────────────────────────────────────── */}
          <aside className="space-y-4">
            <section
              aria-labelledby="nt-registers"
              className="rounded-xl p-3.5"
              style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
            >
              <div className="flex items-center gap-2">
                <Seal size={16} />
                <h2
                  id="nt-registers"
                  className="text-[11px] uppercase tracking-[0.14em]"
                  style={{ fontFamily: MONO, color: 'var(--ink-1)' }}
                >
                  On this page
                </h2>
              </div>
              <dl className="mt-2.5 space-y-1">
                {registerTally.map((r) => (
                  <div key={r.kind} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <dt style={{ color: 'var(--ink-2)' }}>{r.kind}</dt>
                    <dd className="m-0" style={{ color: 'var(--ink-4)' }}>
                      <span style={{ color: r.open > 0 ? 'var(--ink-1)' : 'var(--ink-4)' }}>
                        <Tally value={r.open} />
                      </span>
                      <span style={{ fontFamily: MONO }}> / {r.all}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {ready && registerTally.length === 0 && (
                <p className="mt-2 text-[12px] italic" style={{ color: 'var(--ink-4)' }}>
                  The book is open and empty.
                </p>
              )}
              {!ready && <div className="nt-skel mt-2 h-16" aria-hidden />}
              <p className="mt-2.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                {ready ? (
                  <>
                    Showing <Tally value={onPage} /> of{' '}
                    {data.book.total === null ? EM : data.book.total} lines the register holds
                    {data.book.hasMore ? ' — older pages are in the book, not on this screen.' : '.'}
                    {data.stack.foldedCount > 0 &&
                      ` ${data.stack.foldedCount} repeat${data.stack.foldedCount === 1 ? '' : 's'} folded into the ${data.stack.foldedCount === 1 ? 'line it repeats' : 'lines they repeat'}.`}
                  </>
                ) : (
                  <>How much of the book is on screen is not known yet.</>
                )}
              </p>
              {ready && data.book.hasMore && (
                <button
                  type="button"
                  onClick={data.readFurtherBack}
                  className="nt-ink mt-2 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                  style={{
                    border: '1px solid var(--seal-ring)',
                    background: 'transparent',
                    color: 'var(--seal-deep)',
                    cursor: 'pointer',
                  }}
                >
                  Read further back
                </button>
              )}
            </section>

            <section
              aria-labelledby="nt-live"
              className="rounded-xl p-3.5"
              style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
            >
              <h2
                id="nt-live"
                className="text-[11px] uppercase tracking-[0.14em]"
                style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
              >
                How this page reads
              </h2>
              <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
                The book is re-read every {POLL_MS / 1000} seconds while this page is open, so a
                stacked digest updates in place rather than going stale.
              </p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                Last read{' '}
                <span style={{ fontFamily: MONO }}>
                  {data.lastReadAt
                    ? data.lastReadAt.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : EM}
                </span>
                {data.refreshing ? ' · reading now' : ''}
              </p>
              <button
                type="button"
                onClick={data.refresh}
                className="nt-ink mt-2 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                style={{
                  border: '1px solid var(--paper-2)',
                  background: 'transparent',
                  color: 'var(--ink-2)',
                  cursor: 'pointer',
                }}
              >
                Read it now
              </button>
            </section>

            <OneTapDesk
              mine={myActions}
              actions={data.actions}
              onExecute={data.executeAction}
              onCancel={data.cancelAction}
              onCreate={data.createAction}
            />
          </aside>
        </div>

        <footer
          className="mt-10 flex flex-wrap items-baseline justify-between gap-3 pt-4"
          style={{ borderTop: '1px solid var(--paper-2)' }}
        >
          <Wordmark size={14} />
          <p className="max-w-[560px] text-[11px]" style={{ color: 'var(--ink-4)' }}>
            Set-aside is stored in this browser and nowhere else. Marking a one-tap action done
            records the decision against your name — it does not itself place an order or send a
            mail.
          </p>
        </footer>
      </div>
    </div>
  );
}
