/**
 * The recipe card a bar prints and pins up (r104 drinks need 4): one page with
 * the name, serves, glass, build, method, garnish and allergens, and the
 * version's date. It is drawn from the SAVED version only, never from an
 * unsaved draft, so a card on the wall is a recipe someone saved.
 *
 * Money is opt-in and role-gated: a role that cannot edit a recipe never gets a
 * cost, price, pour cost or margin on it, and an owner or manager gets them only
 * when the "Include cost" box is ticked. The card is hidden on screen and drawn
 * by the print stylesheet (cellar-next.css) while `html[data-print-card]` is
 * set, so nothing else on the page prints and printing another page is
 * untouched. No overlay, no animation.
 */
import { useEffect, useId, useState } from 'react';
import { Printer } from 'lucide-react';
import type { CocktailRecipe } from '../../../../services/api/recipes';
import { marginPerServe, pourCostShare } from './DrinkCards';
import type { ListTax } from './listTax';
import type { SayPercent } from './useHousePercent';
import { amountWithUnit } from './units';
import type { RecipeWords } from './recipeWords';

const FLAG = 'data-print-card';

/** What the card says of allergens, from what the gateway stated for the saved version. */
export function cardAllergens(w: CocktailRecipe['whatIsIn']): string {
  if (!w || !w.readable) return 'Allergens could not be read.';
  const stated = Object.entries(w.allergens).filter(([, s]) => s === 'contains' || s === 'may_contain');
  const unstated = w.allergensUnstatedBy ?? [];
  const parts = stated.map(([a, s]) => `${s === 'contains' ? 'Contains' : 'May contain'} ${a.replace('_', ' ')}`);
  if (unstated.length > 0) parts.push(`Not ruled out: ${[...new Set(unstated)].join(', ')} ${unstated.length === 1 ? 'does' : 'do'} not say`);
  else if (w.allergensUnstatedBy && stated.length === 0) parts.push('Every ingredient states it is free of the 14 allergens');
  return parts.length ? `${parts.join('. ')}.` : 'Allergens: none recorded.';
}

export default function RecipeCard({
  data,
  words,
  canSeeCost,
  sayMoney,
  sayPct,
  tax,
}: {
  data: CocktailRecipe;
  words: RecipeWords;
  /** Owner or manager, with the figures read. Staff pass false and the box never appears. */
  canSeeCost: boolean;
  sayMoney: (n: number) => string;
  sayPct: SayPercent;
  tax: ListTax;
}) {
  const boxId = useId();
  const [withCost, setWithCost] = useState(false);
  const v = data.current;
  const isDish = data.kind === 'dish';
  const showCost = canSeeCost && withCost;

  // The flag is only ever on while this card is the thing being printed.
  useEffect(() => () => document.documentElement.removeAttribute(FLAG), []);

  if (!v) return null;
  const print = () => {
    const root = document.documentElement;
    root.setAttribute(FLAG, '');
    window.addEventListener('afterprint', () => root.removeAttribute(FLAG), { once: true });
    window.print();
  };

  const price = data.cocktail.price;
  const share = pourCostShare(data.cost, price, tax);
  const margin = marginPerServe(data.cost, price, tax);
  const per = data.cost?.complete ? data.cost.perServe : null;
  const made = new Date(v.createdAt);
  const dated = Number.isFinite(made.getTime()) ? made.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const glass = v.glass ?? data.cocktail.glass;
  const garnish = v.garnish ?? data.cocktail.garnish;
  const method = v.method ?? data.cocktail.method;

  return (
    <>
      <div className="cl-rcp-print" data-testid="recipe-print">
        <button type="button" className="cl-btn cl-focus" onClick={print} data-testid="recipe-print-button">
          <Printer size={13} aria-hidden />
          Print recipe card
        </button>
        {canSeeCost ? (
          <label htmlFor={boxId} className="cl-note" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input id={boxId} type="checkbox" checked={withCost} onChange={(e) => setWithCost(e.target.checked)} />
            Include cost
          </label>
        ) : null}
      </div>

      <section className="cl-print-card" data-testid="recipe-card" aria-hidden="true">
        <h1>{data.cocktail.name}</h1>
        <p>
          Makes {v.yieldServes} {v.yieldServes === 1 ? words.unit : `${words.unit}s`}
          {!isDish && glass ? ` · ${glass}` : ''}
          {` · version ${v.version}${dated ? `, ${dated}` : ''}`}
        </p>
        <ol>
          {v.lines.map((l) => (
            <li key={l.id}>
              <b>{amountWithUnit(l.qtyEntered, l.unitCode as never)}</b> {l.itemName ?? l.label}
            </li>
          ))}
        </ol>
        {method ? <p className="cl-print-method">{method}</p> : null}
        {garnish ? <p>Garnish: {garnish}</p> : null}
        <p>{cardAllergens(data.whatIsIn)}</p>
        {showCost ? (
          <p data-testid="recipe-card-cost">
            {`Cost per serve ${per == null ? 'not known' : sayMoney(per)} · Price ${price == null ? 'not set' : sayMoney(price)}`}
            {` · Pour cost ${'pct' in share ? sayPct(share.pct) : 'not known'}`}
            {` · Margin ${'margin' in margin ? sayMoney(margin.margin) : 'not known'}`}
          </p>
        ) : null}
      </section>
    </>
  );
}
