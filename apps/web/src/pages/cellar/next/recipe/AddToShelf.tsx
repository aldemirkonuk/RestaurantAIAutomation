/**
 * Add a good to the shelf from a recipe line that found none (r28 recipes
 * audit, gap 8). Before this the picker only said "Nothing on your shelf
 * matches": the owner left for /inventory, added the good, and came back,
 * with the draft surviving only in the session store.
 *
 * The good is written by the inventory's own route (one writer of a house
 * good), named as typed, of the kind and unit the owner picks; the unit
 * starts as the line's own measure, so the line meets the good without a
 * bridge. A good the house already carries under that name is linked, not
 * doubled: the route's 409 names it.
 */
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { recipesApi, type ShelfItem } from '../../../../services/api/recipes';
import type { RecipeUnit } from './units';
import type { RecipeKind } from './recipeWords';
import { reason } from './useRecipe';

/** The kinds the house-item route takes (HOUSE_ITEM_KINDS), as a recipe offers them. */
export const ADD_KINDS: Record<RecipeKind, ReadonlyArray<readonly [string, string]>> = {
  cocktail: [
    ['spirit', 'Spirit'],
    ['liqueur', 'Liqueur'],
    ['whiskey', 'Whiskey'],
    ['beer', 'Beer'],
    ['cider', 'Cider'],
    ['soft_drink', 'Soft drink or mixer'],
    ['non_alcoholic', 'Non-alcoholic'],
    ['food', 'Food (fruit, syrup, garnish)'],
    ['other', 'Other'],
  ],
  dish: [
    ['food', 'Food'],
    ['supply', 'Supply'],
    ['other', 'Other'],
  ],
};

/** The units a good may be kept in that a recipe line can meet without a stated weight. */
export const ADD_UOMS: ReadonlyArray<readonly [string, string]> = [
  ['ml', 'by volume (ml)'],
  ['g', 'by weight (g)'],
  ['each', 'by the piece'],
];

/** The good's unit that meets the line as it is measured: ml for a volume, g for a weight, a piece for a piece. */
export function uomForLine(unit: RecipeUnit | '' | null | undefined): string {
  if (unit === 'g' || unit === 'kg') return 'g';
  if (unit === 'each') return 'each';
  return 'ml';
}

type Conflict = { response?: { status?: number; data?: { existingId?: unknown } } };

export default function AddToShelf({
  name,
  unit,
  kind,
  onAdded,
}: {
  name: string;
  unit: RecipeUnit | '' | null | undefined;
  kind: RecipeKind;
  onAdded: (item: ShelfItem, said: string) => void;
}) {
  const id = useId();
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(name);
  const [goodKind, setGoodKind] = useState(ADD_KINDS[kind][0][0]);
  const [uom, setUom] = useState(uomForLine(unit));
  const [said, setSaid] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => recipesApi.addToShelf(activeRestaurantId as string, { kind: goodKind, uom, displayName: displayName.trim() }),
  });

  if (!open) {
    return (
      <button type="button" className="cl-btn cl-focus" data-testid="shelf-add" onClick={() => setOpen(true)}>
        Add “{name}” to your shelf
      </button>
    );
  }

  const submit = async () => {
    const n = displayName.trim();
    if (n.length < 1 || n.length > 120) {
      setSaid('Give it a name of 1 to 120 characters.');
      return;
    }
    setSaid(null);
    try {
      const out = await add.mutateAsync();
      void qc.invalidateQueries({ queryKey: ['recipes', 'shelf', activeRestaurantId ?? null] });
      onAdded({ id: out.id, name: out.displayName, kind: out.kind, uom: out.uom, bottleSizeMl: null }, `${out.displayName} is on your shelf now, with no stock until a delivery of it is checked in.`);
    } catch (e) {
      const c = e as Conflict;
      const existing = c.response?.status === 409 ? c.response.data?.existingId : null;
      if (typeof existing === 'string' && existing) {
        onAdded({ id: existing, name: n, kind: null, uom: null, bottleSizeMl: null }, `Your shelf already carries ${n}, so this line is linked to it.`);
        return;
      }
      // Before the inventory chain lands the route is not there, and the gateway's
      // own 404 sentence names an internal path: say it in the house's words.
      if (c.response?.status === 404) {
        setSaid(`${n} was not added: this house cannot add a good from a recipe yet. Add it on the Inventory page, then pick it here.`);
        return;
      }
      setSaid(`${n} was not added: ${reason(e)}`);
    }
  };

  return (
    <form
      className="cl-rcp-add"
      data-testid="shelf-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-n`}>Name on your shelf</label>
      <input id={`${id}-n`} className="cl-field cl-focus" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <label htmlFor={`${id}-k`}>What it is</label>
      <select id={`${id}-k`} className="cl-field cl-focus" value={goodKind} onChange={(e) => setGoodKind(e.target.value)}>
        {ADD_KINDS[kind].map(([v, w]) => (
          <option key={v} value={v}>{w}</option>
        ))}
      </select>
      <label htmlFor={`${id}-u`}>Counted</label>
      <select id={`${id}-u`} className="cl-field cl-focus" value={uom} onChange={(e) => setUom(e.target.value)}>
        {ADD_UOMS.map(([v, w]) => (
          <option key={v} value={v}>{w}</option>
        ))}
      </select>
      <span style={{ display: 'flex', gap: 6 }}>
        <button type="submit" className="cl-btn cl-focus" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add and link'}
        </button>
        <button type="button" className="cl-btn cl-focus" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
      {said ? (
        <p className="cl-rcp-note cl-rcp-note-warn" role="alert">
          {said}
        </p>
      ) : null}
    </form>
  );
}
