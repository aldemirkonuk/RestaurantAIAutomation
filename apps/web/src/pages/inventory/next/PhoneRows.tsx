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
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HousePriceCell, type AdviceLoad } from '../command/HousePriceCell';
import { cellMoney, fmtCount, SEVERITY_GROUP, severity, statusWord, type HouseCurrency, type InvRow } from './useInventoryNextData';
import { NameHint } from './NameThisWine';
import { listFigure, listUnitTail } from './ItemCards';
import { rowOffsets, useRowWindow } from './useRowWindow';

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
  /** A tap on the Used in chip: open the sheet at the Used in group. */
  onUsedIn?: (id: string) => void;
}

/** The first few cards rise in one after another (18 ms apart, 200 ms each, the last done by 308 ms); card 7 on is just there. */
const STAGGER_CARDS = 6;

/** A card's least height (inventory-next.css .ivc-card) with room for its price control; a group head's. */
const CARD_PX = 72;
const GROUP_HEAD_PX = 40;

/**
 * "Used in 3 recipes", the table column's count on a card. It reads the same
 * field: null is a read that failed, undefined one that has not landed, and
 * neither is ever said as 0. A count above 0 is a 44 px tap that opens the
 * sheet on its Used in group; 0 is plain words, there is nothing to open.
 */
export function UsedInChip({ row, onUsedIn }: { row: InvRow; onUsedIn?: (id: string) => void }) {
  const n = row.usedIn;
  if (n === null) return <span className="ivc-used ivc-used--dim" data-testid={`inv-usedin-${row.id}`}>Used in: could not be read</span>;
  if (n === undefined) return <span className="ivc-used ivc-used--dim" data-testid={`inv-usedin-${row.id}`}>Used in: not read yet</span>;
  const words = `Used in ${n} ${n === 1 ? 'recipe' : 'recipes'}`;
  if (n === 0 || !onUsedIn) return <span className="ivc-used ivc-used--dim" data-testid={`inv-usedin-${row.id}`}>{words}</span>;
  return (
    <button
      type="button"
      className="ivc-used ivc-used--tap iv-focus"
      data-testid={`inv-usedin-${row.id}`}
      aria-label={`${words}: open where it is used`}
      onClick={() => onUsedIn(row.id)}
    >
      {words}
    </button>
  );
}

export default function PhoneRows(props: PhoneRowsProps) {
  const { rows, thing, grouped, openId, onToggle, canManage, currency, advice, onPriceChanged } = props;
  const selecting = props.selected !== undefined && props.onSelect !== undefined;
  const counts = [0, 0, 0];
  for (const r of rows) counts[severity(r)] += 1;
  const allSelected = selecting && rows.length > 0 && rows.every((r) => props.selected!.has(r.id));

  // Only the cards near the screen are drawn (r104 g2); the list stays whole.
  // A card is at least 64 px and grows with its price control, so the height
  // standing for the cards not drawn is the average of the ones that are.
  const [cardPx, setCardPx] = useState(CARD_PX);
  const offsets = useMemo(
    () => rowOffsets(rows.length, cardPx, grouped ? GROUP_HEAD_PX : 0, (i) => grouped && (i === 0 || severity(rows[i - 1]) !== severity(rows[i]))),
    [rows, grouped, cardPx],
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focused = focusId === null ? -1 : rows.findIndex((r) => r.id === focusId);
  const anchor = useRef(openId === null ? null : rows.findIndex((r) => r.id === openId)).current;
  const win = useRowWindow({ n: rows.length, offsets, listRef, anchor: anchor !== null && anchor >= 0 ? anchor : null, focused });
  const openAt = openId === null ? -1 : rows.findIndex((r) => r.id === openId);
  const { jumpTo, start: winStart, end: winEnd } = win;
  useEffect(() => {
    if (openAt < 0 || (openAt >= winStart && openAt < winEnd)) return;
    jumpTo(openAt);
    const t = window.requestAnimationFrame(() => document.querySelector(`[data-row-id="${CSS.escape(openId as string)}"]`)?.scrollIntoView?.({ block: 'center' }));
    return () => window.cancelAnimationFrame(t);
    // Only a change of the opened card moves the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  useEffect(() => {
    const cards = listRef.current?.querySelectorAll<HTMLElement>('.ivc-card');
    if (!cards || cards.length === 0) return;
    let sum = 0;
    cards.forEach((c) => (sum += c.offsetHeight));
    const avg = Math.round(sum / cards.length);
    if (avg > 0 && Math.abs(avg - cardPx) > 2) setCardPx(avg);
  }, [win.start, win.end, cardPx]);

  return (
    <div
      className="ivc-list"
      ref={listRef}
      onFocus={(e) => setFocusId((e.target as HTMLElement).closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null)}
      onBlur={() => setFocusId(null)}
      data-testid="inventory-cards"
      role="group"
      aria-label={`The book: every ${thing} on hand`}
    >
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
      {win.before > 0 ? <div aria-hidden="true" data-testid="inv-cards-before" style={{ height: win.before }} /> : null}
      {rows.slice(win.start, win.end).map((row, k) => {
        const i = win.start + k;
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
              <UsedInChip row={row} onUsedIn={props.onUsedIn} />
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
      {win.after > 0 ? <div aria-hidden="true" data-testid="inv-cards-after" style={{ height: win.after }} /> : null}
    </div>
  );
}
