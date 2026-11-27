/**
 * One line of a drink's recipe: what it pours from, how much, and whether the
 * shelf counts it (proposal §2a).
 *
 * A counted line points at a thing on the house's shelf (F2). A line that is
 * not counted (garnish, ice, water, a top of soda) keeps its words and never
 * takes stock or costs anything, so choosing "Not counted" drops the link.
 * The amount and unit rules live in `units.ts`.
 */
import { useId, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import type { RecipeLineRole, RecipeLineStatus, ShelfItem } from '../../../../services/api/recipes';
import { RECIPE_UNITS, UNIT_LABEL, qtyText, readQty, type RecipeUnit } from './units';
import ShelfPicker, { kindWords } from './ShelfPicker';

export interface DraftRow {
  key: string;
  role: RecipeLineRole;
  inventoryId: string | null;
  itemName: string | null;
  itemKind: string | null;
  label: string;
  qtyText: string;
  /**
   * The number the server holds for this line, kept until the amount is
   * typed in. `qtyText` prints at most three decimals ("1.125"), which
   * `readQty` would refuse as "1125 or 1.125"; an amount the person did not
   * touch is never refused. Typing in the box drops it.
   */
  storedQty?: number | null;
  unit: RecipeUnit | '';
  /** What the server last said about this line; dropped once it is edited. */
  saved: { status: RecipeLineStatus; costPerServe: number | null; costBasis: string | null } | null;
}

/** The line's amount: the stored number while the box is as loaded, else what was typed. */
export function rowQty(row: DraftRow): number | null {
  if (row.storedQty != null && row.storedQty > 0 && row.qtyText === qtyText(row.storedQty)) return row.storedQty;
  return readQty(row.qtyText, row.unit);
}

export function rowName(row: DraftRow): string {
  return row.label.trim() || row.itemName || 'this line';
}

/** The sentence under a line, or null. Money sentences only when `say` is given. */
export function rowNote(
  row: DraftRow,
  say: ((n: number) => string) | null,
): { tone: 'warn' | 'ink'; text: string } | null {
  if (row.role !== 'stocked') return null;
  if (!row.inventoryId) {
    return {
      tone: 'warn',
      text: `This drink won't take stock until '${rowName(row)}' is linked to something on your shelf.`,
    };
  }
  if (!say || !row.saved) return null;
  if (row.saved.costPerServe != null) return { tone: 'ink', text: `${say(row.saved.costPerServe)} a serve` };
  if (row.saved.costBasis === 'size_not_known') {
    return { tone: 'warn', text: "No price yet: your shelf doesn't say how much one of it holds." };
  }
  return { tone: 'warn', text: 'No price yet: it will cost once a delivery of it is checked in.' };
}

function Note({ note }: { note: { tone: 'warn' | 'ink'; text: string } | null }) {
  if (!note) return null;
  return (
    <p className={`cl-rcp-note${note.tone === 'warn' ? ' cl-rcp-note-warn' : ''}`} data-tone={note.tone}>
      {note.text}
    </p>
  );
}

function amountWords(row: DraftRow): string {
  const q = rowQty(row);
  if (q === null) return '';
  return `${qtyText(q)} ${row.unit ? UNIT_LABEL[row.unit] : ''}`.trim();
}

/** A line as a staff member reads it: no inputs, no money. */
export function LineRowRead({ row, say }: { row: DraftRow; say: ((n: number) => string) | null }) {
  return (
    <li className="cl-rcp-line" data-role={row.role} data-testid="recipe-line">
      <div className="cl-rcp-read">
        <span className="cl-num cl-rcp-amt">{amountWords(row)}</span>
        <span>
          {row.itemName ?? row.label}
          {row.itemName && row.label && row.label !== row.itemName ? (
            <span className="cl-dim"> · {row.label}</span>
          ) : null}
          {row.role === 'untracked' ? <span className="cl-dim"> · not counted</span> : null}
        </span>
      </div>
      <Note note={rowNote(row, say)} />
    </li>
  );
}

export default function LineRow({
  row,
  say,
  onChange,
  onRemove,
}: {
  row: DraftRow;
  say: ((n: number) => string) | null;
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [picking, setPicking] = useState(false);
  const stocked = row.role === 'stocked';
  const qty = rowQty(row);

  const pick = (item: ShelfItem) => {
    onChange({
      inventoryId: item.id,
      itemName: item.name,
      itemKind: item.kind,
      label: row.label.trim() ? row.label : item.name,
      saved: null,
    });
    setPicking(false);
  };

  return (
    <li className="cl-rcp-line" data-role={row.role} data-testid="recipe-line">
      <div className="cl-rcp-edit">
        <div className="cl-rcp-what">
          {stocked ? (
            <button
              type="button"
              className="cl-rcp-link cl-focus"
              data-linked={row.inventoryId ? 'true' : 'false'}
              onClick={() => setPicking((p) => !p)}
              aria-expanded={picking}
            >
              <Link2 size={12} aria-hidden />
              {row.inventoryId ? (
                <span>
                  {row.itemName ?? row.label}
                  <span className="cl-dim"> · {kindWords(row.itemKind)}</span>
                </span>
              ) : (
                <span>
                  {row.label.trim() ? `${row.label} · ` : ''}
                  <span style={{ textDecoration: 'underline' }}>link it to your shelf</span>
                </span>
              )}
            </button>
          ) : (
            <>
              <label htmlFor={`${id}-label`} className="cl-sr">What it is</label>
              <input
                id={`${id}-label`}
                className="cl-field cl-focus"
                value={row.label}
                placeholder="Orange twist"
                onChange={(e) => onChange({ label: e.target.value })}
                style={{ width: '100%' }}
              />
            </>
          )}
        </div>

        <label htmlFor={`${id}-qty`} className="cl-sr">Amount</label>
        <input
          id={`${id}-qty`}
          className="cl-field cl-focus cl-num cl-rcp-qty"
          inputMode="decimal"
          value={row.qtyText}
          placeholder="30"
          aria-invalid={qty === null}
          onChange={(e) => onChange({ qtyText: e.target.value, storedQty: null, saved: null })}
        />

        <label htmlFor={`${id}-unit`} className="cl-sr">Unit</label>
        <select
          id={`${id}-unit`}
          className="cl-field cl-focus cl-rcp-unit"
          value={row.unit}
          aria-invalid={row.unit === ''}
          onChange={(e) => onChange({ unit: e.target.value as RecipeUnit | '', saved: null })}
        >
          <option value="">unit</option>
          {RECIPE_UNITS.map((u) => (
            <option key={u} value={u}>{UNIT_LABEL[u]}</option>
          ))}
        </select>

        <button
          type="button"
          role="switch"
          aria-checked={stocked}
          className="cl-btn cl-focus cl-rcp-switch"
          data-on={stocked}
          onClick={() =>
            onChange(
              stocked
                ? { role: 'untracked', inventoryId: null, itemName: null, itemKind: null, saved: null }
                : { role: 'stocked', saved: null },
            )
          }
        >
          {stocked ? 'Counted from the shelf' : 'Not counted'}
        </button>

        <button
          type="button"
          className="cl-btn cl-focus cl-rcp-remove"
          aria-label={`Remove ${rowName(row)}`}
          onClick={onRemove}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
      {picking ? (
        <ShelfPicker initial={row.inventoryId ? '' : row.label} onPick={pick} onClose={() => setPicking(false)} />
      ) : null}
      <Note note={rowNote(row, say)} />
    </li>
  );
}
