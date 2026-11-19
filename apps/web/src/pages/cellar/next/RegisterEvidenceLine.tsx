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

import { EM, type Confidence } from './cellar-format';
import type { RegisterEvidenceVM } from './useCellarNextData';

/**
 * The closing words of the line. A bare "likely" after three figures read as
 * if it described the last one ("0 in the shared catalogue · likely"); it
 * describes the answer, so it says so.
 */
export function evidenceVerdict(c: Confidence): string {
  if (c === 'certain') return 'the books settle it';
  if (c === 'likely') return 'the books suggest it';
  if (c === 'none') return 'nothing found';
  return 'not known yet';
}

export default function RegisterEvidenceLine({
  evidence,
  confidence,
}: {
  evidence: RegisterEvidenceVM;
  confidence: Confidence;
}) {
  // A zero is "none": a bare 0 beside "in the shared catalogue" reads as a count
  // someone took and found empty, when for a cocktail the catalogue never held any.
  const fig = (n: number | null) => (n === null ? EM : n === 0 ? 'none' : n.toLocaleString('en-US'));
  return (
    <p className="cl-note" style={{ marginTop: 4 }}>
      <span className="cl-num">{fig(evidence.inventoryRows)}</span> in the cellar ·{' '}
      <span className="cl-num">{fig(evidence.menuRows)}</span> on the menu ·{' '}
      <span className="cl-num">{fig(evidence.catalogueRows)}</span> in the shared catalogue
      {evidence.nameOnly ? ' · read from names, not a classification' : ''} ·{' '}
      {evidenceVerdict(confidence)}
    </p>
  );
}
