/**
 * The /inventory table — sketch INV-W4 frame 1, rows and their dropdown.
 *
 * Every title is listed and none is folded (founder, INV-W4 F-3). In "Needs
 * you first" the rows come in three groups — Out, Below par, then everything
 * else by runway — and each group is headed with its count; any other sort
 * is one list.
 *
 * A row is 48px and opens the item drawer (ItemDrawer.tsx): the whole row
 * is the hit area, and the title is a real button so the keyboard can reach
 * it (Enter or Space opens it).
 *
 * "Your price" reuses the legacy page's HousePriceCell for owners and
 * managers (it is where a price is changed, ADR 0193); everyone else reads
 * the two figures in the house's currency.
 */
import { Fragment } from 'react';
import { HousePriceCell, type AdviceLoad } from '../command/HousePriceCell';
import type { RowDropdownProps } from './RowDropdown';
import { cellMoney, EM, fmtCount, fmtPace, noZoneWord, SEVERITY_GROUP, severity, typeLabel, type InvRow, type SortId } from './useInventoryNextData';
import { NameHint } from './NameThisWine';
import { fmtQty } from './ItemCards';

export interface InventoryTableProps extends Omit<RowDropdownProps, 'row'> {
  rows: InvRow[];
  /** Each row's own unit (g, ml, each…); absent or null is a bottle, drawn bare as before. */
  uomOf?: (r: InvRow) => string | null;
  /** Whether a row is a drink, a food or a supply. Absent = every row is a drink, drawn as before. */
  goodOf?: (r: InvRow) => 'food' | 'supply' | 'drink';
  /** The wine library did not answer: a missing type is unknown, not "not recorded" (INV-W28). */
  libraryUnread?: boolean;
  /** Head the rows by severity (the "Needs you first" sort). */
  grouped: boolean;
  openId: string | null;
  onToggle: (id: string) => void;
  advice: AdviceLoad;
  onPriceChanged: () => void;
  /** The sort in force, and how a sortable header sets one. Absent = plain headers. */
  sort?: SortId;
  onSort?: (sort: SortId) => void;
  /** Row selection (legacy NEW-064). Absent = no checkbox column. */
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  /** Selects every listed row, or clears them when all are already selected. */
  onSelectAll?: () => void;
}

const COLUMNS = ['Title', 'Type', 'Zone', 'Live / shadow · par', 'Vel/day', 'Runway', 'Your price', 'Value', 'Status'];

/** The headers that sort, and the sort each one sets. */
const HEADER_SORT: Partial<Record<string, SortId>> = { Title: 'name', 'Vel/day': 'pace', Value: 'value' };

/**
 * How the list says a good's unit (stored as whole g, ml or each, ADR 0070):
 * a weighed good is kept and costed by the kg, a poured one by the litre, a
 * counted one by the piece. Kept here, not borrowed from the drawer's cards,
 * so the two can word their own lines without breaking each other.
 */
export function goodUnit(uom: string): { factor: number; kept: string; per: string } {
  // Weight and volume read in kg and litres whatever unit the shelf stores (uom CHECK: mg, g, kg, ml, l).
  if (uom === 'mg') return { factor: 1_000_000, kept: 'kept in kg', per: 'a kg' };
  if (uom === 'g') return { factor: 1000, kept: 'kept in kg', per: 'a kg' };
  if (uom === 'kg') return { factor: 1, kept: 'kept in kg', per: 'a kg' };
  if (uom === 'ml') return { factor: 1000, kept: 'kept in litres', per: 'a litre' };
  if (uom === 'l') return { factor: 1, kept: 'kept in litres', per: 'a litre' };
  if (uom === 'each') return { factor: 1, kept: 'kept by the piece', per: 'each' };
  return { factor: 1, kept: `kept by the ${uom}`, per: `a ${uom}` };
}

/** The line that says what unit a good is kept in. */
function unitWord(uom: string | null): string {
  return uom === null ? EM : goodUnit(uom).kept;
}

/** A food or supply is costed, not priced: the average cost a unit, or a dash when none is known (ADR 0051/0053). */
function costCell(row: InvRow, uom: string | null, currency: RowDropdownProps['currency']) {
  // No recorded unit means no way to say what the cost is a: a dash, never a guessed bottle.
  if (row.wac === null || uom === null) return EM;
  const u = goodUnit(uom);
  return (
    <>
      <span className="iv-dim">cost </span>
      {cellMoney(row.wac * u.factor, currency)} {u.per}
    </>
  );
}

