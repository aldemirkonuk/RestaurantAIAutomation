/**
 * What narrows the book, and who does the narrowing.
 *
 * The line down the middle of this component is the honest one: some of these
 * controls change what the REGISTER returns, and one changes only what this
 * screen draws. They are drawn apart and labelled, because a filtered count
 * means two completely different things either side of that line.
 *
 *   REGISTER-SIDE  type · status — `GetNotificationsQueryDto`
 *                  (`notifications/dto/notifications.dto.ts:63-70`), applied
 *                  as `eq` in `notifications.service.ts:811-817`. Verified
 *                  live on 2026-09-03 against the dev tenant:
 *                  unfiltered `total` 140, `type=report` 7,
 *                  `status=read` 0, `type=inventory_low_stock&status=unread`
 *                  133. The `total` that comes back is the filtered total.
 *
 *   SCREEN-SIDE    the search box — it narrows the rows already loaded, the
 *                  way Linear's inbox quick search does
 *                  (https://linear.app/docs/inbox, Cmd/Ctrl-F, "narrow
 *                  notifications by fields such as issue title…"). There is
 *                  no full-text search on this table, so the page says the
 *                  search covers what is on screen and nothing further back.
 *
 *   Hide-read is screen-side too, but it is a fold rather than a filter: the
 *   ruled-off band collapses, its count stays visible, and nothing is thrown
 *   away. Notion's inbox calls the same control "Archive read"; Linear calls
 *   it "Show read" (https://www.notion.com/help/updates-and-notifications;
 *   https://linear.app/docs/inbox).
 */

import { EyeOff, ListFilter, Search, X } from 'lucide-react';
import type { BookFilters } from './useNotificationsNextData';
import { TYPE_CHOICES } from './nt-book';
import { MONO, SANS, iconForKind } from './nt-format';


const STATUS_CHOICES: Array<{ value: BookFilters['status']; label: string }> = [
  { value: null, label: 'Every line' },
  { value: 'unread', label: 'Still open' },
  { value: 'read', label: 'Ruled off' },
  { value: 'archived', label: 'Archived' },
];

export interface BookFilterBarProps {
  filters: BookFilters;
  onFilters: (next: BookFilters) => void;
  query: string;
  onQuery: (q: string) => void;
  hideRead: boolean;
  onHideRead: (v: boolean) => void;
  /** How many loaded lines the search is currently matching. */
  matching: number | null;
  /** How many the register says exist under the register-side filters. */
  registerTotal: number | null;
  searchRef?: React.Ref<HTMLInputElement>;
}

function Pill({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className="nt-ink inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
      style={{
        fontFamily: SANS,
        border: `1px solid ${on ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
        background: on ? 'var(--seal-tint)' : 'transparent',
        color: on ? 'var(--seal-deep)' : 'var(--ink-2)',
        fontWeight: on ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function BookFilterBar({
  filters,
  onFilters,
  query,
  onQuery,
  hideRead,
  onHideRead,
  matching,
  registerTotal,
  searchRef,
}: BookFilterBarProps) {
  return (
    <section aria-labelledby="nt-narrow" className="mb-4">
      <h2 id="nt-narrow" className="sr-only">
        Narrow the book
      </h2>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]"
          style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
        >
          <ListFilter size={11} strokeWidth={1.75} aria-hidden />
          Register
        </span>
        <Pill on={filters.type === null} onClick={() => onFilters({ ...filters, type: null })}>
          All
        </Pill>
        {TYPE_CHOICES.map((c) => {
          const Mark = iconForKind(c.kind);
          const on = filters.type === c.type;
          return (
            <Pill
              key={c.type}
              on={on}
              onClick={() => onFilters({ ...filters, type: on ? null : c.type })}
            >
              <Mark size={11} strokeWidth={1.75} aria-hidden />
              {c.label}
            </Pill>
          );
        })}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {STATUS_CHOICES.map((c) => (
          <Pill
            key={c.label}
            on={filters.status === c.value}
            onClick={() => onFilters({ ...filters, status: c.value })}
          >
            {c.label}
          </Pill>
        ))}

        <label
          className="ml-1 inline-flex min-w-[190px] flex-1 items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-0)' }}
        >
          <Search size={12} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-4)' }} />
          <span className="sr-only">Search the lines on this screen</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search what is on screen"
            className="w-full bg-transparent text-[11.5px] outline-none"
            style={{ fontFamily: SANS, color: 'var(--ink-1)' }}
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => onQuery('')}
              aria-label="Clear the search"
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)' }}
            >
              <X size={12} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </label>

        <Pill on={hideRead} onClick={() => onHideRead(!hideRead)}>
          <EyeOff size={11} strokeWidth={1.75} aria-hidden />
          Hide what is ruled off
        </Pill>
      </div>

      <p className="mt-1.5 text-[10.5px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        Register, status and the day are the register&rsquo;s own filters, so the count they
        produce is the register&rsquo;s
        {registerTotal !== null ? (
          <>
            {' '}
            — it holds{' '}
            <span style={{ fontFamily: MONO, color: 'var(--ink-2)' }}>{registerTotal}</span> lines
            under the ones set now
          </>
        ) : null}
        . The search box and the hide-read fold work on the lines already on this screen
        {query.trim() !== '' && matching !== null ? (
          <>
            {' '}
            — <span style={{ fontFamily: MONO, color: 'var(--ink-2)' }}>{matching}</span> of them
            match
          </>
        ) : null}
        ; there is no full-text search behind this table, so a word that appears only on a page
        nobody has read will not be found until it is.
      </p>
    </section>
  );
}

export default BookFilterBar;
