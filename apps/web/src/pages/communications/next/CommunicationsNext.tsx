/**
 * CommunicationsNext — the Mudavym redesign of `/communications` (ADR 0045 §5
 * wave, MAKEOVER-VERDICTS: MERGE with a warning on both sides).
 *
 * The verdict, enforced: today's page won on at-a-glance completeness ("shows
 * basically everything"); the redesign lost on "too much text". So the page
 * leads with a four-figure glance strip (all derived from live queries, each
 * an em dash until its query answers), the conversation book is a ledger of
 * short rows — prose lives inside the expansion, never on the row — and the
 * founder's two named additions are built in: the channels rail makes the
 * page's integrations visible, and the template builders open inside a sheet
 * whose header says exactly what is going on (TemplateSheet).
 *
 * Honesty rules: an AI draft can never look sent (prc-02) — draft rows wear
 * "AI draft · not sent"; unknown figures are em dashes; a gateway failure is
 * said in words.
 *
 * Motions (06-pages/communications.md §1b): row expand = settle; glance and
 * hover = ink. Nothing else moves.
 */

import { useState } from 'react';
import { Wordmark } from '@/components/mudavym';
import type { ProcurementHistoryItem } from '../../../hooks/queries/useConversationQueries';
import { ink, settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, draftChipText, fmtCadence, fmtWhen, sendState } from './cm-format';
import { TemplateSheet, type TemplateChannel } from './TemplateSheet';
import { useCommsNextData } from './useCommsNextData';

const TYPE_LABELS: Record<string, string> = {
  PRICE_INQUIRY: 'Price inquiry',
  DEMAND_OFFER: 'Demand offer',
  PROMO_INQUIRY: 'Promo inquiry',
  WINE_INQUIRY: 'Wine inquiry',
  COUNTER_OFFER: 'Counter offer',
  CLARIFICATION: 'Clarification',
  ACCEPTANCE_CONFIRM_REQUEST: 'Acceptance',
  ESCALATION: 'Escalation',
  ORDER_CONFIRMATION: 'Order confirmation',
  MANUAL_REPLY: 'Manual reply',
};

function GlanceFigure({
  label,
  value,
  floor = false,
}: {
  label: string;
  value: number | null;
  /** True when the figure is a floor (its source window was truncated). */
  floor?: boolean;
}) {
  return (
    <div style={{ minWidth: 96 }}>
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-1, #211C16)',
        }}
      >
        {value === null ? EM : floor ? `≥${value}` : value}
      </span>
    </div>
  );
}

function StateChip({ status }: { status: string }) {
  const state = sendState(status);
  const looks =
    state === 'draft'
      ? { text: draftChipText(status), bg: 'var(--paper-2, #EAE4D8)', fg: 'var(--ink-2, #4F473C)', dashed: true }
      : state === 'sent'
        ? { text: 'Sent', bg: 'var(--seal-tint, rgba(26,94,107,.10))', fg: 'var(--seal-deep, #14515C)', dashed: false }
        : state === 'closed'
          ? { text: 'Closed', bg: 'transparent', fg: 'var(--ink-3, #7C7365)', dashed: false }
          : { text: status.toLowerCase(), bg: 'transparent', fg: 'var(--ink-3, #7C7365)', dashed: false };
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 4,
        background: looks.bg,
        color: looks.fg,
        border: looks.dashed ? '1px dashed var(--ink-3, #7C7365)' : '1px solid transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {looks.text}
    </span>
  );
}

function LedgerRow({ item }: { item: ProcurementHistoryItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="cm-row flex w-full items-baseline gap-3 py-2.5 text-left"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: SANS,
          transition: `background ${ink.ms}ms ${ink.easing}`,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3, #7C7365)', minWidth: 44 }}>
          {fmtWhen(item.sentAt ?? item.createdAt)}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1, #211C16)' }}>
          {item.providerName ?? EM}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          {TYPE_LABELS[item.emailType] ?? item.emailType.toLowerCase()}
          {item.wineName ? ` · ${item.wineName}` : ''}
          {item.quantity !== null ? ` · ${item.quantity}` : ''}
        </span>
        <span className="ml-auto" />
        <StateChip status={item.status} />
      </button>
      {open && (
        <div
          className="pb-3 pl-14 pr-2"
          style={{
            fontFamily: SANS,
            animation: `cm-settle ${settle.ms}ms ${settle.easing} both`,
          }}
        >
          {item.rollingSummary && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', maxWidth: '68ch', margin: '0 0 8px' }}>
              {item.rollingSummary}
            </p>
          )}
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-2, #4F473C)',
              whiteSpace: 'pre-wrap',
              maxWidth: '68ch',
              maxHeight: 220,
              overflowY: 'auto',
              margin: 0,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--paper-1, #F3EFE6)',
              border:
                sendState(item.status) === 'draft'
                  ? '1px dashed var(--ink-3, #7C7365)'
                  : '1px solid var(--paper-2, #EAE4D8)',
            }}
          >
            {item.draftContent || 'No message body was recorded for this exchange.'}
          </p>
          {item.constraintFlags && item.constraintFlags.hard.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
              Held by rule: {item.constraintFlags.hard.join(', ')}
            </p>
          )}
          <p style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
            {item.orderNumber ? `order ${item.orderNumber} · ` : ''}round {item.roundCount}
          </p>
        </div>
      )}
    </div>
  );
}

