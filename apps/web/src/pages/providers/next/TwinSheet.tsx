/**
 * TwinSheet — the learned side of one vendor, opened from a bucket card.
 *
 * The founder's MERGE verdict draws the line this component enforces: the
 * card stays small and closed; everything the platform has learned about the
 * vendor (the "digital twin") lives here, in the sheet, fetched on open by
 * ProviderIntelligencePanel. The sheet slides in on the house `settle` curve
 * and leaves the page underneath untouched.
 */

import { Suspense, lazy, useEffect, useRef } from 'react';
import type { Provider } from '../../../services/api/providers';
import { settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, fmtDays, fmtLastContact } from './pv-format';

const ProviderIntelligencePanel = lazy(() =>
  import('../../../components/providers/ProviderIntelligencePanel').then((m) => ({
    default: m.ProviderIntelligencePanel,
  })),
);

interface Props {
  provider: Provider;
  onClose: () => void;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-1, #211C16)', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

export function TwinSheet({ provider, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus lands on Close exactly once, when the sheet mounts — not on every
  // parent re-render (audit finding: [onClose] deps stole focus on each poll).
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const regions = provider.regionsCovered ?? provider.statesOrRegionsServed ?? [];

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`${provider.name} — details`}>
      {/* scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        style={{ background: 'rgba(23, 19, 15, 0.28)' }}
      />
      {/* the sheet itself */}
      <aside
        className="pv-sheet absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto"
        style={{
          background: 'var(--paper-0, #FAF7F1)',
          borderLeft: '1px solid var(--paper-2, #EAE4D8)',
          boxShadow: '-18px 0 48px rgba(23,19,15,.14)',
          animation: `pv-sheet-in ${settle.ms}ms ${settle.easing} both`,
        }}
      >
        <style>{`
          @keyframes pv-sheet-in { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
          @media (prefers-reduced-motion: reduce) { .pv-sheet { animation: none !important } }
        `}</style>

        <header
          className="flex items-start justify-between gap-3 px-5 pb-4 pt-5"
          style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}
        >
          <div>
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
              {provider.primaryBusinessType}
            </span>
            <h2
              style={{
                fontFamily: SERIF,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                lineHeight: 1.15,
                margin: '2px 0 0',
                color: 'var(--ink-1, #211C16)',
              }}
            >
              {provider.name}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'transparent',
              color: 'var(--ink-2, #4F473C)',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </header>

        <div className="px-5 py-4" style={{ fontFamily: SANS }}>
          {/* the vendor's own record — plain facts, EM for absences */}
          <FactRow label="Contact" value={provider.email || EM} />
          <FactRow label="Phone" value={provider.phone || EM} />
          <FactRow label="Lead time" value={fmtDays(provider.leadTimeDays)} />
          <FactRow label="Payment terms" value={provider.paymentTerms || EM} />
          <FactRow
            label="Minimum order"
            value={typeof provider.minimumOrder === 'number' ? `$${provider.minimumOrder}` : EM}
          />
          <FactRow label="Regions" value={regions.length ? regions.join(', ') : EM} />
          <FactRow label="Last contact" value={fmtLastContact(provider.lastContactDate)} />
        </div>

        {/* the twin — fetched on open, never on the grid */}
        <div className="px-5 pb-6" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
          <h3
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3, #7C7365)',
              margin: '14px 0 6px',
            }}
          >
            What the platform has learned
          </h3>
          <Suspense
            fallback={
              <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
                Opening the vendor’s record…
              </p>
            }
          >
            <ProviderIntelligencePanel providerId={provider.id} providerName={provider.name} />
          </Suspense>
        </div>
      </aside>
    </div>
  );
}
