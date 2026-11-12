/**
 * The /inventory exports, shared by the page (count sheet, valuation, the
 * selection) and the opened row ("Export this row"). Moved out of
 * InventoryNext.tsx so RowDropdown can reach the same columns without an
 * import cycle (InventoryNext → InventoryTable → RowDropdown).
 *
 * A figure that was not read is left blank in the file, never written as 0.
 * Legacy's valuation wrote 0 for a missing count (InventoryCommandPage.tsx
 * valuationColumns); that is the one deliberate difference.
 */
import { toast } from 'sonner';
import { exportTable, type TableExportColumn } from '../../../lib/tableExport';
import { plainText } from './iv-failure';
import { fmtCount, typeLabel, type InvRow } from './useInventoryNextData';

export function blank(v: number | null): number | string {
  return v === null ? '' : v;
}

/** A name on one line: a newline inside it would split it into two rows on paste. */
export function oneLine(name: string): string {
  return name.replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Legacy's "Days since counted" cell: "never" with no count on record (the same
 * reading the Observation column gives a null date), blank for a date that does
 * not parse, else whole days.
 */
export function daysSinceCountedCell(lastCountedAt: string | null, now: number = Date.now()): number | string {
  if (lastCountedAt === null) return 'never';
  const t = Date.parse(lastCountedAt);
  if (!Number.isFinite(t)) return '';
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runExport<T>(rows: T[], columns: TableExportColumn<T>[], filename: string, title: string) {
  try {
    await exportTable({ format: 'csv', rows, columns, filename, title });
    toast.success(`Exported ${fmtCount(rows.length)} rows`);
  } catch (err) {
    // Only a sentence written for a person is shown (INV-W31).
    toast.error(err instanceof Error && plainText(err.message) ? err.message : 'The export could not be made.');
  }
}

export function valuationColumns(currencyCode: string | null): TableExportColumn<InvRow>[] {
  return [
    { header: 'Title', value: (r) => r.name ?? '' },
    { header: 'Producer', value: (r) => r.producer ?? '' },
    { header: 'Type', value: (r) => (r.type === null ? '' : typeLabel(r.type)) },
    { header: 'Live', value: (r) => blank(r.stock) },
    { header: 'Shadow', value: (r) => blank(r.shadow) },
    { header: 'Par', value: (r) => blank(r.par) },
    { header: 'Velocity/day', value: (r) => (r.velocity === null ? '' : r.velocity.toFixed(2)) },
    { header: 'Runway d', value: (r) => (r.runway === null ? '' : Math.round(r.runway)) },
    { header: 'WAC', value: (r) => blank(r.wac) },
    { header: 'Your bottle price', value: (r) => blank(r.bottle) },
    { header: 'Your glass price', value: (r) => blank(r.glass) },
    { header: 'Value at cost', value: (r) => (r.value === null ? '' : r.value.toFixed(2)) },
    { header: 'Currency', value: () => currencyCode ?? '' },
  ];
}

/** Legacy's file name for one row: the title, slugged (InventoryCommandPage.tsx "Export this row"). */
export function rowFilename(row: InvRow): string {
  return (row.name ?? '').replace(/[^\w]+/g, '-').toLowerCase() || 'inventory-row';
}
