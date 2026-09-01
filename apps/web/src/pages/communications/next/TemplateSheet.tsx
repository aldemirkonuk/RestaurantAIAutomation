/**
 * TemplateSheet — the founder's modal-clarity ask, answered in copy: when a
 * template builder opens, a banner says exactly what is going on and what
 * cannot happen from here, before anything else.
 *
 * The builders are the existing, battle-tested components, rendered AS THEY
 * ARE: they position themselves as full-screen overlays (fixed inset-0
 * z-[200]), so wrapping them in a positioned frame double-overlays and clips
 * (communications-audit.md, BLOCKER 4). The clarity banner is therefore its
 * own fixed bar, stacked above the builder's overlay, and the builder keeps
 * the whole screen.
 */

import { Suspense, lazy, useEffect } from 'react';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* what's going on — above the builder's own z-[200] overlay */}
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[220] px-5 py-2.5"
        style={{
          height: 52,
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          background: 'var(--paper-0, #FAF7F1)',
          borderBottom: '1px solid var(--paper-2, #EAE4D8)',
          fontFamily: SANS,
          boxShadow: '0 6px 24px rgba(23,19,15,.12)',
        }}
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
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
            marginLeft: 10,
          }}
        >
          You are editing a saved template. Nothing is sent from here.
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', marginLeft: 10 }}>
          Saving stores it for later; sending always happens from a conversation.
        </span>
      </div>

      {/* The builders are fixed inset-0 overlays; a transformed full-screen-
          minus-banner container becomes their containing block, so the whole
          overlay (backdrop, card, header) lives BELOW the banner instead of
          being clipped by it (Opus correctness review, DEFECT 7). */}
      <div
        style={{
          position: 'fixed',
          top: 52,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 210,
          transform: 'translateZ(0)',
        }}
      >
        <Suspense fallback={null}>
          {channel === 'gmail' ? (
            <GmailTemplateBuilder onClose={onClose} onSave={onClose} />
          ) : (
            <SMSTemplateBuilder onClose={onClose} onSave={onClose} />
          )}
        </Suspense>
      </div>
    </>
  );
}
