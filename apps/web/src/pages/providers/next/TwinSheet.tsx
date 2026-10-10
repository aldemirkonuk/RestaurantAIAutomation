/**
 * TwinSheet — the learned side of one vendor, opened from a bucket card.
 *
 * The founder's MERGE verdict draws the line this component enforces: the
 * card stays small and closed; everything the platform has learned about the
 * vendor lives here, in the sheet, fetched on open by LearnedSection.
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
 * days, minimums, payment terms) is reachable here, not only in /settings.
 * `TermsSection` below is what this HOUSE knows about dealing with them, each
 * term showing its source, editable in place through the same route the
 * settings register writes. Since VEN-W24 (2026-10-01) the lead-time, payment
 * and minimum facts at the top read that same terms answer (`TopTermsFacts`),
 * naming the vendor's record only when the house has stated nothing.
 *
 * ── Fourth pass: branches (2026-09-26) ────────────────────────────────────
 * `BranchesSection` carries the vendor's offices, warehouses and stores —
 * until now editable only in the legacy sheet's Locations tab.
 */

import { Mail, Phone } from 'lucide-react';
import type { Provider } from '../../../services/api/providers';
import { Sheet } from '../../../components/mudavym/Sheet';
import { EM, MONO, SANS, fmtLastContact, visibleRegions } from './pv-format';
import { TermsSection } from './TermsSection';
import { useProviderTerms } from './useProviderTerms';
import { topTerms } from './TopTermsFacts';
import { UsualCurrencySection } from './UsualCurrencySection';
import { ContactsSection } from './ContactsSection';
import { BranchesSection } from './BranchesSection';
import { VendorRecordEdit, businessTypeLabel } from './VendorRecordEdit';
import { LedgerCard } from './scorecard/LedgerCard';
import { MailTone } from './scorecard/MailTone';
import { LearnedSection } from './LearnedSection';
import { useAuth } from '../../../contexts/AuthContext';

interface Props {
  provider: Provider;
  onClose: () => void;
  /**
   * True when this sheet was opened from the currency prompt — the coverage
   * panel's link or `?vendor=` — in which case the usual-currency section
   * scrolls itself into view and takes focus. The panel's whole point is to
   * bring a person to that field; landing them at the top of a sheet whose
   * fifth section holds it is a link that only looks like it worked.
   */
  focusUsualCurrency?: boolean;
  /**
   * The record was edited here (founder answer 12, 2026-09-21: the rebuilt
   * sheet gets an edit path, type first). The page refreshes its cards.
   */
  onProviderSaved?: (updated: Provider) => void;
}

const FACT_LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-4, #665D50)',
};

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span style={FACT_LABEL}>{label}</span>
      <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-1, #211C16)', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

/**
 * How to reach the vendor, drawn as the act it is (VEN-W32, founder
 * 2026-10-08: "more striking looking, right now looks like an error"; then
 * "Approve, phone too"). An underlined teal line wrapping down the right edge
 * read as a warning; a sealed button with its icon says "write to them" /
 * "call them". Nothing on file stays an em dash, never a button.
 */
