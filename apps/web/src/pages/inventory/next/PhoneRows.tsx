/**
 * /inventory on a phone: one good is two lines, not nine (N-11, critic c2 P0-2).
 *
 * Line one is the name and how it stands; line two is "12 live · par 4" and the
 * house's price. Tapping the card opens the SAME item drawer the table row
 * opens (a bottom sheet on a phone). The table is for a screen wide enough to
 * read nine columns; below 768 px InventoryTable hands its rows to this list.
 *
 * Status is said in a word as well as a dot, so colour never carries it alone.
 * An unread count is a dash, never zero. A manager still sets the price from
 * the card: the price sits beside the tap target, not inside it.
 */
import { Fragment, type CSSProperties } from 'react';
import { HousePriceCell, type AdviceLoad } from '../command/HousePriceCell';
import { cellMoney, fmtCount, SEVERITY_GROUP, severity, statusWord, type HouseCurrency, type InvRow } from './useInventoryNextData';
import { NameHint } from './NameThisWine';
import { listFigure, listUnitTail } from './ItemCards';

/** "12 bottles", "2.5 kg", "—": the live count in the good's unit. */
function liveWords(row: InvRow): string {
  const figure = listFigure(row.stock, row.uom);
  const unit = row.stock === null ? null : listUnitTail(row.uom, row.stock);
  return unit === null ? figure : `${figure} ${unit}`;
}

export interface PhoneRowsProps {
  rows: InvRow[];
  thing: string;
  grouped: boolean;
  openId: string | null;
  onToggle: (id: string) => void;
  canManage: boolean;
  currency: HouseCurrency;
  advice: AdviceLoad;
  onPriceChanged: () => void;
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  onSelectAll?: () => void;
}

/** The first few cards rise in one after another (28 ms apart); card 9 on is just there. */
const STAGGER_CARDS = 8;

export default function PhoneRows(props: PhoneRowsProps) {
  const { rows, thing, grouped, openId, onToggle, canManage, currency, advice, onPriceChanged } = props;
  const selecting = props.selected !== undefined && props.onSelect !== undefined;
  const counts = [0, 0, 0];
  for (const r of rows) counts[severity(r)] += 1;
  const allSelected = selecting && rows.length > 0 && rows.every((r) => props.selected!.has(r.id));

  return (
    <div className="ivc-list" data-testid="inventory-cards" role="group" aria-label={`The book: every ${thing} on hand`}>
      {canManage && advice.status === 'ready' && !advice.targetSet ? (
        <p className="ivc-target" data-testid="inventory-no-target">
          <a href="/settings?tab=target-margin">No target margin is set</a>, so no price advice is given.
        </p>
      ) : null}
      {selecting && props.onSelectAll ? (
        <label className="ivc-selectall">
          <input type="checkbox" className="iv-focus" checked={allSelected} onChange={props.onSelectAll} />
          <span>Select every {thing} listed</span>
        </label>
      ) : null}
      {rows.map((row, i) => {
        const sev = severity(row);
        const startsGroup = grouped && (i === 0 || severity(rows[i - 1]) !== sev);
        const open = openId === row.id;
        const name = row.name ?? `Unnamed ${thing}`;
        const word = statusWord(row);
        const attention = row.standing === 'out' || row.standing === 'below' || row.standing === 'unknown' || word.includes('Dry');
        return (
          <Fragment key={row.id}>
            {startsGroup ? (
              <h3 className="ivc-group">
                {SEVERITY_GROUP[sev]}
                {sev < 2 ? <span className="iv-num"> {fmtCount(counts[sev])}</span> : null}
              </h3>
            ) : null}
            <div
              className="ivc-card"
              data-testid={`inv-row-${row.id}`}
              data-standing={row.standing}
              data-open={open}
              data-still={i >= STAGGER_CARDS ? 'true' : undefined}
              style={{ '--i': Math.min(i, STAGGER_CARDS) } as CSSProperties}
            >
              {selecting ? (
                <label className="ivc-pick">
                  <input
                    type="checkbox"
                    className="iv-focus"
                    aria-label={`Select ${name}`}
                    checked={props.selected!.has(row.id)}
                    onChange={() => props.onSelect!(row.id)}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="ivc-main iv-focus"
                data-row-id={row.id}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => onToggle(row.id)}
              >
                <span className="ivc-name">{name}</span>
                <span className="ivc-line ivc-sub">
                  <span className="iv-num">
                    {liveWords(row)} live · par {listFigure(row.par, row.uom)}
                  </span>
                  <span className="ivc-status" data-standing={row.standing}>
                    <span aria-hidden className="ivc-dot" />
                    <span className={attention ? 'ivc-word' : 'iv-sr'}>{word}</span>
                  </span>
                </span>
              </button>
              <div className="ivc-price iv-num">
                {canManage ? (
                  <HousePriceCell
                    inventoryId={row.id}
                    wineName={name}
                    bottle={row.bottle}
                    glass={row.glass}
                    advice={advice}
                    canEdit
                    hideNoTarget
                    onChanged={onPriceChanged}
                    money={(n) => cellMoney(n, currency)}
                  />
                ) : (
                  cellMoney(row.bottle, currency)
                )}
              </div>
              <NameHint inventoryId={row.id} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
