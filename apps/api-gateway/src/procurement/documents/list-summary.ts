/**
 * THE LIST CARRIES THE ROW, NOT THE PAPER (r41 invoices audit, gap 2).
 *
 * `GET /procurement/documents` reads `select("*")`, so every listed row used
 * to carry two columns the list screens never read:
 *
 *   `extracted`    the whole parsed paper (every line, every total, the VAT
 *                  breakdown, the reader's notes), and
 *   `raw_payload`  the EDI or e-invoice text the paper arrived as, up to
 *                  500,000 characters.
 *
 * /receipts asks for three lists of up to 100 rows on first paint, plus the
 * credit memos, so the browser downloaded the whole parsed paper of every
 * listed document to draw a row of dates, totals and a vendor name.
 *
 * A caller that asks for `view=summary` gets the row without them. The
 * gateway still reads both: the list's own derived fields (`ties_out` as the
 * rule gives it now, `vendorName`, `moneyState`) are computed from
 * `extracted` BEFORE it is left out, so a summary row says exactly what a
 * full row says about the paper.
 *
 * Opt-in, not the default: the receiving workspace reads `extracted.lines`
 * off the order's documents (`documentsApi.forOrder`) to pre-fill what the
 * vendor billed, and a caller this repository cannot see may do the same.
 * A full row stays one query parameter away.
 */
export const PAPER_COLUMNS = ["extracted", "raw_payload"] as const;

/** Leaves the paper's own columns off one listed row, in place. */
export function leaveOutThePaper(row: Record<string, unknown>): void {
  for (const column of PAPER_COLUMNS) delete row[column];
}

/** Whether a list request asked for the summary view. */
export function wantsSummary(view: string | undefined): boolean {
  return view === "summary";
}