export default function CommunicationsNext() {
  const data = useCommsNextData();
  const [sheet, setSheet] = useState<TemplateChannel | null>(null);

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <style>{`
        @keyframes cm-settle { from { transform: translateY(-4px); opacity: 0 } to { transform: none; opacity: 1 } }
        .cm-row { transition: background ${ink.ms}ms ${ink.easing} }
        .cm-row:hover { background: var(--paper-1, #F3EFE6) }
        .cm-row:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: -2px }
        /* the two template-workshop buttons rest on a card fill rather than
           transparent — the value lives here, not inline, so .cm-row:hover
           above still governs them instead of being dead-cascaded under a
           style attribute (2026-08-31 follow-up to the wave-polish pass). */
        .cm-card { background: var(--paper-0, #FAF7F1) }
        @media (prefers-reduced-motion: reduce) { .cm-row, [style*="cm-settle"] { animation: none !important; transition: none !important } }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.1,
                margin: '4px 0 0',
              }}
            >
              Communications
            </h1>
          </div>
          {/* the at-a-glance strip the old page earned its keep with */}
          <div className="flex flex-wrap gap-6">
            <GlanceFigure label="Threads" value={data.glance.threads} />
            <GlanceFigure label="Drafts waiting" value={data.glance.draftsPending} />
            <GlanceFigure
              label="Sent · 30 days"
              value={data.glance.sentLast30}
              floor={data.glance.sentLast30Truncated}
            />
            <GlanceFigure label="Report schedules" value={data.glance.schedules} />
          </div>
        </header>

        {data.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
              {data.hasData
                ? `The conversation book could not be refreshed (${data.errorMessage}) — its rows and figures show the last answer, not the present. Figures from other sources keep their own state.`
                : `The conversation book could not be reached (${data.errorMessage}) — its figures show ${EM}; the other figures come from their own sources and keep their own state.`}
            </span>
            <button
              type="button"
              onClick={data.refetch}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* ── the conversation book ─────────────────────────────────── */}
          <section aria-label="Conversation book">
            {!data.hasData && !data.isError ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
                Reaching the gateway…
              </p>
            ) : data.rows.length === 0 && !data.isError ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
                The book is open and empty — no vendor exchanges yet.
              </p>
            ) : (
              <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                {data.rows.map((item) => (
                  <LedgerRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          {/* ── the channels rail: what this page is wired to ─────────── */}
          <aside className="flex flex-col gap-4" style={{ fontFamily: SANS }}>
            <div
              className="rounded-xl p-4"
              style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <h2
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3, #7C7365)',
                  margin: '0 0 8px',
                }}
              >
                Channels & templates
              </h2>
              <p style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 10px' }}>
                {data.gmailWatchConfigured === null
                  ? `Gmail inbound watch: ${EM} — the gateway hasn't answered yet.`
                  : data.gmailWatchConfigured
                    ? 'Gmail inbound watch: configured — vendor replies reach this page.'
                    : 'Gmail inbound watch: NOT configured — vendor replies will not arrive until it is.'}
                {' '}SMS templates stage for the messaging channel; its connection state is not
                reported here.
              </p>
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => setSheet('gmail')} className="cm-row cm-card rounded-lg px-3 py-2 text-left"
                  style={{ border: '1px solid var(--paper-2, #EAE4D8)', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)', cursor: 'pointer' }}>
                  Email template workshop
                </button>
                <button type="button" onClick={() => setSheet('sms')} className="cm-row cm-card rounded-lg px-3 py-2 text-left"
                  style={{ border: '1px solid var(--paper-2, #EAE4D8)', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)', cursor: 'pointer' }}>
                  SMS template workshop
                </button>
              </div>
            </div>

            <div
              className="rounded-xl p-4"
              style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <h2
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3, #7C7365)',
                  margin: '0 0 8px',
                }}
              >
                Scheduled reports
              </h2>
              {!data.schedulesKnown ? (
                <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
                  The schedule list hasn’t answered yet — {EM}.
                </p>
              ) : data.schedules.length === 0 ? (
                <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
                  No reports are scheduled.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {data.schedules.map((s) => (
                    <li key={s.id} style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>{s.title}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                        {fmtCadence(s.frequency, s.dayOfWeek, s.timeOfDay)}
                        {s.nextRunAt ? ` · next ${fmtWhen(s.nextRunAt)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>

      {sheet && <TemplateSheet channel={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
