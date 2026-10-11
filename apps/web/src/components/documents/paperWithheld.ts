/**
 * The gateway's reason when the reader may not open the vendor's paper
 * (`signOriginal`, F-1299): "the paper is kept for owners and managers". That
 * is a decision, not a failing link, so neither face of the original
 * (`PaperPane` on /receipts, `OriginalPane` on the document page) offers
 * "Try again" for it (F-1312, F-1315). One check, so the two faces cannot drift.
 */
const PAPER_WITHHELD = /^the paper is kept for/i

export function isPaperWithheld(reason: string | null | undefined): boolean {
  return PAPER_WITHHELD.test(reason ?? '')
}

/** What a reader without the paper is told, in both panes. */
export const PAPER_WITHHELD_NOTE =
  'The paper for this document is kept for owners and managers. Ask one of them if you need to see it.'
