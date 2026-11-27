/**
 * The /inventory table — sketch INV-W4 frame 1, rows and their dropdown.
 *
 * Every title is listed and none is folded (founder, INV-W4 F-3). In "Needs
 * you first" the rows come in three groups — Out, Below par, then everything
 * else by runway — and each group is headed with its count; any other sort
 * is one list.
 *
 * A row is 48px and opens in place, like the orders ledger row: the whole
 * row is the hit area, and the title is a real button so the keyboard can
 * reach it (Enter or Space opens it; the dropdown sits in the next table
 * row, spanning every column).
 *
 * "Your price" reuses the legacy page's HousePriceCell for owners and
 * managers (it is where a price is changed, ADR 0193); everyone else reads
 * the two figures in the house's currency.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { HousePriceCell, type AdviceLoad } from '../command/HousePriceCell';
import RowDropdown, { type RowDropdownProps } from './RowDropdown';
import { useWarmRow } from './useInventoryNextData';
import { cellMoney, EM, fmtCount, fmtPace, noZoneWord, SEVERITY_GROUP, severity, typeLabel, type InvRow, type SortId } from './useInventoryNextData';
import { NameHint } from './NameThisWine';

export interface InventoryTableProps extends Omit<RowDropdownProps, 'row'> {
  rows: InvRow[];
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

/** How long the pointer rests on a row before its reads start: a sweep across the book reads nothing. */
export const WARM_REST_MS = 120;

const COLUMNS = ['Title', 'Type', 'Zone', 'Live / shadow · par', 'Vel/day', 'Runway', 'Your price', 'Value', 'Status'];

/** The headers that sort, and the sort each one sets. */
const HEADER_SORT: Partial<Record<string, SortId>> = { Title: 'name', 'Vel/day': 'pace', Value: 'value' };

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

/**
 * What a row draws is a function of the row, whether it is open or selected,
 * the currency, the group it heads and the few reads below. The callbacks that
 * change identity each render of the page ride in `fns`, a ref whose object
 * never changes, so a toggle redraws the two rows it touches and not all 330.
 */
interface TableRowProps {
  row: InvRow;
  open: boolean;
  selecting: boolean;
  selected: boolean;
  span: number;
  /** The severity this row heads, or null when it heads nothing. */
  groupSev: 0 | 1 | 2 | null;
  groupCount: number;
  currency: InventoryTableProps['currency'];
  canManage: boolean;
  advice: AdviceLoad;
  libraryUnread: boolean;
  locations: InventoryTableProps['locations'];
  locationsUnavailable: boolean;
  providers: InventoryTableProps['providers'];
  providersError: string | null;
  restaurantId: string | null;
  toggle: (id: string) => void;
  fns: { current: RowFns };
}
interface RowFns {
  zoneName: (id: string | null) => string;
  onPriceChanged: () => void;
  onSelect?: (id: string) => void;
  /** Reads the row's own reads ahead of the click: at once, or after the pointer has rested on it. */
  warm: (row: InvRow, now: boolean) => void;
  /** The pointer left, so a read that was waiting on a rest is dropped. */
  cool: () => void;
}

