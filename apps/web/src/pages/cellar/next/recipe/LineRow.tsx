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
import { Link, useInRouterContext } from 'react-router-dom';
import { Link2, Trash2 } from 'lucide-react';
import type { RecipeLineRole, RecipeLineStatus, ShelfItem, StatedWeights, WeighedBy, WeightNeeded } from '../../../../services/api/recipes';
import { amountWithUnit, qtyText, readQty, unitChoices, unitWord, type RecipeUnit } from './units';
import ShelfPicker, { kindWords } from './ShelfPicker';
import { recipeWords, type RecipeKind, type RecipeWords } from './recipeWords';
import WeighBox, { plainGrams, type SayGrams } from './WeighBox';

export interface DraftRow {
  key: string;
  role: RecipeLineRole;
  inventoryId: string | null;
  itemName: string | null;
  itemKind: string | null;
  /** How the shelf counts the linked item; used to say why a line has no price. */
  itemUom?: string | null;
  /** The linked item was archived or deleted since the line was saved. */
  itemGone?: 'archived' | 'deleted' | null;
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
  saved: {
    status: RecipeLineStatus;
    costPerServe: number | null;
    /** The same cost at six places, so a line under half a cent is not said as free. */
    costPerServeExact?: number | null;
    costBasis: string | null;
    /** The weight the house can state so this line is priced (r28 gap 7). */
    needs?: WeightNeeded | null;
    /** The stated weight this line's price went through, if any. */
    weighed?: WeighedBy | null;
  } | null;
}

/** The weight a saved line waits for, when its good can take one and the person can act on it. */
export function weightNeeded(row: DraftRow): WeightNeeded | null {
  if (row.role !== 'stocked' || !row.inventoryId || row.itemGone || !row.saved) return null;
  if (row.saved.costBasis !== 'unit_mismatch' || row.saved.costPerServe != null) return null;
  return row.saved.needs ?? null;
}

/**
 * The stated weight a saved, priced line went through, when the person can
 * change it: a line edited since the read has no `saved`, so a weight is never
 * shown beside a price it no longer makes.
 */
export function weighedBy(row: DraftRow): WeighedBy | null {
  if (row.role !== 'stocked' || !row.inventoryId || row.itemGone || !row.saved) return null;
  if (row.saved.costPerServe == null) return null;
  const w = row.saved.weighed;
  return w && Number.isFinite(w.grams) && w.grams > 0 ? w : null;
}

/** "Priced from one piece of Eggs at 60 g." / "Priced from one ml of Flour at 0,53 g." */
export function weighedWords(w: WeighedBy, item: string, sayGrams: SayGrams = plainGrams): string {
  return `Priced from one ${w.by === 'piece_grams' ? 'piece' : 'ml'} of ${item} at ${sayGrams(w.grams)} g.`;
}

/** The line's amount: the stored number while the box is as loaded, else what was typed. */
export function rowQty(row: DraftRow): number | null {
  if (row.storedQty != null && row.storedQty > 0 && row.qtyText === qtyText(row.storedQty)) return row.storedQty;
  return readQty(row.qtyText, row.unit);
}

export function rowName(row: DraftRow): string {
  return row.label.trim() || row.itemName || 'this line';
}

/** "bottle" -> "by the bottle", "kg" -> "in kg". */
function countedHow(uom: string | null | undefined): string {
  const u = String(uom ?? '').toLowerCase();
  if (['bottle', 'keg', 'case', 'pack', 'glass', 'shot'].includes(u)) return `by the ${u}`;
  if (u === 'each') return 'by the piece';
  return u ? `in ${u}` : 'another way';
}

/** "ml" -> "measured by volume". */
function measuredHow(unit: DraftRow['unit']): string {
  if (unit === 'g' || unit === 'kg') return 'weighed';
  if (unit === 'each') return 'counted by the piece';
  return 'measured by volume';
}

/**
 * A line's cost in words. Each line is rounded to the cent on its own, so a
 * good that costs 0.004 a serve rounds to 0.00; it is said as under a cent,
 * never as free and never as a cent it does not cost.
 */
function costWords(saved: NonNullable<DraftRow['saved']>, say: (n: number) => string): string {
  const cents = saved.costPerServe as number;
  const exact = saved.costPerServeExact;
  return cents === 0 && exact != null && exact > 0 ? `Under ${say(0.01)}` : say(cents);
}

