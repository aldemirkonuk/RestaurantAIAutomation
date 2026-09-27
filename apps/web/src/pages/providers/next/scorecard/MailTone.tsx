/**
 * "How their mail reads" — the vendor's own messages, under the ledger card
 * (ADR 0207, round 3; the sentiment sketch's direction A, with C's comparison
 * sentence at its foot).
 *
 * THE FOUNDER, 2026-09-21: "A, Plus C's lines"; placement "Vendor sheet only";
 * owners and managers only — staff never see it. The legacy Sentiment tab's
 * design retires with this section; the feature stays, here.
 *
 * What a reader sees, and nothing more:
 *   - the standing line (counts of messages and readings, and that no person
 *     has checked one — never a figure);
 *   - the last messages, newest first: date and subject in mono, ONE word at
 *     the right (warm · plain · terse, or "not assessed" in italic), and the
 *     vendor's own line that word rests on in serif italic — or why there is
 *     none;
 *   - one act, "All their mail", which opens every message of the window here
 *     (`/communications` takes no vendor filter today, so a link there would
 *     only look like it worked);
 *   - the note, or C's sentence when both windows hold five readings.
 *
 * The honest states: loading (the rows drawn, no words), could not read (the
 * gateway's reason, Try again), no mail yet, too few, tone not assessed.
 *
 * Motion: none of its own. The act crosses on `ink` (ADR 0134's token); the
 * section arrives with the sheet; reduced motion renders nothing.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ink } from '../../../../lib/mudavym/motion';
import { MONO, SANS, SERIF } from '../pv-format';
import { SC } from './sc-copy';
import { dayLabel, formatsOf } from './sc-format';
import type { Formats } from './sc-format';
import type { MailMessage } from './scorecard-types';
import { serverMessage, useVendorCard, useVendorMail } from './useVendorScorecard';

const WINDOW = 90 as const;

const eyebrow: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  margin: '14px 0 6px',
};

const standing: React.CSSProperties = {
  margin: '0 0 4px',
  fontFamily: MONO,
  fontSize: 10,
  lineHeight: 1.6,
  letterSpacing: '0.02em',
  color: 'var(--ink-3, #7C7365)',
};

const note: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: 11,
  lineHeight: 1.45,
  color: 'var(--ink-3, #7C7365)',
};

function Message({ m, f }: { m: MailMessage; f: Formats }) {
  return (
    <div data-testid="mail-message" style={{ padding: '9px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
      <div
        className="flex items-baseline justify-between"
        style={{ gap: 12, fontFamily: MONO, fontSize: 10, letterSpacing: '0.02em', color: 'var(--ink-3, #7C7365)' }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dayLabel(m.at, f)} · {m.subject ?? SC.mail.noSubject}
        </span>
        {m.word ? (
          <span data-testid="mail-word" style={{ flex: 'none', color: 'var(--ink-2, #4F473C)', fontWeight: 500 }}>
            {SC.mail.word[m.word]}
          </span>
        ) : (
          <span data-testid="mail-word" style={{ flex: 'none', fontStyle: 'italic' }}>
            {SC.mail.notAssessed}
          </span>
        )}
      </div>
      {m.quote ? (
        <q
          data-testid="mail-quote"
          style={{
            display: 'block',
            margin: '4px 0 0',
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontSize: 14.5,
            lineHeight: 1.38,
            color: 'var(--ink-1, #211C16)',
          }}
        >
          {m.quote}
        </q>
      ) : (
        <p style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.45, fontStyle: 'italic', color: 'var(--ink-3, #7C7365)' }}>
          {m.notAssessed ?? m.quoteMissing}
        </p>
      )}
    </div>
  );
}

export function MailTone({ providerId }: { providerId: string }) {
  const [all, setAll] = useState(false);
  const q = useVendorMail(providerId, WINDOW, true);
  const card = useVendorCard(providerId, WINDOW);
  const f = formatsOf(card.data?.house ?? null);

  return (
    <section data-testid="mail-tone" style={{ fontFamily: SANS }}>
      <style>{`
        .mt-act { transition: color ${ink.ms}ms ${ink.easing} }
        .mt-act:hover { text-decoration: underline }
        .mt-act:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        @media (prefers-reduced-motion: reduce) { .mt-act { transition: none !important } }
      `}</style>
      <h3 style={eyebrow}>{SC.mail.heading}</h3>

      {q.isError ? (
        <div role="alert">
          <p
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
              margin: '6px 0 0',
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--alarm, #A33A2B)',
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
            <span>
              {serverMessage(q.error, SC.mail.readFailed)} {SC.mail.readFailedTail}
            </span>
          </p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-act"
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
            }}
          >
            {SC.mail.tryAgain}
          </button>
        </div>
      ) : !q.data ? (
        <div data-testid="mail-loading" aria-busy="true">
          <p style={standing}>{SC.mail.reading}</p>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ padding: '9px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
              <div style={{ height: 10, width: i === 1 ? '62%' : '78%', borderRadius: 3, background: 'var(--paper-2, #EAE4D8)' }} />
            </div>
          ))}
        </div>
      ) : q.data.state === 'could_not_read' ? (
        <div role="alert">
          <p style={standing}>{q.data.standing}</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--alarm, #A33A2B)' }}>
            {q.data.note}
          </p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-act"
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
            }}
          >
            {SC.mail.tryAgain}
          </button>
        </div>
      ) : q.data.state === 'no_mail' ? (
        <p data-testid="mail-note" style={{ ...note, marginTop: 4 }}>
          {q.data.note}
        </p>
      ) : (
        <>
          <p data-testid="mail-standing" style={standing}>
            {q.data.standing}
          </p>
          {(all ? q.data.messages : q.data.messages.slice(0, q.data.shown)).map((m) => (
            <Message key={m.id} m={m} f={f} />
          ))}
          {q.data.messages.length > q.data.shown && (
            <div
              className="flex items-baseline justify-between"
              style={{ gap: 12, marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--paper-2, #EAE4D8)' }}
            >
              <button
                type="button"
                aria-expanded={all}
                onClick={() => setAll((v) => !v)}
                className="mt-act"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: 'pointer',
                }}
              >
                {all ? SC.mail.fewer : SC.mail.all(q.data.messages.length)}
              </button>
              {!all && (
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
                  {SC.mail.earlier(q.data.messages.length - q.data.shown)}
                  {q.data.beyondCap > 0 ? SC.mail.beyond(q.data.beyondCap) : ''}
                </span>
              )}
            </div>
          )}
          <p data-testid="mail-note" style={note}>
            {q.data.comparison ?? q.data.note}
          </p>
        </>
      )}
    </section>
  );
}

export default MailTone;
