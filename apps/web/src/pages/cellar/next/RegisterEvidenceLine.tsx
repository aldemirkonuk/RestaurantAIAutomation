/**
 * One register's evidence, in one line: what the books show, and how sure that
 * makes the answer. Shared by the settings control, the onboarding step and the
 * cellar's own register cards, so the three cannot describe the same evidence
 * three different ways.
 *
 * Every figure here can be null and every null is words, never a zero:
 *  - `inventoryRows: null` — the cellar could not be read.
 *  - `catalogueRows: null` — the shared catalogue could not be read.
 * And a catalogue figure is always labelled as the catalogue's, never as this
 * house's stock: `public.beverages` has no `restaurant_id` at all.
 */

import { EM, confidenceLabel, type Confidence } from './cellar-format';
import type { RegisterEvidenceVM } from './useCellarNextData';

export default function RegisterEvidenceLine({
  evidence,
  confidence,
}: {
  evidence: RegisterEvidenceVM;
  confidence: Confidence;
}) {
  const fig = (n: number | null) => (n === null ? EM : n.toLocaleString('en-US'));
  return (
    <p className="cl-note" style={{ marginTop: 4 }}>
      <span className="cl-num">{fig(evidence.inventoryRows)}</span> in the cellar ·{' '}
      <span className="cl-num">{fig(evidence.menuRows)}</span> on the menu ·{' '}
      <span className="cl-num">{fig(evidence.catalogueRows)}</span> in the shared catalogue
      {evidence.nameOnly ? ' · read from names, not a classification' : ''} ·{' '}
      {confidenceLabel(confidence)}
    </p>
  );
}
