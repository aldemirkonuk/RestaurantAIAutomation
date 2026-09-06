/**
 * HouseBand — "what the house did on its own", in the `--calm` idiom.
 *
 * The calm contract (the same one ReceivingNext's credit drafts keep): a card
 * in this band is VISUALLY INCAPABLE of looking like something that was sent.
 * The edge is dashed, the chip names the author, and the line underneath says
 * what has NOT happened. The only forward control is a human one.
 *
 * WHAT QUALIFIES, structurally rather than by tone: a `draft_ready`
 * notification — the inbound responder understood a vendor's mail and drafted
 * a reply it deliberately did not send
 * (`common/orchestrator/inbound-responder.service.ts:1287`).
 *
 * WHAT USED TO QUALIFY AND NO LONGER LIVES HERE: a pending one-tap action the
 * house raised for itself. Those moved to the dashboard rail on 2026-09-03 by
 * the founder's decision (`pages/dashboard/next/OneTapPanel.tsx`), because an
 * action with a next step is work, not a line in a book, and the day-book is a
 * record. This band therefore holds only rows the inbox itself carries — which
 * is why it can never be more complete than the inbox read that fed it.
 */

import { Link } from 'react-router-dom';
import { ArrowRight, PenLine, Stamp } from 'lucide-react';
import type { Notification } from '@/services/api/notifications';
import { MONO, SANS, SERIF, plainText, timeAgo } from './nt-format';

const DASHED = '1.5px dashed var(--seal-ring)';

function CalmChip({ children, icon: Icon }: { children: string; icon: typeof PenLine }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--seal-deep)',
        border: DASHED,
        borderRadius: 3,
        padding: '2px 6px',
      }}
    >
      <Icon size={10} strokeWidth={1.75} aria-hidden />
      {children}
    </span>
  );
}

function DraftCard({ row, onRuleOff }: { row: Notification; onRuleOff: () => void }) {
  const to = row.actionUrl?.startsWith('/') ? row.actionUrl : '/communications';
  const title = plainText(row.title);
  const message = plainText(row.message);
  return (
    <li
      className="rounded-xl px-3.5 py-3"
      style={{ border: DASHED, background: 'var(--paper-0)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CalmChip icon={PenLine}>Drafted by the house · unsent</CalmChip>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
          {timeAgo(row.timestamp ?? row.createdAt)}
        </span>
      </div>
      <p
        className="mt-2 text-[13.5px] font-semibold"
        style={{ fontFamily: SERIF, color: 'var(--ink-1)' }}
      >
        {title || 'A reply was drafted'}
      </p>
      <p className="mt-0.5 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {message || 'The house read the vendor’s mail and wrote a reply.'} Nothing has gone to
        the vendor — a person sends it, or nobody does.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Link
          to={to}
          className="nt-ink inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{ fontFamily: SANS, border: '1px solid var(--seal-ring)', color: 'var(--seal-deep)' }}
        >
          Read the draft before it goes
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onRuleOff}
          className="nt-ink inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{
            fontFamily: SANS,
            border: '1px solid var(--paper-2)',
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          <Stamp size={12} strokeWidth={1.75} aria-hidden />
          Rule it off
        </button>
      </div>
    </li>
  );
}

export interface HouseBandProps {
  drafts: Notification[];
  /** The inbox itself could not be read — so "nothing" here is not a finding. */
  bookUnreadable: boolean;
  onRuleOff: (id: string) => void;
}

export function HouseBand({ drafts, bookUnreadable, onRuleOff }: HouseBandProps) {
  return (
    <section aria-labelledby="nt-house" className="mt-6">
      <h2
        id="nt-house"
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        <PenLine size={12} strokeWidth={1.75} aria-hidden />
        What the house did on its own
      </h2>
      <ul className="mt-2 space-y-2">
        {drafts.map((row) => (
          <DraftCard key={row.id} row={row} onRuleOff={() => onRuleOff(row.id)} />
        ))}
      </ul>
      {drafts.length === 0 && bookUnreadable && (
        <p role="status" className="mt-2 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
          This band is empty because the inbox could not be read — not because the house has been
          idle.
        </p>
      )}
      {drafts.length === 0 && !bookUnreadable && (
        <p className="mt-2 text-[11.5px] italic" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          The house has not acted unasked on any line in this book. Drafted vendor replies land
          here, dashed and unsent, until a person decides.
        </p>
      )}
      <p className="mt-2 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        Standing one-tap actions — the ones the house raises for itself, and the ones you write —
        live on the{' '}
        <Link
          to="/"
          className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{ color: 'var(--seal-deep)' }}
        >
          dashboard rail
        </Link>
        , beside the approvals waiting on you.
      </p>
    </section>
  );
}

export default HouseBand;
