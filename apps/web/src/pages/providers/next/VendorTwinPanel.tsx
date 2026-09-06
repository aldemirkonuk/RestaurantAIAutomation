/**
 * "This looks like a vendor already in the book" — the owed question on
 * `/providers`.
 *
 * A question with two answers, asked BEFORE a write, so a Panel (census 102).
 * The legacy modal is `components/providers/VendorMatchModal.tsx:108`, and its
 * reasoning is carried over whole because it was right:
 *
 *  - **Two ways a house ends up with the same supplier twice.** The catalogue
 *    already holds a verified entry, or this house already has one under a
 *    slightly different name. `useDuplicateVendorCheck` checks both; this panel
 *    only asks about whichever one it raised.
 *  - **Never a hard block.** The best match can be wrong — a same-named vendor
 *    in another market, a franchise, a coincidence — so both answers are always
 *    open and "keep both" is a real answer, not a dark-pattern escape.
 *  - **It never merges two records.** Orders, invoices and conversations all
 *    point at a `provider_id`; silently repointing them is destructive in a way
 *    a duplicate warning is not. The panel reports and steps aside.
 *  - **`edit` never offers to add.** The record already exists, so "use this
 *    vendor" would create a THIRD row rather than resolve the duplicate.
 *
 * WHAT CHANGES FROM THE LEGACY. The confidence figure NAMES WHAT IT MEASURED —
 * the legacy card printed "87% match" with nothing to check it against, and a
 * percentage with no denominator is the kind of figure this house does not
 * print. Here it says which of the two similarities it came from, because the
 * hook takes `max(name, address)` and those are different claims.
 */

import { useState } from 'react';
import { Panel } from '@/components/mudavym';
import { addProviderFromCatalogue } from '@/services/api/vendors';
import { getErrorMessage } from '@/services/api/client';
import type { DuplicateMatch } from '@/hooks/useDuplicateVendorCheck';
import { SANS, SERIF, MONO } from './pv-format';

export interface VendorTwinPanelProps {
  open: boolean;
  match: DuplicateMatch | null;
  /** `edit` cannot offer to add anything — the record already exists. */
  context: 'add' | 'edit';
  /** The catalogue vendor was added; the composer should close. */
  onUsedCatalogue?: () => void;
  /** "They are different" — carry on with what was being written. */
  onKeepBoth: () => void;
}

/** Which similarity produced the score, so the figure names what it measured. */
function basisOf(match: DuplicateMatch): { pct: number; basis: string } {
  const row = match.kind === 'catalogue' ? match.vendor : match.provider;
  const name = row.name_similarity ?? 0;
  const address = row.address_similarity ?? 0;
  const pct = Math.round(Math.max(name, address) * 100);
  const basis =
    address > name
      ? 'on the address'
      : address === name && address > 0
        ? 'on the name and the address alike'
        : 'on the name';
  return { pct, basis };
}

export function VendorTwinPanel({
  open,
  match,
  context,
  onUsedCatalogue,
  onKeepBoth,
}: VendorTwinPanelProps) {
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!match) return null;

  const isCatalogue = match.kind === 'catalogue';
  const record = isCatalogue ? match.vendor : match.provider;
  const { pct, basis } = basisOf(match);
  const canAddCatalogue = isCatalogue && context === 'add';

  const address = isCatalogue
    ? match.vendor.address ||
      [match.vendor.city, match.vendor.state].filter(Boolean).join(', ')
    : match.provider.address;

  const useTheOneOnFile = async () => {
    if (adding || match.kind !== 'catalogue') return;
    setAdding(true);
    setFailure(null);
    try {
      await addProviderFromCatalogue(match.vendor.id);
      onUsedCatalogue?.();
    } catch (e) {
      // Named, never a toast that disappears: the person is mid-form and has to
      // know that the vendor they chose is NOT in the book.
      setFailure(
        `${match.vendor.name} was not added (${getErrorMessage(e)}). Nothing was written — the vendor you were typing is still here.`,
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <Panel
      open={open}
      onClose={onKeepBoth}
      /* The contract, as the accessible name. */
      label={
        canAddCatalogue
          ? 'This asks whether the vendor you are typing is one this house already has. Using the one on file writes a vendor to the book. Keeping both writes nothing and leaves your words where they are.'
          : 'This asks whether the vendor you are typing is one this house already has. Nothing is written either way; keeping both leaves your words where they are.'
      }
      eyebrow="Possible duplicate"
      title="This looks like a vendor already in the book"
      closeLabel="Keep both — they are different"
      /* Above the sheet it interrupts (the sheet is 100). */
      zIndex={140}
      footer={
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          Two records are never merged here. Orders, invoices and letters all point at one
          vendor, and repointing them is not something a warning may do.
        </span>
      }
    >
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
        <p
          data-testid="twin-confidence"
          style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3, #7C7365)', margin: 0 }}
        >
          {pct}% alike {basis}
        </p>

        <h3
          data-testid="twin-name"
          style={{ fontFamily: SERIF, fontSize: 17, margin: '4px 0 0', color: 'var(--ink-1, #211C16)' }}
        >
          {record.name}
        </h3>
        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          {isCatalogue ? 'A verified entry in the shared catalogue' : 'Already in this house’s book'}
        </p>

        <dl className="mt-3" style={{ margin: '12px 0 0', display: 'grid', gap: 4 }}>
          {[
            ['Address', address],
            ['Phone', record.phone],
            ['Email', record.email],
            ['Website', record.website],
          ]
            .filter(([, v]) => !!v)
            .map(([k, v]) => (
              <div key={String(k)} className="flex gap-2">
                <dt
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3, #7C7365)',
                    minWidth: 68,
                    paddingTop: 2,
                  }}
                >
                  {k}
                </dt>
                <dd style={{ margin: 0, fontSize: 12.5 }}>{String(v)}</dd>
              </div>
            ))}
        </dl>

        <p className="mt-3" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          {isCatalogue
            ? 'Adding your own copy would give this house a private, unverified duplicate of an entry somebody has already checked.'
            : 'Saving this would give this house two of the same supplier. Existing records are not merged — edit the one already in the book, or carry on if these really are two different suppliers.'}
        </p>

        {failure && (
          <p role="status" data-testid="twin-failure" className="mt-2" style={{ fontSize: 11.5 }}>
            {failure}
          </p>
        )}

        {canAddCatalogue && (
          <div className="mt-4">
            <button
              type="button"
              disabled={adding}
              data-testid="twin-use-existing"
              onClick={() => void useTheOneOnFile()}
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 14px',
                borderRadius: 3,
                border: '1px solid var(--seal, #1A5E6B)',
                background: adding ? 'transparent' : 'var(--seal, #1A5E6B)',
                color: adding ? 'var(--ink-3, #7C7365)' : 'var(--paper-0, #FBF8F1)',
                cursor: adding ? 'not-allowed' : 'pointer',
              }}
            >
              {adding ? 'Adding it…' : 'Use the one on file'}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default VendorTwinPanel;