function ReachRow({
  label,
  shown,
  href,
  verb,
  Icon,
  testId,
}: {
  label: string;
  shown: string;
  href: string;
  verb: string;
  Icon: typeof Mail;
  testId: string;
}) {
  if (!shown) return <FactRow label={label} value={EM} />;
  return (
    <div className="flex items-center justify-between gap-4 py-2" data-testid={testId}>
      <span style={FACT_LABEL}>{label}</span>
      <a
        href={href}
        aria-label={`${verb} ${shown}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          maxWidth: '78%',
          padding: '6px 12px',
          borderRadius: 10,
          background: 'var(--seal, #1A5E6B)',
          color: 'var(--paper-0, #FBF8F1)',
          fontFamily: SANS,
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.35,
          textDecoration: 'none',
        }}
      >
        <Icon aria-hidden className="w-3.5 h-3.5 shrink-0" />
        <span style={{ overflowWrap: 'anywhere' }}>{shown}</span>
      </a>
    </div>
  );
}

export function TwinSheet({ provider, onClose, focusUsualCurrency, onProviderSaved }: Props) {
  const regions = visibleRegions(provider.regionsCovered ?? provider.statesOrRegionsServed ?? []);
  // "How their mail reads" is for owners and managers only (the founder,
  // 2026-09-21: staff never see it). The gateway refuses anyone else with 403;
  // this only keeps staff from asking.
  const { user, activeRole } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  const readsMail = role === 'owner' || role === 'manager';
  // One read of the terms register for the whole sheet (VEN-W24): the top
  // facts and the Terms section render the same cells, so a save in Terms
  // moves the top too, and `/vendor-terms` is fetched once, not twice.
  const terms = useProviderTerms(provider.id);
  const top = topTerms(terms, provider);

  return (
    <Sheet
      open
      onClose={onClose}
      label={`${provider.name} — details`}
      eyebrow={(provider.primaryBusinessType ?? '').trim() === '' ? 'Type not stated' : businessTypeLabel(provider.primaryBusinessType)}
      title={provider.name}
    >
      <div className="px-4 py-4" style={{ fontFamily: SANS }}>
        {/* the vendor's own record — the type first, editable here */}
        <VendorRecordEdit provider={provider} onSaved={(p) => onProviderSaved?.(p)} />
        {/* plain facts, EM for absences */}
        <ReachRow
          label="Email"
          shown={(provider.email ?? '').trim()}
          href={`mailto:${(provider.email ?? '').trim()}`}
          verb="Write to"
          Icon={Mail}
          testId="vendor-email"
        />
        <ReachRow
          label="Phone"
          shown={(provider.phone ?? '').trim()}
          href={`tel:${(provider.phone ?? '').replace(/[^\d+]/g, '')}`}
          verb="Call"
          Icon={Phone}
          testId="vendor-phone"
        />
        {/* what the HOUSE recorded, else the vendor's record, labelled —
            the same cells as Terms below (VEN-W24, "One source") */}
        <FactRow label="Lead time" value={top.leadTime} />
        <FactRow label="Payment terms" value={top.paymentTerms} />
        <FactRow label="Minimum order" value={top.minimumOrder} />
        <FactRow label="Regions" value={regions.length ? regions.join(', ') : EM} />
        <FactRow label="Last contact" value={fmtLastContact(provider.lastContactDate)} />
      </div>

      {/* what money they usually bill in — a fact about the VENDOR, offered on
          the order sheet and never used to file an invoice (founder, batch 65) */}
      <div className="px-4 pb-3" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <UsualCurrencySection
          providerId={provider.id}
          providerName={provider.name}
          takeFocus={focusUsualCurrency}
        />
      </div>

      {/* what this house knows about dealing with them — same register as
          /settings, read on open, one row of it */}
      <div className="px-4 pb-2" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <TermsSection providerId={provider.id} providerName={provider.name} terms={terms} />
      </div>

      {/* the numbers, and whether a text can reach any of them — ADR 0121 P0
          item 2. The verdict is the gateway's; this section only shows it and
          lets a manager answer the question nobody has answered. */}
      <div className="px-4 pb-2" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <ContactsSection providerId={provider.id} providerName={provider.name} />
      </div>

      {/* where they are — offices, warehouses, stores this house deals with
          (founder, 2026-09-26, round 8, item 51; ADR 0221). Read on open. No
          map here: the new one is its own tab later (item 52). */}
      <div className="px-4 pb-2" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <BranchesSection providerId={provider.id} providerName={provider.name} />
      </div>

      {/* what they DID — the operational vendor scorecard (ADR 0207, sketch
          117 A). Five measured lines from this house's own records, each
          opening to its rows. (The legacy panel's Sentiment tab retired in
          round 3; its reading lives in the section below.) */}
      <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <LedgerCard providerId={provider.id} providerName={provider.name} />
      </div>

      {/* how their mail reads — the vendor's own lines, one word each (ADR
          0207 round 3: the founder's "A, Plus C's lines", vendor sheet only,
          owners and managers only). It replaces the legacy Sentiment tab's
          design; the feature stays, here. */}
      {readsMail && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
          <MailTone providerId={provider.id} />
        </div>
      )}

      {/* what their mail has told this house — facts, offers, messages
          (VEN-W14, founder 2026-10-01). A Mudavym section like its siblings,
          so the legacy panel's `data-ground="paper"` workaround is gone. */}
      <div className="px-4 pb-6" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
        <LearnedSection providerId={provider.id} providerName={provider.name} />
      </div>
    </Sheet>
  );
}

export default TwinSheet;