const TableRow = memo(function TableRow(p: TableRowProps) {
  const { row, open, selecting, selected, span, groupSev, groupCount, currency, canManage, advice, libraryUnread, locations, locationsUnavailable, providers, providersError, restaurantId, toggle, fns } = p;
  return (
    <>
                {groupSev !== null ? (
                  <tr className="iv-group">
                    <td colSpan={span}>
                      {SEVERITY_GROUP[groupSev!]}
                      {groupSev! < 2 ? <span className="iv-num"> {fmtCount(groupCount)}</span> : null}
                    </td>
                  </tr>
                ) : null}
                <tr
                  id={`iv-row-${row.id}`}
                  className="iv-row"
                  data-testid={`inv-row-${row.id}`}
                  data-standing={row.standing}
                  aria-selected={open}
                  onClick={() => toggle(row.id)}
                  onPointerEnter={open ? undefined : () => fns.current.warm(row, false)}
                  onPointerLeave={open ? undefined : () => fns.current.cool()}
                  onFocus={open ? undefined : () => fns.current.warm(row, true)}
                  onTouchStart={open ? undefined : () => fns.current.warm(row, true)}
                >
                  {selecting ? (
                    <td data-label="Select" className="iv-sel" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="iv-focus"
                        aria-label={`Select ${row.name ?? 'this title'}`}
                        checked={selected}
                        onChange={() => fns.current.onSelect?.(row.id)}
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
                        toggle(row.id);
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
                        {[row.producer, row.vintage === null ? null : String(row.vintage)].filter(Boolean).join(' · ') || EM}
                      </span>
                    </button>
                    <NameHint inventoryId={row.id} />
                  </td>
                  <td data-label="Type" className={row.type && row.type !== 'unclassified' ? undefined : 'iv-dim'}>
                    {row.type ? typeLabel(row.type) : libraryUnread ? EM : 'not recorded'}
                  </td>
                  <td data-label="Zone">{zoneCell(row, fns.current.zoneName, locationsUnavailable)}</td>
                  <td data-label="Live / shadow · par" className="iv-r iv-num">
                    <span>
                      {row.stock === null ? EM : fmtCount(row.stock)}
                      <span className="iv-dim"> / {row.shadow === null ? EM : fmtCount(row.shadow)}</span>
                      {' · '}
                      {row.par === null ? EM : fmtCount(row.par)}
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
                    {canManage ? (
                      <HousePriceCell
                        inventoryId={row.id}
                        wineName={row.name ?? 'this title'}
                        bottle={row.bottle}
                        glass={row.glass}
                        advice={advice}
                        canEdit
                        onChanged={() => fns.current.onPriceChanged()}
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
                {open ? (
                  <tr className="iv-openrow">
                    <td colSpan={span}>
                      <RowDropdown
                        row={row}
                        canManage={canManage}
                        currency={currency}
                        zoneName={fns.current.zoneName}
                        locations={locations}
                        locationsUnavailable={locationsUnavailable}
                        providers={providers}
                        providersError={providersError}
                        restaurantId={restaurantId}
                      />
                    </td>
                  </tr>
                ) : null}
              </>
  );
});

/** Rows drawn on the first pass; the rest follow in slices after the first paint. */
const FIRST_ROWS = 60;
const SLICE_ROWS = 90;

export default function InventoryTable(props: InventoryTableProps) {
  const { rows, grouped, openId, onToggle, currency, canManage, advice, onPriceChanged, zoneName } = props;
  const counts = [0, 0, 0];
  for (const r of rows) counts[severity(r)] += 1;
  const selecting = props.selected !== undefined && props.onSelect !== undefined;
  const span = COLUMNS.length + (selecting ? 1 : 0);
  const allSelected = selecting && rows.length > 0 && rows.every((r) => props.selected!.has(r.id));
  const someSelected = selecting && !allSelected && rows.some((r) => props.selected!.has(r.id));

  // The page hands new function objects every render; rows read the latest
  // through this ref and take a toggle whose identity never changes.
  const warmRow = useWarmRow();
  const resting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cool = useCallback(() => clearTimeout(resting.current), []);
  useEffect(() => cool, [cool]);
  const warm = (row: InvRow, now: boolean) => {
    clearTimeout(resting.current);
    const go = () => warmRow({ id: row.id, name: row.name });
    if (now) go();
    else resting.current = setTimeout(go, WARM_REST_MS);
  };
  const fns = useRef<RowFns>({ zoneName, onPriceChanged, onSelect: props.onSelect, warm, cool });
  fns.current = { zoneName, onPriceChanged, onSelect: props.onSelect, warm, cool };
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const toggle = useCallback((id: string) => onToggleRef.current(id), []);

  // 330 rows laid out at once was 250 ms of one task. The first rows draw now,
  // the rest in slices after the paint, always from the top, so nothing in view
  // moves. The open row is never left out: a link to a late title still finds it.
  const [shown, setShown] = useState(FIRST_ROWS);
  useEffect(() => {
    if (shown >= rows.length) return;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setShown((n) => n + SLICE_ROWS), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [shown, rows.length]);
  const openAt = openId === null ? -1 : rows.findIndex((r) => r.id === openId);
  const upTo = Math.max(shown, openAt + 1);
  const drawn = upTo >= rows.length ? rows : rows.slice(0, upTo);

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
                    Your price <span className="iv-dim">btl · glass</span>
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
                    Your price <span className="iv-dim">btl · glass</span>
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
          {drawn.map((row, i) => {
            const sev = severity(row);
            const startsGroup = grouped && (i === 0 || severity(rows[i - 1]) !== sev);
            return (
              <TableRow
                key={row.id}
                row={row}
                open={openId === row.id}
                selecting={selecting}
                selected={selecting && props.selected!.has(row.id)}
                span={span}
                groupSev={startsGroup ? sev : null}
                groupCount={startsGroup ? counts[sev] : 0}
                currency={currency}
                canManage={canManage}
                advice={advice}
                libraryUnread={props.libraryUnread === true}
                locations={props.locations}
                locationsUnavailable={props.locationsUnavailable}
                providers={props.providers}
                providersError={props.providersError}
                restaurantId={props.restaurantId}
                toggle={toggle}
                fns={fns}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
