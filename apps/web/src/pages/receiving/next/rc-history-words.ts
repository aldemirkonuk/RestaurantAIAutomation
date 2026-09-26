/**
 * The words a line's history says (RcLineHistory): one sentence per recorded
 * entry, in the unit the person counted in, never re-multiplied here. Kept
 * apart from the component so the sheet file exports only components.
 */
import type { LineHistoryEntry } from '@/services/api/receiving';
import { EM, fmtUnits } from './rc-format';

const REFUSAL_WORDS: Record<string, string> = {
  wrong_wine: 'wrong wine',
  broken_case: 'broken case',
  temperature: 'temperature',
  other: 'another reason',
};

export const bottles = (n: number) => `${n} bottle${n === 1 ? '' : 's'}`;

const whenFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? EM : whenFmt.format(d);
}

/** "2 cases (24 bottles)" — the unit the person counted in, and the bottles the door converted it to. */
function counted(qty: number | null, uom: string | null, inBottles: number | null): string | null {
  if (qty === null) return inBottles === null ? null : bottles(inBottles);
  const said = fmtUnits(qty, uom);
  if (inBottles === null || (uom ?? '').toLowerCase() === 'bottle') return said;
  return `${said} (${bottles(inBottles)})`;
}

/**
 * The one sentence an entry says. Exported for the test: every kind has a
 * sentence, and an unworded stage is named by its own stage, never hidden.
 */
export function entryWords(e: LineHistoryEntry): string {
  const got = counted(e.countedQtyInCountedUom, e.countedUom, e.countedBottles);
  const refused =
    e.rejectedBottles !== null && e.rejectedBottles > 0
      ? counted(
          e.rejectedQtyInCountedUom !== null && e.rejectedQtyInCountedUom > 0 ? e.rejectedQtyInCountedUom : null,
          e.countedUom,
          e.rejectedBottles,
        )
      : null;
  switch (e.kind) {
    case 'door_count':
      return [
        got ? `The door counted ${got}` : 'The door recorded a count with no quantity',
        refused ? `and refused ${refused}` : null,
      ]
        .filter(Boolean)
        .join(' ') + '.';
    case 'door_refused': {
      const why = e.refusalReason ? REFUSAL_WORDS[e.refusalReason] ?? e.refusalReason : null;
      return `The door turned the delivery away${why ? ` (${why})` : ''}${
        refused ? `, refusing ${refused}` : ''
      }.`;
    }
    case 'desk_verified': {
      const parts = [
        e.countedBottles !== null ? `${bottles(e.countedBottles)} accepted` : 'no accepted count recorded',
        e.rejectedBottles !== null && e.rejectedBottles > 0 ? `${bottles(e.rejectedBottles)} refused` : null,
      ].filter(Boolean);
      const invoice =
        e.invoiceBottles !== null ? ` The invoice billed ${bottles(e.invoiceBottles)}.` : ' No invoice was verified.';
      return `The desk verified the line: ${parts.join(', ')}.${invoice}`;
    }
    case 'desk_confirmed':
      // The one-tap "Counts match" (ADR 0192, fifth amendment): it states no invoice and no
      // refusal, so it says so, and an earlier check's invoice stays on that check's entry.
      return `The desk confirmed the counts match: ${
        e.countedBottles !== null ? `${bottles(e.countedBottles)} on the shelf` : 'no count recorded'
      }. No invoice or refusal was stated.`;
    default:
      return `Recorded as "${e.stage || 'no stage'}"${got ? `: ${got}` : ''}.`;
  }
}