/** The status word, never a colour alone. */
function statusWord(row: InvRow): string {
  const dry = row.runway !== null && row.runway < 1.5;
  switch (row.standing) {
    case 'out':
      return 'Out';
    case 'below':
      return dry ? 'Below par · dry tomorrow' : 'Below par';
    case 'unknown':
      return 'Stock not read';
    case 'nopar':
      return dry ? 'Dry tomorrow' : 'No par set';
    default:
      return dry ? 'Dry tomorrow' : row.standing === 'at' ? 'At par' : 'Above par';
  }
}

function ParBar({ row }: { row: InvRow }) {
  if (row.stock === null || row.par === null || row.par <= 0) return null;
  const pct = Math.max(0, Math.min(1, row.stock / row.par)) * 100;
  return (
    <span className="iv-parbar" aria-hidden>
      <i data-standing={row.standing} style={{ width: `${pct}%` }} />
    </span>
  );
}

function zoneCell(row: InvRow, zoneName: (id: string | null) => string, unavailable: boolean): string {
  if (row.zones === null || unavailable) return EM;
  const held = row.zones.filter((z) => z.qty > 0);
  if (held.length === 0) return noZoneWord(row.stock) ?? EM;
  return held.map((z) => zoneName(z.locationId)).join(' · ');
}

