/**
 * A full-screen link for a cutting that is not on the reader's sheet (r36
 * reports audit, gap 9).
 *
 * `?flat=<id>` was honoured only by a cutting ON the reader's own sheet, and
 * sheets are per person. An owner's `/reports?flat=ledger` sent to a manager
 * whose sheet has no ledger opened the plain sheet, kept the parameter in the
 * link, and said nothing.
 *
 * The call (r38, under the 2026-11-07 /goal "full screen, no bugs"):
 * - A link that names an analysis with a register opens it full screen even
 *   when it is off the reader's sheet. The register is read for the visit and
 *   the sheet is not written: following a link is not arranging.
 * - An analysis held from the reader's role opens too, and says who it is
 *   written for, exactly as it would on their sheet (ADR 0348). The link is
 *   not a way around the hold, and silence would hide that the analysis exists.
 * - A link naming nothing this page lays flat (a mistyped id, or the writing
 *   desk, which has no register) is said in a sentence with a way to clear it.
 * - Nothing is decided until the reader's sheet is decided (read, or known
 *   unreadable): a visit drawn first and then found on the sheet would open the
 *   view twice. While arranging, no view opens, as on the sheet.
 *
 * Rejected: adding the cutting to the reader's sheet (a write they did not ask
 * for, and the save races arranging); a notice only ("not on your sheet"),
 * which leaves the link doing nothing it promised.
 */
import { CATALOGUE } from './rp-catalogue';
import { isAnalysisId, type AnalysisId } from './rp-sheet';
import { readsRegister } from './rp-spec';

export type FlatVisit =
  /** Nothing to do: no link, the sheet's own cutting answers it, or not yet. */
  | { kind: 'none' }
  /** Open this analysis full screen over the sheet. */
  | { kind: 'visit'; id: AnalysisId }
  /** The link names nothing this page lays flat; `title` when it names a desk. */
  | { kind: 'refused'; asked: string; title: string | null };

/** The analysis a `?flat=` link asks the data layer to read, or null. */
export function flatAsked(asked: string | null): AnalysisId | null {
  return isAnalysisId(asked) && readsRegister(CATALOGUE[asked]) ? asked : null;
}

export function flatVisit(
  asked: string | null,
  onSheet: ReadonlySet<AnalysisId>,
  sheetDecided: boolean,
  arranging: boolean,
): FlatVisit {
  if (asked === null || asked === '' || arranging || !sheetDecided) return { kind: 'none' };
  if (!isAnalysisId(asked)) return { kind: 'refused', asked, title: null };
  if (!readsRegister(CATALOGUE[asked])) return { kind: 'refused', asked, title: CATALOGUE[asked].title };
  if (onSheet.has(asked)) return { kind: 'none' };
  return { kind: 'visit', id: asked };
}

/** What the page says for a refused link. */
export function refusedFlatSentence(v: Extract<FlatVisit, { kind: 'refused' }>): string {
  return v.title
    ? `The link asked to show ${v.title} full screen. It is a desk, not a register, so it has no full-screen view.`
    : `The link asked to show “${v.asked}” full screen, and this page has no analysis by that name.`;
}
