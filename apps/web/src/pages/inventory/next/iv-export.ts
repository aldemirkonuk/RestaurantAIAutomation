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
import { fmtCount, goodKind, isDrinkKind, kindLabel, noZoneWord, typeLabel, type InvRow } from './useInventoryNextData';

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
 * What the Location cell says for a row: the first zone holding stock, else
 * "Unassigned" for stock outside every zone, else the no-zone word. The count
 * sheet is sorted on this same text, so the order is what the person reads.
 */
export function locationCell(row: InvRow, zoneName: (id: string | null) => string): string {
  if (row.zones === null) return '';
  const first = row.zones.find((z) => z.locationId !== null && z.qty > 0);
  if (first) return zoneName(first.locationId);
  if (row.zones.some((z) => z.qty > 0)) return 'Unassigned';
  return noZoneWord(row.stock) ?? '';
}

/**
 * The unit the quantities are in: the good's own unit, else "bottle" for a
 * drink with none recorded, else blank. It only labels the ledger base unit;
 * no figure is converted (#1373 holds the kg/l conversion).
 */
export function unitWord(row: InvRow): string {
  if (row.uom) return row.uom;
  return isDrinkKind(goodKind(row)) ? 'bottle' : '';
}

export const KIND_HEADER = 'Kind';
export const UNIT_HEADER = 'Unit';
export const VENDOR_HEADER = 'Vendor';

export const kindColumn: TableExportColumn<InvRow> = { header: KIND_HEADER, value: (r) => kindLabel(goodKind(r)) };
export const unitColumn: TableExportColumn<InvRow> = { header: UNIT_HEADER, value: (r) => unitWord(r) };
export const vendorColumn: TableExportColumn<InvRow> = { header: VENDOR_HEADER, value: (r) => r.providerName ?? '' };

/**
 * `nameHead` is the name column's head: "Title" for a drink, "Good" in a house of goods.
 * A house of goods has no producer, bottle price or glass price to write, so those
 * columns are left out of its file rather than sent empty. Every row carries its
 * Kind, Unit and Vendor.
 */
export function valuationColumns(currencyCode: string | null, nameHead = 'Title'): TableExportColumn<InvRow>[] {
  const goods = nameHead === 'Good';
  const cols: TableExportColumn<InvRow>[] = [
    { header: nameHead, value: (r) => r.name ?? '' },
    kindColumn,
    { header: 'Producer', value: (r) => r.producer ?? '' },
    { header: 'Type', value: (r) => (r.type === null ? '' : typeLabel(r.type)) },
    { header: 'Live', value: (r) => blank(r.stock) },
    { header: 'Shadow', value: (r) => blank(r.shadow) },
    { header: 'Par', value: (r) => blank(r.par) },
    unitColumn,
    { header: 'Velocity/day', value: (r) => (r.velocity === null ? '' : r.velocity.toFixed(2)) },
    { header: 'Runway d', value: (r) => (r.runway === null ? '' : Math.round(r.runway)) },
    { header: 'WAC', value: (r) => blank(r.wac) },
    { header: 'Your bottle price', value: (r) => blank(r.bottle) },
    { header: 'Your glass price', value: (r) => blank(r.glass) },
    { header: 'Value at cost', value: (r) => (r.value === null ? '' : r.value.toFixed(2)) },
    vendorColumn,
    { header: 'Currency', value: () => currencyCode ?? '' },
  ];
  return forHouse(goods, cols);
}

/** A house of goods' file without the drink-only columns; a house with a drink keeps them all. */
export function forHouse<T>(goods: boolean, columns: TableExportColumn<T>[]): TableExportColumn<T>[] {
  return goods ? columns.filter((c) => !DRINK_ONLY_HEADERS.has(c.header)) : columns;
}

/** Columns that only a drink fills: left out of a house of goods' files. */
export const DRINK_ONLY_HEADERS: ReadonlySet<string> = new Set([
  'Producer',
  'Vintage',
  'Bottle size (ml)',
  'Your bottle price',
  'Your glass price',
]);

/**
 * The count sheet's order: where it sits (the Location cell, stock outside any
 * zone last), then what kind of good, then its name. Rows that tie keep the
 * order they came in. Reorders rows only; no figure changes.
 */
export function sortCountSheet(rows: InvRow[], zoneName: (id: string | null) => string): InvRow[] {
  const keyed = rows.map((r, i) => {
    const loc = locationCell(r, zoneName);
    return { r, i, loc, last: loc === '' || loc === 'Unassigned' || loc === 'none on hand', kind: kindLabel(goodKind(r)), name: r.name ?? '' };
  });
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  keyed.sort(
    (a, b) =>
      Number(a.last) - Number(b.last) || cmp(a.loc, b.loc) || cmp(a.kind, b.kind) || cmp(a.name, b.name) || a.i - b.i,
  );
  return keyed.map((k) => k.r);
}

/** The columns of the count sheet (the sheet someone walks the shelves with). */
export function countSheetColumns(nameHead: string, zoneName: (id: string | null) => string, observation: (r: InvRow) => string): TableExportColumn<InvRow>[] {
  return [
    { header: 'Location', value: (r) => locationCell(r, zoneName) },
    { header: nameHead, value: (r) => r.name ?? '' },
    kindColumn,
    { header: 'Producer', value: (r) => r.producer ?? '' },
    { header: 'Vintage', value: (r) => blank(r.vintage) },
    { header: 'Type', value: (r) => (r.type === null ? '' : typeLabel(r.type)) },
    { header: 'Bottle size (ml)', value: (r) => blank(r.bottleSizeMl) },
    unitColumn,
    { header: 'System qty (live)', value: (r) => blank(r.stock) },
    { header: 'System qty (shadow)', value: (r) => blank(r.shadow) },
    { header: 'Par', value: (r) => blank(r.par) },
    { header: 'Counted qty', value: () => '' },
    { header: 'Variance', value: () => '' },
    // Legacy's columns (InventoryCommandPage.tsx:605-660), with Last counted kept
    // beside Days since counted. An unread figure stays blank, never a 0.
    { header: 'Days since counted', value: (r) => daysSinceCountedCell(r.lastCountedAt) },
    { header: 'Last counted', value: (r) => r.lastCountedAt ?? '' },
    { header: 'Velocity/day', value: (r) => (r.velocity === null ? '' : r.velocity.toFixed(2)) },
    { header: 'Runway d', value: (r) => (r.runway === null ? '' : Math.round(r.runway)) },
    { header: 'WAC', value: (r) => blank(r.wac) },
    { header: 'Value', value: (r) => (r.value === null ? '' : r.value.toFixed(2)) },
    vendorColumn,
    { header: 'Observation', value: (r) => observation(r) },
  ];
}

/** Legacy's file name for one row: the title, slugged (InventoryCommandPage.tsx "Export this row"). */
export function rowFilename(row: InvRow): string {
  return (row.name ?? '').replace(/[^\w]+/g, '-').toLowerCase() || 'inventory-row';
}

/** The cost columns the exports carry: WAC and value (the count sheet's "Value", the valuation's "Value at cost"). */
export const COST_HEADERS: ReadonlySet<string> = new Set(['WAC', 'Value', 'Value at cost']);

/**
 * The columns this reader may take away: all of them for an owner or a
 * manager, the counts and prices without the cost for staff (inventory r28
 * audit, gap 9; the gateway withholds the figures too, #1355).
 */
export function costColumnsFor<T>(columns: TableExportColumn<T>[], canManage: boolean): TableExportColumn<T>[] {
  return canManage ? columns : columns.filter((c) => !COST_HEADERS.has(c.header));
}
