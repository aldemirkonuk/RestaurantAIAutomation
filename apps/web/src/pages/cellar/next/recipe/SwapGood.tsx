/**
 * Swap a good in every drink (r108 drinks-g10). On /cocktails an owner or
 * manager picks the good a set of recipes pours from, then the one to pour
 * instead; each drink that uses it shows what a serve would cost before and
 * after, from the gateway's own cost preview (four requests at a time), and
 * Confirm saves each drink through its own PUT with `expectedVersionId`
 * (linkLines.ts), so each one keeps its earlier version.
 *
 * Each line keeps its quantity, unit and usable share: only `inventoryId`
 * changes. A line measured another way than the new good is counted (ml by
 * volume, g by weight, a piece) is never sent: converting across those would
 * invent a density, so that drink is listed as not swapped. An incomplete
 * cost says how many lines are priced, never a partial sum or 0 (ADR 0051).
 * Dishes that use the good are counted and left alone.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { useAuth } from '../../../../contexts/AuthContext';
import { recipesApi, type CostPreview, type LooseDrink, type PreviewCostBody, type SaveRecipeBody, type ShelfItem } from '../../../../services/api/recipes';
import { useHouseMoney, drinkFiguresKey, recipeKey } from './useRecipe';
import ShelfPicker from './ShelfPicker';
import { count, linkBody, looseLinesKey, saveEach, type LinkOutcome } from './linkLines';

type Family = 'ml10' | 'mg' | 'each_milli';

/** How a good is counted, by its unit, in the base units a recipe line is stored in (recipe-cost.ts). */
export function familyOf(uom: string | null | undefined): Family {
  if (uom === 'ml' || uom === 'l' || uom === 'bottle' || uom === 'keg') return 'ml10';
  if (uom === 'mg' || uom === 'g' || uom === 'kg') return 'mg';
  return 'each_milli';
}
const COUNTED: Record<Family, string> = { ml10: 'by volume', mg: 'by weight', each_milli: 'in pieces' };

/** The draft a cost preview takes, or null when a line cannot be previewed (a made line: the preview route takes none). */
export function previewBody(b: SaveRecipeBody): PreviewCostBody | null {
  if (b.lines.some((l) => l.role === 'made')) return null;
  return {
    yieldServes: b.yieldServes,
    lines: b.lines.map((l) => ({ role: l.role, inventoryId: l.inventoryId, qtyEntered: l.qty, unitCode: l.unit, usablePct: l.usablePct ?? null })),
  };
}

/** A previewed cost a serve: the figure when every line is priced, else how many are; never a partial sum. */
export function costWords(c: CostPreview | null | undefined, say: (n: number) => string): string {
  if (!c) return 'not known';
  if (c.complete && c.perServe != null) return say(c.perServe);
  return `${c.priced} of ${c.of} priced`;
}

/** Runs thunks with at most `width` in flight. */
export async function inFours<T>(jobs: Array<() => Promise<T>>, width = 4): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, lane));
  return out;
}

interface Plan {
  drink: LooseDrink;
  body: SaveRecipeBody;
  refused: string | null;
}

