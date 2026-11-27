/**
 * The /inventory table — sketch INV-W4 frame 1, rows and their dropdown.
 *
 * Every title is listed and none is folded (founder, INV-W4 F-3). In "Needs
 * you first" the rows come in three groups — Out, Below par, then everything
 * else by runway — and each group is headed with its count; any other sort
 * is one list.
 *
 * A row is 56px and opens the item drawer (ItemDrawer.tsx): the whole row
 * is the hit area, and the title is a real button so the keyboard can reach
 * it (Enter or Space opens it).
 *
 * "Your price" reuses the legacy page's HousePriceCell for owners and
 * managers (it is where a price is changed, ADR 0193); everyone else reads
 * the two figures in the house's currency.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HousePriceCell, type AdviceLoad } from '../command/HousePriceCell';
import type { RowDropdownProps } from './RowDropdown';
import { cellMoney, EM, statusWord, fmtCount, noZoneWord, SEVERITY_GROUP, severity, typeLabel, type InvRow, type SortId } from './useInventoryNextData';
import { NameHint } from './NameThisWine';
import { listFigure, listPace, listUnitTail } from './ItemCards';
import PhoneRows from './PhoneRows';
import { useItemPrefetch } from './use-item-prefetch';
import { emptyColumns } from './iv-columns';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { rowOffsets, useRowWindow } from './useRowWindow';

export interface InventoryTableProps extends Omit<RowDropdownProps, 'row'> {
  rows: InvRow[];
  /** The list's "Used in" count: open this good scrolled to where it is used. */
  onUsedIn?: (id: string) => void;
  /** What one row is called in the table's caption: "title" for a drink, "good" for a house of goods. */
  thing?: string;
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

/** The table's row and group-head heights (inventory-next.css .iv-row, .iv-group td). */
export const ROW_PX = 56;
export const GROUP_PX = 30;

const COLUMNS = ['Title', 'Type', 'Zone', 'Live / shadow · par', 'Vel/day', 'Runway', 'Your price', 'Value', 'Used in', 'Status'];

/** The headers that sort, and the sort each one sets. */
const HEADER_SORT: Partial<Record<string, SortId>> = { Title: 'name', 'Vel/day': 'pace', Value: 'value', 'Used in': 'used' };