/**
 * The sentence under a line an editor is working on, or null. Money sentences
 * only when `say` is given. Staff never get one: nothing in it is theirs to
 * act on (round 17, D7).
 */
export function rowNote(
  row: DraftRow,
  say: ((n: number) => string) | null,
  words: RecipeWords = recipeWords('cocktail'),
): { tone: 'warn' | 'ink'; text: string } | null {
  if (row.role !== 'stocked') return null;
  if (!row.inventoryId) {
    return {
      tone: 'warn',
      text: `This ${words.thing} won't take stock until '${rowName(row)}' is linked to something on your shelf.`,
    };
  }
  if (row.itemGone) {
    return {
      tone: 'warn',
      text: `'${row.itemName ?? rowName(row)}' was ${row.itemGone === 'deleted' ? 'deleted' : 'archived'} from your shelf. Link this line to something still on it, or mark it not counted, before saving.`,
    };
  }
  if (!say || !row.saved) return null;
  const basis = row.saved.costBasis;
  if (row.saved.costPerServe != null) {
    const cost = costWords(row.saved, say);
    return basis === 'invoice_lot_wac_partial'
      ? { tone: 'ink', text: `${cost} a ${words.unit}, from the ${words.stockWord} that have an invoice; some on hand have none yet.` }
      : { tone: 'ink', text: `${cost} a ${words.unit}` };
  }
  const item = row.itemName ?? rowName(row);
  if (basis === 'size_not_known') {
    return { tone: 'warn', text: `No price yet: your shelf doesn't say how much one ${row.itemUom ?? words.container} of ${item} holds.` };
  }
  if (basis === 'pack_size_not_known') {
    // The gateway names this for a volume line and for a weighed one. A
    // weighed line has no bottle to pour from: its way to a price is a good
    // the shelf counts by weight.
    const fix =
      row.unit === 'g' || row.unit === 'kg'
        ? 'Link the line to something your shelf counts by weight, in g or kg.'
        : `Link the line to ${words.pourFrom}.`;
    return {
      tone: 'warn',
      text: `No price: ${item} is counted ${countedHow(row.itemUom)}, and your shelf doesn't say what one holds. ${fix}`,
    };
  }
  const needs = weightNeeded(row);
  if (needs) {
    return {
      tone: 'warn',
      text: `No price yet: this line is ${measuredHow(row.unit)}, but ${item} is counted ${countedHow(row.itemUom)}. Say what ${needs === 'piece_grams' ? 'one weighs' : 'one ml of it weighs'}, and every ${words.thing} with ${item} is priced from that.`,
    };
  }
  if (basis === 'unit_mismatch') {
    return {
      tone: 'warn',
      text: `No price: this line is ${measuredHow(row.unit)}, but ${item} is counted ${countedHow(row.itemUom)}. Change the unit, or link the item it ${words.comesFrom} from.`,
    };
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
  return amountWithUnit(q, row.unit);
}

/** Where a shelf item opens: its drawer on /inventory, with its cards and what is in it. */
export const goodHref = (inventoryId: string) => `/inventory?open=${encodeURIComponent(inventoryId)}`;

/**
 * A linked line leads to its good (founder /goal 2026-11-07: a drink, or a
 * dish, and its recipe lead to the goods in it, each with its cards and its
 * nutrition card). A router link, so an unsaved draft is kept (drafts.ts); a
 * plain link outside a router (a bare mount). A good that was archived or
 * deleted has no drawer to open, so it has no link.
 */
export function GoodLink({ row }: { row: DraftRow }) {
  const routed = useInRouterContext();
  if (row.role !== 'stocked' || !row.inventoryId || row.itemGone) return null;
  const to = goodHref(row.inventoryId);
  const label = `Open ${row.itemName ?? row.label} in inventory`;
  const props = { className: 'cl-rcp-good cl-focus', 'aria-label': label, 'data-testid': 'recipe-line-good' };
  return routed ? (
    <Link to={to} {...props}>
      Open in inventory
    </Link>
  ) : (
    <a href={to} {...props}>
      Open in inventory
    </a>
  );
}

/** A line as a staff member reads it: no inputs, no money, and no warning that is not theirs to act on. */
export function LineRowRead({ row }: { row: DraftRow }) {
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
        <GoodLink row={row} />
      </div>
    </li>
  );
}

