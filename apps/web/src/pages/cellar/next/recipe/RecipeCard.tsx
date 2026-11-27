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
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { CocktailRecipe } from '../../../../services/api/recipes';
import { marginPerServe, pourCostShare } from './DrinkCards';
import { ALLERGEN_KEYS } from './ListAllergens';
import type { ListTax } from './listTax';
import type { SayPercent } from './useHousePercent';
import { useAuth } from '../../../../contexts/AuthContext';
import { useHouseDate } from './useHouseDate';
import type { RecipeWords } from './recipeWords';
import { MAKE_SAID, readMake, scaledAmount, scaledCost } from './recipeScale';

const FLAG = 'data-print-card';

/**
 * Whether this person ticked "Include cost" last time, kept in this browser per person and per house: a
 * convenience, never state. A browser that will not store it opens the box unticked. Staff never see the box,
 * and a stored tick is never read as leave to print money (showCost needs canSeeCost).
 */
const boxKey = (userId: string | null | undefined, houseId: string | null | undefined) => `mudavym.recipeCard.includeCost.v1:${userId ?? '-'}:${houseId ?? '-'}`;
function boxWas(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function keepBox(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    /* not stored: the box opens unticked next time */
  }
}

/** The Make count last used on THIS card, kept in this browser: a convenience, never state. */
const makeKey = (userId: string | null | undefined, houseId: string | null | undefined, cardId: string) =>
  `mudavym.recipeCard.make.v1:${userId ?? '-'}:${houseId ?? '-'}:${cardId}`;
function makeWas(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '1';
  } catch {
    return '1';
  }
}
function keepMake(key: string, text: string): void {
  try {
    if (readMake(text) != null && text.trim() !== '1') window.localStorage.setItem(key, text.trim());
    else window.localStorage.removeItem(key);
  } catch {
    /* not stored: the count opens at 1 next time */
  }
}

/** What the card says of allergens, from what the gateway stated for the saved version. */
/**
 * The card's (and the spec book's) allergen sentence. A failed read says so and is never free or blank;
 * "free of the 14" only when every one of the 14 is stated free (as the list's rule, ListAllergens), so a
 * recipe whose lines state nothing never prints as allergen-free (r109 drinks-2, DD-r107-40).
 */
export function cardAllergens(w: CocktailRecipe['whatIsIn']): string {
  if (!w || !w.readable) return 'Allergens could not be read.';
  const stated = Object.entries(w.allergens).filter(([, s]) => s === 'contains' || s === 'may_contain');
  const unstated = w.allergensUnstatedBy ?? [];
  const parts = stated.map(([a, s]) => `${s === 'contains' ? 'Contains' : 'May contain'} ${a.replace('_', ' ')}`);
  if (unstated.length > 0) parts.push(`Not ruled out: ${[...new Set(unstated)].join(', ')} ${unstated.length === 1 ? 'does' : 'do'} not say`);
  else if (w.allergensUnstatedBy && stated.length === 0 && ALLERGEN_KEYS.every((k) => w.allergens[k] === 'free'))
    parts.push('Every ingredient states it is free of the 14 allergens');
  return parts.length ? `${parts.join('. ')}.` : 'Allergens not known: nothing is recorded.';
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
  const sayDate = useHouseDate();
  const { user, activeRestaurantId } = useAuth();
  const storeKey = boxKey(user?.userId, activeRestaurantId);
  const [withCost, setWithCost] = useState(() => boxWas(storeKey));
  const v = data.current;
  const isDish = data.kind === 'dish';
  const showCost = canSeeCost && withCost;
  const makeStore = makeKey(user?.userId, activeRestaurantId, data.cocktail.id);
  const [makeText, setMakeText] = useState(() => makeWas(makeStore));
  const makeRead = readMake(makeText);
  // A count that cannot be read is said, and the card is drawn for 1, never for a guess.
  const n = makeRead ?? 1;

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
  const exact = data.cost?.complete ? (data.cost.perServeExact ?? data.cost.perServe) : null;
  const dated = sayDate(v.createdAt);
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
        <label htmlFor={`${boxId}-make`} className="cl-note" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Make
          <input
            id={`${boxId}-make`}
            className="cl-field cl-focus cl-num"
            inputMode="numeric"
            style={{ width: 56 }}
            value={makeText}
            aria-invalid={makeRead == null}
            onChange={(e) => {
              setMakeText(e.target.value);
              keepMake(makeStore, e.target.value);
            }}
          />
        </label>
        {makeRead == null ? <span className="cl-note" role="alert" data-testid="recipe-make-said">{MAKE_SAID}</span> : null}
        {canSeeCost ? (
          <label htmlFor={boxId} className="cl-note cl-rcp-tick" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input id={boxId} type="checkbox" checked={withCost} onChange={(e) => {
                setWithCost(e.target.checked);
                keepBox(storeKey, e.target.checked);
              }} />
            Include cost
          </label>
        ) : null}
      </div>

      <div className="cl-make-room" data-testid="recipe-make-room">
        {n > 1 ? (
          <p className="cl-note" data-testid="recipe-make-preview">
            {`Make ${n} ${words.unit}s: ${v.lines.map((l) => `${scaledAmount(l.qtyEntered, n, l.unitCode, v.yieldServes)} ${l.itemName ?? l.label}`).join(', ')}`}
          </p>
        ) : null}
      </div>

      {/* Out of the app's own tree, so paper can hide everything else and leave one page (r104 walk: visibility alone left blank sheets). */}
      {createPortal(
        <section className="cl-print-card" data-testid="recipe-card" aria-hidden="true">
          <h1>{data.cocktail.name}</h1>
          <p>
            Makes {v.yieldServes} {v.yieldServes === 1 ? words.unit : `${words.unit}s`}
            {!isDish && glass ? ` · ${glass}` : ''}
            {` · version ${v.version}${dated ? `, ${dated}` : ''}`}
          </p>
          {n > 1 ? <p data-testid="recipe-card-make"><b>{`Make ${n} ${words.unit}s`}</b></p> : null}
          <ol>
            {v.lines.map((l) => (
              <li key={l.id}>
                <b>{scaledAmount(l.qtyEntered, n, l.unitCode, v.yieldServes)}</b> {l.itemName ?? l.label}
              </li>
            ))}
          </ol>
          {method ? <p className="cl-print-method">{method}</p> : null}
          {garnish ? <p>Garnish: {garnish}</p> : null}
          <p>{cardAllergens(data.whatIsIn)}</p>
          {showCost ? (
            <p data-testid="recipe-card-cost">
              {n > 1 ? `Cost to make ${n} ${data.cost?.complete && exact != null ? sayMoney(scaledCost(exact, n)) : 'not known'} · ` : ''}
              {`Cost per serve ${per == null ? 'not known' : sayMoney(per)} · Price ${price == null ? 'not set' : sayMoney(price)}`}
              {` · Pour cost ${'pct' in share ? sayPct(share.pct) : 'not known'}`}
              {` · Margin ${'margin' in margin ? sayMoney(margin.margin) : 'not known'}`}
            </p>
          ) : null}
        </section>,
        document.body,
      )}
    </>
  );
}
