/**
 * TemplateSheet — the founder's modal-clarity ask, answered in copy and
 * structure: when a template builder opens, the sheet's own header says
 * exactly what is going on and what cannot happen from here. The builders
 * themselves are the existing, battle-tested components, unchanged.
 */

import { Suspense, lazy } from 'react';
import { MONO, SANS, SERIF } from './cm-format';

const GmailTemplateBuilder = lazy(() =>
  import('../../../components/documents/GmailTemplateBuilder').then((m) => ({
    default: m.GmailTemplateBuilder,
  })),
);
const SMSTemplateBuilder = lazy(() =>
  import('../../../components/documents/SMSTemplateBuilder').then((m) => ({
    default: m.SMSTemplateBuilder,
  })),
);

export type TemplateChannel = 'gmail' | 'sms';

interface Props {
  channel: TemplateChannel;
  onClose: () => void;
}

export function TemplateSheet({ channel, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Template workshop">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        style={{ background: 'rgba(23, 19, 15, 0.28)' }}
      />
      <div
        className="absolute left-1/2 top-8 w-full max-w-3xl -translate-x-1/2 overflow-hidden rounded-2xl"
        style={{ background: 'var(--paper-0, #FAF7F1)', boxShadow: '0 24px 64px rgba(23,19,15,.22)' }}
      >
        {/* what's going on, said before anything renders */}
        <header
          className="px-5 py-3"
          style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)', fontFamily: SANS }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--seal-deep, #14515C)',
            }}
          >
            Template workshop · {channel === 'gmail' ? 'email' : 'SMS'}
          </span>
          <p style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600, margin: '2px 0 0', color: 'var(--ink-1, #211C16)' }}>
            You are editing a saved template. Nothing is sent from here.
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '2px 0 0' }}>
            Saving stores the template for later use; sending always happens from a conversation,
            with the recipient in front of you.
          </p>
        </header>
        <div className="max-h-[70vh] overflow-y-auto">
          <Suspense
            fallback={
              <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)', padding: 20 }}>
                Opening the workshop…
              </p>
            }
          >
            {channel === 'gmail' ? (
              <GmailTemplateBuilder onClose={onClose} onSave={onClose} />
            ) : (
              <SMSTemplateBuilder onClose={onClose} onSave={onClose} />
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
