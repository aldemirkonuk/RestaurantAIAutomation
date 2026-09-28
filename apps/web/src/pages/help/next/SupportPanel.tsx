/**
 * SupportPanel — "Write to support with these readings?"
 *
 * ADR 0160 §111's Decision: *"B's What-to-do-next rail and write-to-support
 * modal are grafted in regardless of which base is picked."* Direction B's
 * own drawing (`direction-b.html:270`, frame 03; `panelSupport`, :860-862):
 * a centred panel that shows the reader the exact message — the address, the
 * subject, and the diagnostics block — BEFORE any mail app opens. Built on
 * ADR 0112's shared `Panel` shape (centred, an ask or a confirmation): the
 * focus trap, the scrim, the scroll lock and Esc all belong to that primitive
 * already, and its close control is a word ("Not now"), never an X.
 *
 * ONE MESSAGE BODY. The `block` and `mailto` this panel is handed are the
 * SAME values `HelpNext.tsx`'s "Reach a person" section already computed
 * from `hp-support.ts` — this file composes no second copy of either, so the
 * fold in "Reach a person" and this panel can never say two different things
 * about what a message to support would carry.
 *
 * THE UNCONFIGURED STATE IS NOT HIDDEN. `hp-support.ts`'s `EmailChannel` has
 * three states; the previous "Write to support" control existed only when
 * `state === 'configured'` (`HelpNext.tsx:447-449` before this change), so a
 * house with no address configured had no way to even ask what writing to
 * support would look like. This panel opens for all three states and says
 * which one applies — an absence shown as one (ADR 0020) rather than a
 * control that quietly disappears.
 */

import { Check } from 'lucide-react';
import { Panel } from '../../../components/mudavym/Sheet';
import { MONO, SANS } from './hp-format';
import { supportSubject, type EmailChannel } from './hp-support';

export interface SupportPanelProps {
  open: boolean;
  onClose: () => void;
  support: EmailChannel;
  houseName?: string | null;
  /** The diagnostics block, already composed by the caller (`hp-support.ts`
   * `diagnosticsBlock`) — one reading, shared with "Reach a person" below it. */
  block: string;
  /** Non-null exactly when `support.state === 'configured'`. */
  mailto: string | null;
  copied: boolean;
  onCopy: () => void;
}

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: 0 }}>
      {children}
    </dt>
  );
}

export function SupportPanel({ open, onClose, support, houseName, block, mailto, copied, onCopy }: SupportPanelProps) {
  // Sheet.tsx's OverlayRoot does not itself guard `open` — callers that have
  // no exit-animation content to preserve return null while closed, the same
  // choice reports/next/AskTheBook.tsx makes for the same reason (its own
  // header comment cites ADR 0112 for why the primitive owns everything else).
  if (!open) return null;

  return (
    <Panel
      open={open}
      onClose={onClose}
      label="Write to support with these readings"
      contract="Nothing is sent from this page. Closing it without acting writes nothing."
      eyebrow="A question"
      title="Write to support with these readings?"
      closeLabel="Not now"
      footer={
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {mailto && (
            <a className="hp-btn hp-btn--seal hp-ink hp-focus" href={mailto} onClick={onClose}>
              Open my mail
            </a>
          )}
          <button type="button" className="hp-btn hp-ink hp-focus" onClick={onCopy}>
            {copied ? (
              <>
                Copied <Check size={13} />
              </>
            ) : (
              'Copy instead'
            )}
          </button>
        </div>
      }
    >
      {support.state === 'configured' && (
        <>
          <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: 0 }}>
            Your mail app opens with this in the body. Nothing is sent by this page; the message is yours to finish.
          </p>
          <dl style={{ margin: '14px 0 0', fontFamily: SANS, fontSize: 13, color: 'var(--ink-1)' }}>
            <Dt>To</Dt>
            <dd style={{ margin: '2px 0 10px', fontFamily: MONO }}>{support.address}</dd>
            <Dt>Subject</Dt>
            <dd style={{ margin: '2px 0 0' }}>{supportSubject(houseName)}</dd>
          </dl>
        </>
      )}
      {support.state === 'unconfigured' && (
        <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: 0 }}>
          No support address was configured for this build. There is no default one — copy the readings below and
          send them yourself.
        </p>
      )}
      {support.state === 'unusable' && (
        <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: 0 }}>
          The configured address is not usable ({support.why}): {support.raw}. Copy the readings below and send
          them yourself.
        </p>
      )}
      <pre
        style={{
          marginTop: 12,
          padding: 12,
          background: 'var(--paper-1)',
          border: '1px solid var(--paper-2)',
          borderRadius: 8,
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 1.6,
          color: 'var(--ink-2)',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
        }}
      >
        {block}
      </pre>
    </Panel>
  );
}