/**
 * The weight a priced line went through, said under its price, with a way to
 * change it (r28 gap 7): a mistyped weight (600 g for one egg) otherwise shows
 * only as a price that looks wrong. The weight belongs to the good, so the
 * box says that every recipe with it is priced again.
 */
function WeighedNote({
  row,
  w,
  sayGrams,
  open,
  setOpen,
  onWeighed,
  thing,
}: {
  row: DraftRow;
  w: WeighedBy;
  sayGrams: SayGrams;
  open: boolean;
  setOpen: (open: boolean) => void;
  onWeighed?: (itemId: string, weights: StatedWeights) => void | Promise<void>;
  thing: string;
}) {
  const item = row.itemName ?? rowName(row);
  return (
    <>
      <p className="cl-rcp-note" data-testid="recipe-line-weighed">
        {weighedWords(w, item, sayGrams)}{' '}
        {open ? null : (
          <button
            type="button"
            className="cl-btn cl-focus"
            aria-label={`Change what one ${w.by === 'piece_grams' ? 'piece' : 'ml'} of ${item} weighs`}
            onClick={() => setOpen(true)}
          >
            Change
          </button>
        )}
      </p>
      {open ? (
        <>
          <p className="cl-rcp-note">{`A new weight prices every ${thing} with ${item} again.`}</p>
          <WeighBox
            itemId={row.inventoryId as string}
            item={item}
            needs={w.by}
            now={sayGrams(w.grams)}
            onCancel={() => setOpen(false)}
            onWeighed={async (itemId, weights) => {
              await onWeighed?.(itemId, weights);
              setOpen(false);
            }}
          />
        </>
      ) : null}
    </>
  );
}

export default function LineRow({
  row,
  say,
  onChange,
  onRemove,
  kind,
  onWeighed,
  sayGrams = plainGrams,
}: {
  row: DraftRow;
  say: ((n: number) => string) | null;
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
  /** What the recipe is for; a dish's notes and examples say plate, not serve. */
  kind?: RecipeKind;
  /** Told when a weight this line waited for, or one it was priced through, is kept. */
  onWeighed?: (itemId: string, weights: StatedWeights) => void | Promise<void>;
  /** Writes a stated weight in the house's form. */
  sayGrams?: SayGrams;
}) {
  const words = recipeWords(kind);
  const id = useId();
  const [picking, setPicking] = useState(false);
  const [reweighing, setReweighing] = useState(false);
  const stocked = row.role === 'stocked';
  const qty = rowQty(row);

  const [added, setAdded] = useState<string | null>(null);
  const pick = (item: ShelfItem, said?: string) => {
    setAdded(said ?? null);
    onChange({
      inventoryId: item.id,
      itemName: item.name,
      itemKind: item.kind,
      itemUom: item.uom,
      itemGone: null,
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
          ) : null}
          {stocked ? <GoodLink row={row} /> : (
            <>
              <label htmlFor={`${id}-label`} className="cl-sr">What it is</label>
              <input
                id={`${id}-label`}
                className="cl-field cl-focus"
                value={row.label}
                placeholder={words.notCountedPlaceholder}
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
          {unitChoices(words.units, row.unit).map((u) => (
            <option key={u} value={u}>{unitWord(u, rowQty(row))}</option>
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
                ? { role: 'untracked', inventoryId: null, itemName: null, itemKind: null, itemUom: null, itemGone: null, saved: null }
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
        <ShelfPicker
          initial={row.inventoryId ? '' : row.label}
          onPick={pick}
          onClose={() => setPicking(false)}
          addFor={{ unit: row.unit, kind: kind ?? 'cocktail' }}
        />
      ) : null}
      {added ? (
        <p className="cl-rcp-note" role="status" data-testid="shelf-added">
          {added}
        </p>
      ) : null}
      <Note note={rowNote(row, say, words)} />
      {say && weightNeeded(row) && row.inventoryId ? (
        <WeighBox
          itemId={row.inventoryId}
          item={row.itemName ?? rowName(row)}
          needs={weightNeeded(row) as WeightNeeded}
          onWeighed={onWeighed}
        />
      ) : null}
      {say && weighedBy(row) && row.inventoryId ? (
        <WeighedNote
          row={row}
          w={weighedBy(row) as WeighedBy}
          sayGrams={sayGrams}
          open={reweighing}
          setOpen={setReweighing}
          onWeighed={onWeighed}
          thing={words.thing}
        />
      ) : null}
    </li>
  );
}
