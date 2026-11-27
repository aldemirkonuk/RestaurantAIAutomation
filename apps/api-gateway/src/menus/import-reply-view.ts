/**
 * What the import reply sends a reader who may not see a line's raw text
 * (ADR 0358 D2; tech-debt fragment
 * `.planning/tech-debt.d/2026-10-08-fix-a-menu-line-carries-its-raw-line.md`,
 * entry (iii): the import reply was the one path that still sent it).
 *
 * The raw text is the line as the file had it. For a spreadsheet that is the
 * whole row, cost and supplier cells included, so it follows ROLE_POLICY's
 * money-and-suppliers rule (`seesRawLine`, menu-line-view.ts). A withheld raw
 * text is null on the line, and the reply says `rawLineWithheld: true` so a
 * page can tell "held back" from "none kept".
 */
export function withheldRawText<T extends { items?: Array<{ rawText?: string | null }> }>(
  reply: T,
  seesRaw: boolean,
): T & { rawLineWithheld?: true } {
  if (seesRaw || !Array.isArray(reply.items)) return reply;
  return {
    ...reply,
    items: reply.items.map((item) => ({ ...item, rawText: null })),
    rawLineWithheld: true as const,
  };
}