export default function InventoryTable(props: InventoryTableProps) {
  const { rows, grouped, openId, onToggle, currency, canManage, advice, onPriceChanged, zoneName } = props;
  // A list that carries any food or supply cannot head the price column btl · glass.
  const goodOf = props.goodOf;
  const mixed = goodOf !== undefined && rows.some((r) => goodOf(r) !== 'drink');
  const counts = [0, 0, 0];
  for (const r of rows) counts[severity(r)] += 1;
  const selecting = props.selected !== undefined && props.onSelect !== undefined;
  const priceHead = mixed ? (
    <>
      Price <span className="iv-dim">or cost a unit</span>
    </>
  ) : (
    <>
      Your price <span className="iv-dim">btl · glass</span>
    </>
  );
  const span = COLUMNS.length + (selecting ? 1 : 0);
  const allSelected = selecting && rows.length > 0 && rows.every((r) => props.selected!.has(r.id));
  const someSelected = selecting && !allSelected && rows.some((r) => props.selected!.has(r.id));

  return (
    <div className="iv-tablewrap">
      <table className="iv-table" data-testid="inventory-table">
        {/* INV-W39: the book had no name and no heading, so a screen reader
            went from the page title straight to Tools. */}
        <caption className="sr-only">The book: every title on hand</caption>
        <thead>
          <tr>
            {selecting ? (
              <th className="iv-sel">
                <input
                  type="checkbox"
                  className="iv-focus"
                  aria-label={allSelected ? 'Clear the selection' : 'Select every listed title'}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={() => props.onSelectAll?.()}
                />
              </th>
            ) : null}
            {COLUMNS.map((c) => {
              // The legacy column-header sort (InventoryCommandPage.tsx:496,1337):
              // a header that has a sort sets it; clicking the active one goes
              // back to Needs you first. Each sort reads one direction.
              const key = HEADER_SORT[c];
              const on = key !== undefined && props.sort === key;
              const label =
                c === 'Your price' ? (
                  <>
                    {priceHead}
                  </>
                ) : c === 'Value' ? (
                  <>
                    Value <span className="iv-dim">at cost</span>
                  </>
                ) : (
                  c
                );
              return (
              <th
                key={c}
                className={c === 'Title' || c === 'Type' || c === 'Zone' || c === 'Status' ? undefined : 'iv-r'}
                aria-sort={on ? (key === 'name' ? 'ascending' : 'descending') : undefined}
              >
                {key !== undefined && props.onSort ? (
                  <button
                    type="button"
                    className="iv-thsort iv-focus"
                    data-on={on}
                    onClick={() => props.onSort?.(on ? 'needs' : key)}
                  >
                    {label}
                  </button>
                ) : c === 'Your price' ? (
                  <>
                    {priceHead}
                  </>
                ) : c === 'Value' ? (
                  <>
                    Value <span className="iv-dim">at cost</span>
                  </>
                ) : (
                  c
                )}
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const sev = severity(row);
            // A good kept in g, ml or another unit says it (12.4 kg); a bottle stays a bare count.
            const uom = props.uomOf?.(row) ?? null;
            const good = goodOf?.(row) ?? 'drink';
            const qty = (n: number) => (uom === null || uom === 'bottle' ? fmtCount(n) : fmtQty(n, uom));
            const startsGroup = grouped && (i === 0 || severity(rows[i - 1]) !== sev);
            const open = openId === row.id;
            return (
              <Fragment key={row.id}>
                {startsGroup ? (
                  <tr className="iv-group">
                    <td colSpan={span}>
                      {SEVERITY_GROUP[sev]}
                      {sev < 2 ? <span className="iv-num"> {fmtCount(counts[sev])}</span> : null}
                    </td>
                  </tr>
                ) : null}
                <tr
                  id={`iv-row-${row.id}`}
                  className="iv-row"
                  data-testid={`inv-row-${row.id}`}
                  data-standing={row.standing}
                  aria-selected={open}
                  onClick={() => onToggle(row.id)}
                >
                  {selecting ? (
                    <td data-label="Select" className="iv-sel" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="iv-focus"
                        aria-label={`Select ${row.name ?? 'this title'}`}
                        checked={props.selected!.has(row.id)}
                        onChange={() => props.onSelect!(row.id)}
                      />
                    </td>
                  ) : null}
                  <td data-label="Title" className="iv-title">
                    <button
                      type="button"
                      className="iv-titlebtn iv-focus"
                      data-row-id={row.id}
                      aria-expanded={open}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(row.id);
                      }}
                    >
                      <span className="iv-name">
                        {row.name ?? 'Unnamed title'}
                        {row.abc ? (
                          <span className="iv-abc" data-testid="inv-abc" title={`ABC class ${row.abc}`}>
                            {row.abc}
                          </span>
                        ) : null}
                      </span>
                      <span className="iv-producer">
                        {good === 'drink'
                          ? [row.producer, row.vintage === null ? null : String(row.vintage)].filter(Boolean).join(' · ') || EM
                          : unitWord(uom)}
                      </span>
                    </button>
                    <NameHint inventoryId={row.id} />
                  </td>
                  {good === 'drink' ? (
                    <td data-label="Type" className={row.type && row.type !== 'unclassified' ? undefined : 'iv-dim'}>
                      {row.type ? typeLabel(row.type) : props.libraryUnread ? EM : 'not recorded'}
                    </td>
                  ) : (
                    <td data-label="Type">{good === 'food' ? 'Food' : 'Supply'}</td>
                  )}
                  <td data-label="Zone">{zoneCell(row, zoneName, props.locationsUnavailable)}</td>
                  <td data-label="Live / shadow · par" className="iv-r iv-num">
                    <span>
                      {row.stock === null ? EM : qty(row.stock)}
                      <span className="iv-dim"> / {row.shadow === null ? EM : qty(row.shadow)}</span>
                      {' · '}
                      {row.par === null ? EM : qty(row.par)}
                    </span>
                    <ParBar row={row} />
                  </td>
                  <td data-label="Vel/day" className="iv-r iv-num">
                    {row.velocity === null ? EM : fmtPace(row.velocity)}
                  </td>
                  <td data-label="Runway" className="iv-r iv-num">
                    {row.runway === null ? EM : `${fmtCount(Math.round(row.runway))}d`}
                  </td>
                  <td data-label="Your price" className="iv-r iv-num" onClick={(e) => e.stopPropagation()}>
                    {good !== 'drink' ? (
                      costCell(row, uom, currency)
                    ) : canManage ? (
                      <HousePriceCell
                        inventoryId={row.id}
                        wineName={row.name ?? 'this title'}
                        bottle={row.bottle}
                        glass={row.glass}
                        advice={advice}
                        canEdit
                        onChanged={onPriceChanged}
                        money={(n) => cellMoney(n, currency)}
                      />
                    ) : (
                      <>
                        {cellMoney(row.bottle, currency)}
                        <span className="iv-dim"> · </span>
                        {cellMoney(row.glass, currency)}
                      </>
                    )}
                  </td>
                  <td data-label="Value at cost" className="iv-r iv-num">
                    {cellMoney(row.value, currency)}
                  </td>
                  <td data-label="Status" className="iv-status" data-standing={row.standing}>
                    {statusWord(row)}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
