/**
 * TwinSheet — the learned side of one vendor, opened from a bucket card.
 *
 * The founder's MERGE verdict draws the line this component enforces: the
 * card stays small and closed; everything the platform has learned about the
 * vendor (the "digital twin") lives here, in the sheet, fetched on open by
 * ProviderIntelligencePanel.
 *
 * ── Second pass: the house primitive ──────────────────────────────────────
 * This used to be a hand-rolled `fixed inset-0` overlay with its own scrim
 * colour, its own `pv-sheet-in` keyframes and its own Esc handler — and no
 * focus trap, no focus return, no scroll lock. It now renders the shared
 * `Sheet` (ADR 0112), which is the same 440px right slide-in on `tuck` that the
 * calendar's EventSheet shipped, with those three things added for free. What
 * is inside the sheet is unchanged, line for line.
 *
 * ── Third pass: terms on the vendor's own row ─────────────────────────────
 * The founder's decision of 2026-09-04: the terms register (cutoffs, delivery
 * days, minimums, payment terms) is reachable here, not only in /settings. The
 * facts above are the vendor's own RECORD; `TermsSection` below is what this
 * HOUSE knows about dealing with them, each term showing its source, editable
 * in place through the same route the settings register writes.
 */

import { Suspense, lazy } from 'react';
import type { Provider } from '../../../services/api/providers';
import { Sheet } from '../../../components/mudavym/Sheet';
import { EM, MONO, SANS, fmtDays, fmtLastContact } from './pv-format';
import { TermsSection } from './TermsSection';
import { UsualCurrencySection } from './UsualCurrencySection';

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
  const regions = provider.regionsCovered ?? provider.statesOrRegionsServed ?? [];

  return (
    <Sheet
      open
      onClose={onClose}
      label={`${provider.name} — details`}
      eyebrow={provider.primaryBusinessType}
      title={provider.name}
    >
      <div className="px-4 py-4" style={{ fontFamily: SANS }}>
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

      {/* what money they usually bill in — a fact about the VENDOR, offered on
          the order sheet and never used to file an invoice (founder, batch 65) */}
      <div className="px-4 pb-3" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <UsualCurrencySection providerId={provider.id} providerName={provider.name} />
      </div>

      {/* what this house knows about dealing with them — same register as
          /settings, read on open, one row of it */}
      <div className="px-4 pb-2" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <TermsSection providerId={provider.id} providerName={provider.name} />
      </div>

      {/* the twin — fetched on open, never on the grid */}
      <div className="px-4 pb-6" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
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
    </Sheet>
  );
}

export default TwinSheet;
