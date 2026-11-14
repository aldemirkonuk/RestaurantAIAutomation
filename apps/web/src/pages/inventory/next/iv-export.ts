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

/**
 * The unit a person counts a good in, and how many of the book's units make one
 * of it (inventory r28, gap 3). The book keeps whole grams and millilitres
 * (ADR 0070), so flour is 12400 there. Written into a count sheet as 12400
 * under "System qty", with no unit, a counter who weighs in kilograms writes
 * 12.1 beside it: a thousandfold slip. The files say kg and l instead, as the
 * page does, and name the unit on every row. Saffron kept in mg reads in g.
 */
export function countUnit(uom: string | null | undefined): { unit: string; per: number } {
  switch (uom) {
    case 'g':
      return { unit: 'kg', per: 1000 };
    case 'mg':
      return { unit: 'g', per: 1000 };
    case 'ml':
      return { unit: 'l', per: 1000 };
    case null:
    case undefined:
    case '':
      return { unit: 'bottle', per: 1 };
    default:
      return { unit: uom, per: 1 };
  }
}

/** Units a bottle size means something for: a weighed, poured or loose good has none. */
const NO_BOTTLE = new Set(['g', 'kg', 'mg', 'ml', 'l', 'each']);

/** A book quantity in the counted unit: 12400 g is 12.4 (kg). Blank when it was not read. */
export function inCountUnit(v: number | null, uom: string | null | undefined): number | string {
  if (v === null) return '';
  const { per } = countUnit(uom);
  return per === 1 ? v : Number((v / per).toFixed(3));
}

/** A pace a day in the counted unit: two places for a count, three for kg or l. */
export function paceInCountUnit(v: number | null, uom: string | null | undefined): string {
  if (v === null) return '';
  const { per } = countUnit(uom);
  return per === 1 ? v.toFixed(2) : (v / per).toFixed(3);
}

/** The average cost of one counted unit: per kg, not per gram. Blank when unknown. */
export function wacInCountUnit(v: number | null, uom: string | null | undefined): number | string {
  if (v === null) return '';
  const { per } = countUnit(uom);
  return per === 1 ? v : Number((v * per).toFixed(4));
}

/** A bottle size only where the good is kept in containers; blank for flour, oil or loose items. */
export function bottleSizeCell(r: InvRow, uom: string | null | undefined): number | string {
  return uom && NO_BOTTLE.has(uom) ? '' : blank(r.bottleSizeMl);
}

export function valuationColumns(
  currencyCode: string | null,
  // Each row's own unit; absent means every row is a bottle, as the file always assumed.
  uomOf: (r: InvRow) => string | null = () => null,
): TableExportColumn<InvRow>[] {
  return [
    { header: 'Title', value: (r) => r.name ?? '' },
    { header: 'Producer', value: (r) => r.producer ?? '' },
    { header: 'Type', value: (r) => (r.type === null ? '' : typeLabel(r.type)) },
    { header: 'Unit', value: (r) => countUnit(uomOf(r)).unit },
    { header: 'Live', value: (r) => inCountUnit(r.stock, uomOf(r)) },
    { header: 'Shadow', value: (r) => inCountUnit(r.shadow, uomOf(r)) },
    { header: 'Par', value: (r) => inCountUnit(r.par, uomOf(r)) },
    { header: 'Velocity/day', value: (r) => paceInCountUnit(r.velocity, uomOf(r)) },
    { header: 'Runway d', value: (r) => (r.runway === null ? '' : Math.round(r.runway)) },
    { header: 'WAC', value: (r) => wacInCountUnit(r.wac, uomOf(r)) },
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
