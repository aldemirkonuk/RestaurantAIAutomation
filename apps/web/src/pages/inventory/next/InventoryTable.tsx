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
import { Fragment } from 'react';
import { HousePriceCell, type AdviceLoad } from '../command/HousePriceCell';
import RowDropdown, { type RowDropdownProps } from './RowDropdown';
import { cellMoney, EM, fmtCount, fmtPace, SEVERITY_GROUP, severity, typeLabel, type InvRow } from './useInventoryNextData';

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
}

const COLUMNS = ['Title', 'Type', 'Zone', 'Live / shadow · par', 'Vel/day', 'Runway', 'Your price', 'Value', 'Status'];

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
  if (held.length === 0) return 'in no zone';
  return held.map((z) => zoneName(z.locationId)).join(' · ');
}

export default function InventoryTable(props: InventoryTableProps) {
  const { rows, grouped, openId, onToggle, currency, canManage, advice, onPriceChanged, zoneName } = props;
  const counts = [0, 0, 0];
  for (const r of rows) counts[severity(r)] += 1;

  return (
    <div className="iv-tablewrap">
      <table className="iv-table" data-testid="inventory-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c} className={c === 'Title' || c === 'Type' || c === 'Zone' || c === 'Status' ? undefined : 'iv-r'}>
                {c === 'Your price' ? (
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
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const sev = severity(row);
            const startsGroup = grouped && (i === 0 || severity(rows[i - 1]) !== sev);
            const open = openId === row.id;
            return (
              <Fragment key={row.id}>
                {startsGroup ? (
                  <tr className="iv-group">
                    <td colSpan={COLUMNS.length}>
                      {SEVERITY_GROUP[sev]}
                      {sev < 2 ? <span className="iv-num"> {fmtCount(counts[sev])}</span> : null}
                    </td>
                  </tr>
                ) : null}
                <tr
                  className="iv-row"
                  data-testid={`inv-row-${row.id}`}
                  data-standing={row.standing}
                  aria-selected={open}
                  onClick={() => onToggle(row.id)}
                >
                  <td data-label="Title" className="iv-title">
                    <button
                      type="button"
                      className="iv-titlebtn iv-focus"
                      aria-expanded={open}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(row.id);
                      }}
                    >
                      <span className="iv-name">{row.name ?? 'Unnamed title'}</span>
                      <span className="iv-producer">
                        {[row.producer, row.vintage === null ? null : String(row.vintage)].filter(Boolean).join(' · ') || EM}
                      </span>
                    </button>
                  </td>
                  <td data-label="Type" className={row.type && row.type !== 'unclassified' ? undefined : 'iv-dim'}>
                    {row.type ? typeLabel(row.type) : props.libraryUnread ? EM : 'not recorded'}
                  </td>
                  <td data-label="Zone">{zoneCell(row, zoneName, props.locationsUnavailable)}</td>
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
                {open ? (
                  <tr className="iv-openrow">
                    <td colSpan={COLUMNS.length}>
                      <RowDropdown
                        row={row}
                        canManage={canManage}
                        currency={currency}
                        zoneName={zoneName}
                        locations={props.locations}
                        locationsUnavailable={props.locationsUnavailable}
                        providers={props.providers}
                        providersError={props.providersError}
                        restaurantId={props.restaurantId}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
