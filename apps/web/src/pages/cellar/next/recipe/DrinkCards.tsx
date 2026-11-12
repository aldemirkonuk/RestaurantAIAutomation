/**
 * A drink's own cards, the first thing an opened drink shows (inventory
 * proposal S2.4: "a drink opens its own drawer with the same cards, rolled up
 * from its lines"). Each card is one figure and one sentence that says where
 * it comes from. Nothing is summed here: the cost and what is in a serve are
 * the gateway's (recipe-cost.ts, recipe-nutrition.ts), of the SAVED recipe.
 *
 * Unknown is a word, never 0: a cost with one unpriced line is "Not known"
 * and names that line, because a partial sum shown as the cost would read as
 * the drink costing less than it does (ADR 0051).
 *
 * No pour-cost card: the price on the list includes tax and the house's tax
 * basis is not set anywhere yet (ADR 0360 item 8, ADR 0359 open as #784), so
 * a percentage of it would be wrong in a way nobody could see.
 */
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';
import { alcoholGrams, figureAmount, figureUnknown, names } from './WhatIsInAServe';

interface Card {
  id: string;
  label: string;
  figure: string;
  said: string;
  /** False when the figure is not known: the card reads as a gap, not a number. */
  known: boolean;
  warn?: boolean;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

const unpricedNames = (lines: RecipeLine[]) =>
  names(lines.filter((l) => l.role === 'stocked' && l.costPerServe == null).map((l) => l.itemName ?? l.label));

function costCard(data: CocktailRecipe, sayMoney: (n: number) => string): Card | null {
  const cost = data.cost;
  if (!cost || !data.current) return null;
  const base = { id: 'cost', label: 'Cost a serve' };
  if (cost.complete && cost.perServe != null) {
    const exact = cost.perServeExact ?? null;
    const figure = cost.perServe === 0 && exact != null && exact > 0 ? `Under ${sayMoney(0.01)}` : sayMoney(cost.perServe);
    const part = cost.partial ?? 0;
    return {
      ...base,
      figure,
      known: true,
      said:
        part > 0
          ? `At today's prices; ${count(part, 'ingredient is', 'ingredients are')} priced from the bottles with an invoice only.`
          : `At today's prices, ${cost.of === 1 ? 'its one ingredient' : `all ${cost.of} ingredients`} priced.`,
    };
  }
  if (cost.of === 0) {
    return { ...base, figure: 'Not known', known: false, said: 'Nothing in it is counted from your shelf, so nothing here has a price.' };
  }
  const missing = unpricedNames(data.current.lines);
  return {
    ...base,
    figure: 'Not known',
    known: false,
    warn: true,
    said: `${cost.priced} of ${count(cost.of, 'ingredient', 'ingredients')} priced${missing ? `; no price yet for ${missing}` : ''}.`,
  };
}

function priceCard(data: CocktailRecipe, sayMoney: (n: number) => string): Card {
  const price = data.cocktail.price;
  return price != null
    ? { id: 'price', label: 'Price', figure: sayMoney(price), known: true, said: 'A serve, as your list has it.' }
    : { id: 'price', label: 'Price', figure: 'No price', known: false, said: 'Your list has no price for it.' };
}

function ingredientsCard(data: CocktailRecipe): Card | null {
  const lines = data.current?.lines;
  if (!lines) return null;
  const stocked = lines.filter((l) => l.role === 'stocked');
  const unlinked = stocked.filter((l) => !l.inventoryId).length;
  const notCounted = lines.length - stocked.length;
  const parts = [`${stocked.length - unlinked} from your shelf`];
  if (unlinked > 0) parts.push(`${unlinked} not linked to it yet`);
  if (notCounted > 0) parts.push(`${notCounted} not counted`);
  const serves = data.current?.yieldServes ?? 1;
  return {
    id: 'ingredients',
    label: 'Ingredients',
    figure: String(lines.length),
    known: true,
    warn: unlinked > 0,
    said: `${parts.join(', ')}.${serves > 1 ? ` Makes ${serves} serves; every card is per serve.` : ''}`,
  };
}

function nutritionCards(data: CocktailRecipe): Card[] {
  const w = data.whatIsIn;
  if (!data.current) return [];
  if (!w || !w.readable) {
    const said = 'What is in a serve could not be read here, so it is not shown as known.';
    return [
      { id: 'energy', label: 'Energy a serve', figure: 'Not read', known: false, said },
      { id: 'alcohol', label: 'Pure alcohol a serve', figure: 'Not read', known: false, said },
    ];
  }
  const energy = w.figures.energyKcal;
  const energyUnknown = figureUnknown(energy);
  const out: Card[] = [
    {
      id: 'energy',
      label: 'Energy a serve',
      figure: figureAmount(energy, 'kcal') ?? 'Not known',
      known: energy.value !== null,
      said: energyUnknown ? `${capital(energyUnknown)}.` : 'From what each ingredient states.',
    },
  ];
  const alcohol = w.figures.alcoholMl;
  if (!alcohol) {
    out.push({ id: 'alcohol', label: 'Pure alcohol a serve', figure: 'Not read', known: false, said: 'Its strength was not read here.' });
  } else {
    const parts: string[] = [];
    const grams = alcoholGrams(alcohol);
    if (grams) parts.push(`${grams} of pure alcohol, from each ingredient's stated strength`);
    const unknown = figureUnknown(alcohol);
    if (unknown) parts.push(unknown);
    out.push({
      id: 'alcohol',
      label: 'Pure alcohol a serve',
      figure: figureAmount(alcohol, 'ml') ?? 'Not known',
      known: alcohol.value !== null,
      said: parts.length > 0 ? `${capital(parts.join('; '))}.` : 'No ingredient states its strength.',
    });
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DrinkCards({
  data,
  sayMoney,
  unsaved,
}: {
  data: CocktailRecipe;
  /** Null for a role that does not see money: then no cost or price card. */
  sayMoney: ((n: number) => string) | null;
  unsaved: boolean;
}) {
  if (!data.current) return null;
  const cards = [
    sayMoney ? costCard(data, sayMoney) : null,
    sayMoney ? priceCard(data, sayMoney) : null,
    ingredientsCard(data),
    ...nutritionCards(data),
  ].filter((c): c is Card => c !== null);
  return (
    <section className="cl-rcp-kpis" data-testid="drink-cards" aria-label="This drink in figures">
      {unsaved ? <p className="cl-note">These are the saved recipe&rsquo;s figures. Save to count your changes.</p> : null}
      <ul className="cl-rcp-cards">
        {cards.map((c) => (
          <li
            key={c.id}
            className="cl-rcp-card"
            data-testid={`drink-card-${c.id}`}
            data-known={c.known ? 'true' : 'false'}
            data-warn={c.warn ? 'true' : 'false'}
          >
            <span className="cl-rcp-card-label">{c.label}</span>
            <span className="cl-rcp-card-fig cl-num">{c.figure}</span>
            <span className="cl-rcp-card-said">{c.said}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