function SwapSheet({ onClose }: { onClose: () => void }) {
  const { activeRestaurantId } = useAuth();
  const rid = activeRestaurantId as string;
  const say = useHouseMoney();
  const qc = useQueryClient();
  const [from, setFrom] = useState<ShelfItem | null>(null);
  const [to, setTo] = useState<ShelfItem | null>(null);
  const [same, setSame] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<LinkOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const uses = useQuery({
    queryKey: [...looseLinesKey(activeRestaurantId), 'linked', from?.id ?? null],
    queryFn: () => recipesApi.looseLines(rid, from!.id),
    enabled: Boolean(from && activeRestaurantId),
    retry: false,
  });

  const plans: Plan[] = useMemo(() => {
    if (!uses.data || !to) return [];
    const want = familyOf(to.uom);
    const at = new Map<string, Array<{ index: number; baseUnit?: string }>>();
    for (const g of uses.data.groups) for (const l of g.lines) at.set(l.cocktailId, [...(at.get(l.cocktailId) ?? []), l]);
    return uses.data.drinks.flatMap((drink) => {
      const lines = at.get(drink.cocktailId);
      if (!lines) return [];
      const off = lines.some((l) => l.baseUnit !== want);
      return [{ drink, body: linkBody(drink, lines.map((l) => l.index), to.id), refused: off ? `not swapped: counted ${COUNTED[want]}` : null }];
    });
  }, [uses.data, to]);

  // Each drink to be swapped: its cost a serve now and after, from the same preview route, four requests at a time.
  useEffect(() => {
    setPreviews({});
    const go = plans.filter((p) => !p.refused);
    if (!go.length) return;
    let live = true;
    const jobs = go.flatMap((p) => {
      const ask = (b: PreviewCostBody | null) => () =>
        b ? recipesApi.previewCost(rid, p.drink.cocktailId, b).catch(() => null) : Promise.resolve(null);
      return [ask(previewBody({ ...p.body, lines: p.drink.lines })), ask(previewBody(p.body))];
    });
    void inFours(jobs).then((r) => {
      if (!live) return;
      const out: Record<string, string> = {};
      go.forEach((p, i) => {
        const [a, b] = [r[2 * i], r[2 * i + 1]];
        out[p.drink.cocktailId] = a && b ? `cost a serve ${costWords(a, say)} -> ${costWords(b, say)}` : 'its cost could not be previewed';
      });
      setPreviews(out);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, rid]);

  const go = plans.filter((p) => !p.refused);
  const confirm = async () => {
    if (!from || !to) return;
    setBusy(true);
    const out = await saveEach(
      rid,
      go.map(({ drink, body }) => ({ drink, body })),
      `${from.name} swapped for ${to.name}`,
      'swap this good',
    );
    setOutcomes(out);
    setBusy(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: looseLinesKey(activeRestaurantId) }),
      qc.invalidateQueries({ queryKey: drinkFiguresKey(activeRestaurantId) }),
      ...out.filter((o) => o.ok).map((o) => qc.invalidateQueries({ queryKey: recipeKey(activeRestaurantId, o.cocktailId) })),
    ]);
  };

  const dishes = uses.data?.dishCount ?? 0;
  return (
    <Sheet
      open
      onClose={onClose}
      label="Swap one shelf good for another in every drink that uses it. Confirm saves a new version of each drink; closing saves nothing."
      eyebrow="Recipes"
      title="Swap a good"
      closeLabel="Close"
    >
      <p className="cl-note">Each drink keeps its earlier version.</p>
      {!from ? (
        <>
          <p className="cl-said">The good your drinks pour from now</p>
          <ShelfPicker initial="" onPick={(i) => setFrom(i)} onClose={onClose} />
        </>
      ) : (
        <p className="cl-said" data-testid="swap-from">
          Swap out {from.name}{' '}
          <button type="button" className="cl-btn cl-focus" onClick={() => (setFrom(null), setTo(null), setOutcomes([]))} disabled={busy}>
            Choose another
          </button>
        </p>
      )}
      {from && uses.isError ? <p className="cl-note" role="alert">Which drinks use {from.name} could not be read just now.</p> : null}
      {from && uses.data ? (
        <>
          <p className="cl-said" data-testid="swap-uses">
            {uses.data.lineCount
              ? `${count(uses.data.lineCount, 'line', 'lines')} in ${count(uses.data.drinkCount, 'drink', 'drinks')} pour from it.`
              : `No drink's current recipe uses ${from.name}.`}
          </p>
          {dishes > 0 ? (
            <p className="cl-note" data-testid="swap-dishes">
              {count(dishes, 'dish uses', 'dishes use')} it too; {dishes === 1 ? 'it is' : 'they are'} not changed here.
            </p>
          ) : null}
        </>
      ) : null}
      {from && uses.data?.lineCount && !to ? (
        <>
          <p className="cl-said">The good to pour instead</p>
          {same ? <p className="cl-note" role="status">That is the good being swapped out; choose another.</p> : null}
          <ShelfPicker
            initial=""
            onPick={(i) => {
              setSame(i.id === from.id);
              if (i.id !== from.id) setTo(i);
            }}
            onClose={onClose}
          />
        </>
      ) : null}
      {to ? (
        <>
          <p className="cl-said" data-testid="swap-to">
            Pour {to.name} instead{' '}
            <button type="button" className="cl-btn cl-focus" onClick={() => (setTo(null), setOutcomes([]))} disabled={busy}>
              Choose another
            </button>
          </p>
          <ul data-testid="swap-plan" style={{ listStyle: 'none', padding: 0 }}>
            {plans.map((p) => (
              <li key={p.drink.cocktailId} data-refused={p.refused ? 'true' : 'false'}>
                {p.drink.name}: {p.refused ?? previews[p.drink.cocktailId] ?? 'reading its cost…'}
              </li>
            ))}
          </ul>
          <button type="button" className="cl-btn cl-focus" data-testid="swap-confirm" disabled={!go.length || busy} onClick={() => void confirm()}>
            Swap in {count(go.length, 'drink', 'drinks')}
          </button>
        </>
      ) : null}
      {outcomes.length ? (
        <ul role="status" data-testid="swap-outcomes" style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {outcomes.map((o) => (
            <li key={o.cocktailId} data-ok={o.ok ? 'true' : 'false'}>
              {o.said}
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}

/** "Swap a good" on /cocktails, for owners and managers only. */
export default function SwapGood({ manages }: { manages: boolean }) {
  const [open, setOpen] = useState(false);
  if (!manages) return null;
  return (
    <>
      <button type="button" className="cl-btn cl-focus" data-testid="swap-open" onClick={() => setOpen(true)} style={{ marginTop: 8 }}>
        Swap a good
      </button>
      {open ? <SwapSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