function ParBar({ row }: { row: InvRow }) {
  if (row.stock === null || row.par === null || row.par <= 0) return null;
  const pct = Math.max(0, Math.min(1, row.stock / row.par)) * 100;
  return (
    <span className="iv-parbar" aria-hidden>
      <i data-standing={row.standing} style={{ transform: `scaleX(${pct / 100})` }} />
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
 * the currency, the group it heads and the few reads below. The windowing above
 * owns which rows exist; this only stops a row that did not change from being
 * drawn again. The callbacks that change identity each render of the page ride
 * in `fns`, a ref whose object never changes, so a toggle redraws the two rows
 * it touches and not every drawn row (r108-3, from #2199).
 */
interface TableRowProps {
  row: InvRow;
  open: boolean;
  selecting: boolean;
  selected: boolean;
  span: number;
  /** aria-rowindex of the row's own line, group heads above it counted. */
  rowIndex: number;
  /** The severity this row heads, or null when it heads nothing. */
  groupSev: 0 | 1 | 2 | null;
  groupCount: number;
  thing: string;
  nameHead: string;
  hidden: ReadonlySet<string>;
  currency: InventoryTableProps['currency'];
  canManage: boolean;
  advice: AdviceLoad;
  libraryUnread: boolean;
  /** Not read here: a change of the house's zones must redraw the Zone cell. */
  locations: InventoryTableProps['locations'];
  locationsUnavailable: boolean;
  toggle: (id: string) => void;
  fns: { current: RowFns };
}
interface RowFns {
  zoneName: (id: string | null) => string;
  onPriceChanged: () => void;
  onSelect?: (id: string) => void;
  onUsedIn?: (id: string) => void;
}

const TableRow = memo(function TableRow(p: TableRowProps) {
  const { row, open, selecting, selected, span, rowIndex, groupSev, groupCount, thing, nameHead, hidden, currency, canManage, advice, libraryUnread, locationsUnavailable, toggle, fns } = p;
  // A counted good's unit is said once, after its last figure; nothing read, nothing to say.
  const tail = row.par === null && row.stock === null ? null : listUnitTail(row.uom, row.par ?? row.stock);
  return (
    <>
                {groupSev !== null ? (
                  <tr className="iv-group" aria-rowindex={rowIndex}>
                    <td colSpan={span}>
                      {SEVERITY_GROUP[groupSev]}
                      {groupSev < 2 ? <span className="iv-num"> {fmtCount(groupCount)}</span> : null}
                    </td>
                  </tr>
                ) : null}
                <tr
                  id={`iv-row-${row.id}`}
                  className="iv-row"
                  aria-rowindex={rowIndex + (groupSev !== null ? 1 : 0)}
                  data-testid={`inv-row-${row.id}`}
                  data-standing={row.standing}
                  aria-selected={open}
                  onClick={() => toggle(row.id)}
                >
                  {selecting ? (
                    <td data-label="Select" className="iv-sel" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="iv-focus"
                        aria-label={`Select ${row.name ?? `this ${thing}`}`}
                        checked={selected}
                        onChange={() => fns.current.onSelect?.(row.id)}
                      />
                    </td>
                  ) : null}
                  <td data-label={nameHead} className="iv-title">
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
                        {row.name ?? `Unnamed ${thing}`}
                        {row.abc ? (
                          <span className="iv-abc" data-testid="inv-abc" title={`ABC class ${row.abc}`}>
                            {row.abc}
                          </span>
                        ) : null}
                      </span>
                      {/* No producer and no vintage: no line, never a bare dash (N-18). */}
                      {row.producer || row.vintage !== null ? (
                        <span className="iv-producer">
                          {[row.producer, row.vintage === null ? null : String(row.vintage)].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </button>
                    <NameHint inventoryId={row.id} />
                  </td>
{!hidden.has('Type') ? (
                  <td data-label="Type" className={row.type && row.type !== 'unclassified' ? undefined : 'iv-dim'}>
                    {row.type ? typeLabel(row.type) : libraryUnread ? EM : 'not recorded'}
                  </td>
 ) : null}
{!hidden.has('Zone') ? (
                  <td data-label="Zone">{zoneCell(row, fns.current.zoneName, locationsUnavailable)}</td>
 ) : null}
                  <td data-label="Live / shadow · par" className="iv-r iv-num">
                    <span>
                      <span className="iv-live">{listFigure(row.stock, row.uom)}</span>
                      <span className="iv-dim"> / {listFigure(row.shadow, row.uom)}</span>
                      {' · '}
                      {listFigure(row.par, row.uom)}
                      {tail === null ? null : ` ${tail}`}
                    </span>
                    <ParBar row={row} />
                  </td>
{!hidden.has('Vel/day') ? (
                  <td data-label="Vel/day" className="iv-r iv-num">
                    {row.velocity === null ? EM : listPace(row.velocity, row.uom)}
                  </td>
 ) : null}
{!hidden.has('Runway') ? (
                  <td data-label="Runway" className="iv-r iv-num">
                    {row.runway === null ? EM : `${fmtCount(Math.round(row.runway))}d`}
                  </td>
 ) : null}
{!hidden.has('Your price') ? (
                  <td data-label="Your price" className="iv-r iv-num" onClick={(e) => e.stopPropagation()}>
                    {canManage ? (
                      <HousePriceCell
                        inventoryId={row.id}
                        wineName={row.name ?? `this ${thing}`}
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
 ) : null}
{!hidden.has('Value') ? (
                  <td data-label="Value at cost" className="iv-r iv-num">
                    {row.rollupReadable ? cellMoney(row.value, currency) : 'could not be read'}
                  </td>
 ) : null}
{!hidden.has('Used in') ? (
                  <td data-label="Used in" className="iv-r iv-num" data-testid={`inv-usedin-${row.id}`}>
                    {row.usedIn === null ? (
                      <span className="iv-dim" title="Which recipes use this could not be read">unread</span>
                    ) : row.usedIn === undefined ? (
                      EM
                    ) : row.usedIn > 0 && fns.current.onUsedIn ? (
                      <button
                        type="button"
                        className="iv-linkish iv-focus"
                        aria-label={`Used in ${row.usedIn} ${row.usedIn === 1 ? 'recipe' : 'recipes'}: open where it is used`}
                        onClick={(e) => {
                          e.stopPropagation();
                          fns.current.onUsedIn?.(row.id);
                        }}
                      >
                        {row.usedIn}
                      </button>
                    ) : (
                      row.usedIn
                    )}
                  </td>
 ) : null}
                  <td data-label="Status" className="iv-status" data-standing={row.standing}>
                    <span className="iv-dot" aria-hidden />
                    {statusWord(row)}
                  </td>
                </tr>
    </>
  );
});

export default function InventoryTable(props: InventoryTableProps) {
  const { rows, grouped, openId, onToggle, currency, canManage, advice, onPriceChanged, zoneName } = props;
  const kindOf = useCallback((id: string) => rows.find((r) => r.id === id)?.kind, [rows]);
  const prefetch = useItemPrefetch(props.restaurantId, kindOf);
  // A phone cannot read nine columns: it gets two-line cards (critic c2 P0-2).
  const phone = useIsPhone();
  // A column of nothing but dashes stays out of the way until asked for (N-18).
  const [showEmpty, setShowEmpty] = useState(false);
  const empty = emptyColumns({
    rows,
    canManage,
    libraryUnread: props.libraryUnread === true,
    locationsUnavailable: props.locationsUnavailable,
  });
  const hidden = showEmpty ? new Set<string>() : empty;
  const cols = COLUMNS.filter((c) => !hidden.has(c));
  // A new Set each render would redraw every row; the names are the identity.
  const hiddenKey = [...hidden].sort().join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableHidden = useMemo(() => hidden, [hiddenKey]);
  // The page hands new function objects every render; rows read the latest
  // through this ref and take a toggle whose identity never changes.
  const fns = useRef<RowFns>({ zoneName, onPriceChanged, onSelect: props.onSelect, onUsedIn: props.onUsedIn });
  fns.current = { zoneName, onPriceChanged, onSelect: props.onSelect, onUsedIn: props.onUsedIn };
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const toggle = useCallback((id: string) => onToggleRef.current(id), []);
  const counts = [0, 0, 0];
  for (const r of rows) counts[severity(r)] += 1;
  const groupHeads = grouped ? counts.filter((c) => c > 0).length : 0;
  const selecting = props.selected !== undefined && props.onSelect !== undefined;
  const thing = props.thing ?? 'title';
  const nameHead = thing.charAt(0).toUpperCase() + thing.slice(1);
  const span = cols.length + (selecting ? 1 : 0);
  const allSelected = selecting && rows.length > 0 && rows.every((r) => props.selected!.has(r.id));
  const someSelected = selecting && !allSelected && rows.some((r) => props.selected!.has(r.id));

  // Only the rows near the screen are drawn (r104 g2); the list stays whole.
  const offsets = useMemo(
    () => rowOffsets(rows.length, ROW_PX, grouped ? GROUP_PX : 0, (i) => grouped && (i === 0 || severity(rows[i - 1]) !== severity(rows[i]))),
    [rows, grouped],
  );
  // Group heads above row i, read from the offsets (each head adds GROUP_PX).
  const heads = (i: number) => (grouped ? Math.round((offsets[i] - i * ROW_PX) / GROUP_PX) : 0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focused = focusId === null ? -1 : rows.findIndex((r) => r.id === focusId);
  const anchor = useRef(openId === null ? null : rows.findIndex((r) => r.id === openId)).current;
  const win = useRowWindow({ n: rows.length, offsets, listRef: wrapRef, anchor: anchor !== null && anchor >= 0 ? anchor : null, focused });
  // A row opened from outside the window (not by a tap on it) is brought in and into view.
  const openAt = openId === null ? -1 : rows.findIndex((r) => r.id === openId);
  const { jumpTo, start: winStart, end: winEnd } = win;
  // A row a link named is already drawn at the first paint (the anchor above);
  // the page is put on it before that paint, at once, so nothing is drawn at
  // the top and then carried a long way down (r106 F6).
  useLayoutEffect(() => {
    if (phone || anchor === null || anchor < 0) return;
    document.getElementById(`iv-row-${openId}`)?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    // Only the first paint; a later open is the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phone || openAt < 0 || (openAt >= winStart && openAt < winEnd)) return;
    jumpTo(openAt);
    const t = window.requestAnimationFrame(() => document.getElementById(`iv-row-${openId}`)?.scrollIntoView?.({ block: 'center', behavior: 'instant' }));
    return () => window.cancelAnimationFrame(t);
    // Only a change of the opened row moves the window; scrolling past it must not drag it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  if (phone) {
    return (
      <PhoneRows
        rows={rows}
        thing={thing}
        grouped={grouped}
        openId={openId}
        onToggle={onToggle}
        canManage={canManage}
        currency={currency}
        advice={advice}
        onPriceChanged={onPriceChanged}
        selected={props.selected}
        onSelect={props.onSelect}
        onSelectAll={props.onSelectAll}
        prefetch={prefetch}
      />
    );
  }

  return (
    <div
      className="iv-tablewrap"
      ref={wrapRef}
      onFocus={(e) => {
        setFocusId((e.target as HTMLElement).closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null);
        prefetch.onFocusRow(e);
      }}
      onBlur={() => {
        setFocusId(null);
        prefetch.onBlurRow();
      }}
      onPointerOver={prefetch.onPointerOver}
      onPointerOut={prefetch.onPointerOut}
      onPointerDown={prefetch.onPointerDown}
      onPointerMove={prefetch.onPointerMove}
      onPointerUp={prefetch.onPointerUp}
      onPointerCancel={prefetch.onPointerCancel}
    >
      {empty.size > 0 ? (
        <div className="iv-colsbar">
          <button
            type="button"
            className="iv-colsbtn iv-focus"
            aria-pressed={showEmpty}
            data-testid="inv-columns"
            onClick={() => setShowEmpty((v) => !v)}
          >
            {showEmpty
              ? 'Hide empty columns'
              : `Columns · ${empty.size} empty ${empty.size === 1 ? 'column' : 'columns'} hidden · Show`}
          </button>
        </div>
      ) : null}
      <table className="iv-table" data-testid="inventory-table" aria-rowcount={rows.length + groupHeads + 1}>
        {/* INV-W39: the book had no name and no heading, so a screen reader
            went from the page title straight to Tools. */}
        <caption className="sr-only">The book: every {thing} on hand</caption>
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
            {cols.map((c) => {
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
                ) : c === 'Title' ? (
                  nameHead
                ) : (
                  c
                );
              return (
              <th
                key={c}
                className={c === 'Title' || c === 'Type' || c === 'Zone' || c === 'Status' ? undefined : 'iv-r'}
                // Name A to Z and Used in fewest first run up; Value and Vel/day, biggest first, run down.
                aria-sort={on ? (key === 'name' || key === 'used' ? 'ascending' : 'descending') : undefined}
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
          {win.before > 0 ? (
            <tr aria-hidden="true" data-testid="inv-rows-before">
              <td colSpan={span} style={{ height: win.before, padding: 0, border: 0 }} />
            </tr>
          ) : null}
          {rows.slice(win.start, win.end).map((row, k) => {
            const i = win.start + k;
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
                rowIndex={i + heads(i) + 2}
                groupSev={startsGroup ? sev : null}
                groupCount={startsGroup ? counts[sev] : 0}
                thing={thing}
                nameHead={nameHead}
                hidden={stableHidden}
                currency={currency}
                canManage={canManage}
                advice={advice}
                libraryUnread={props.libraryUnread === true}
                locations={props.locations}
                locationsUnavailable={props.locationsUnavailable}
                toggle={toggle}
                fns={fns}
              />
            );
          })}
          {win.after > 0 ? (
            <tr aria-hidden="true" data-testid="inv-rows-after">
              <td colSpan={span} style={{ height: win.after, padding: 0, border: 0 }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
