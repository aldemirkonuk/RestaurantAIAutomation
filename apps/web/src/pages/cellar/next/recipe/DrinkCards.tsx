/**
 * A drink's own cards, the first thing an opened drink shows (inventory
 * proposal S2.4: "a drink opens its own drawer with the same cards, rolled up
 * from its lines"). Each card is one figure and one sentence that says where
 * it comes from. Nothing is summed here: the cost and what is in a serve are
 * the gateway's (recipe-cost.ts, recipe-nutrition.ts), of the SAVED recipe, except
 * the cost of an unsaved draft, which the gateway also prices (`draftCost`).
 *
 * Unknown is a word, never 0: a cost with one unpriced line is "Not known"
 * and names that line, because a partial sum shown as the cost would read as
 * the drink costing less than it does (ADR 0051).
 *
 * The pour-cost card (ADR 0366 item 6, superseding ADR 0360 item 8) is the
 * cost a serve over the price, as a %, shown only when the cost is complete
 * and the price is known and above 0; otherwise it is "Not known" and says
 * which side is missing, never a % of a partial cost. The house's tax basis
 * is still open (ADR 0359, #784), so the card says the % is of the price as
 * the list has it, and that whether that price includes tax is not recorded.
 *
 * The margin card (r36 recipes audit, gap 9) is the same two figures as
 * money: the price less the cost a serve, under the same rule (a complete
 * cost and a price above 0, or "Not known"). A drink that costs more than its
 * price reads as a minus and is marked.
 *
 * The energy and pure-alcohol cards open the full card of what is in a serve
 * (`WhatIsInAServe`, below the cards) when the sheet names it: a click moves
 * to it and puts the focus there, so a reader of the figure gets its
 * allergens and every other figure in one step (the goal's "KPI card ->
 * nutrition card").
 */
import type { SayPercent } from './useHousePercent';
import { UNSET_TAX, priceForShare, shareBasis, taxSaid, type ListTax } from './listTax';
import type { CocktailRecipe, CostPreview, RecipeCost, RecipeLine } from '../../../../services/api/recipes';
import { alcoholGrams, figureAmount, figureUnknown, names } from './WhatIsInAServe';
import { formatHousePercent } from '../../../../lib/house-number';
import { recipeWords, type RecipeWords } from './recipeWords';
import { lineShares, type ShareInput } from './lineShare';

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

/** 78 not 78.0: a whole-number share in the house's own form (the form's trailing zero decimal is dropped). */
const whole = (say: SayPercent, points: number) => say(points).replace(/([.,])0(?!\d)/, '');

/** Each line of the cost card with its share of the serve's cost; none when nothing is priced. */
function shareLines(items: ShareInput[], say: SayPercent): { shares: string[]; sharesNote?: string } | null {
  const r = lineShares(items);
  if (!r) return null;
  return {
    shares: r.lines.map((l) => (l.pct == null ? `${l.label} not priced` : `${l.label} ${whole(say, l.pct)}`)),
    sharesNote: r.ofPricedPart ? 'Shares are of the priced part of the serve.' : undefined,
  };
}

const unpricedNames = (lines: RecipeLine[]) =>
  names(lines.filter((l) => l.role === 'stocked' && l.costPerServe == null).map((l) => l.itemName ?? l.label));

/** The unsaved lines' cost, with the label of each line sent, in the order sent. */
export interface DraftCost {
  cost: CostPreview;
  labels: string[];
}

/** Said when the lines, each to the cent, do not add to the total (which is rounded once, from the exact figures). */
export const ROUNDING_NOTE = 'Each line is rounded to the cent; the total is not.';

const linesDoNotAdd = (total: number | null, lineCosts: Array<number | null>): boolean =>
  total != null && lineCosts.length > 0 && Math.round(lineCosts.reduce<number>((a, c) => a + (c ?? 0), 0) * 100) !== Math.round(total * 100);

function costCard(
  cost: RecipeCost | null,
  missing: string,
  sayMoney: (n: number) => string,
  draft: boolean,
  words: RecipeWords,
  lineCount = cost?.of ?? 0,
  lineCosts: Array<number | null> = [],
): Card | null {
  if (!cost) return null;
  const base = { id: 'cost', label: 'Cost per serve' };
  // A line switched to "not counted" leaves the figure lower without a word; say how many are left out, beside the figure.
  const left = Math.max(0, lineCount - cost.of);
  const leftOut = left > 0 ? ` ${capital(count(left, 'line is', 'lines are'))} not counted.` : '';
  if (cost.complete && cost.perServe != null) {
    const exact = cost.perServeExact ?? null;
    const figure = cost.perServe === 0 && exact != null && exact > 0 ? `Under ${sayMoney(0.01)}` : sayMoney(cost.perServe);
    const part = cost.partial ?? 0;
    const last = cost.lastBought ?? 0;
    const lead = draft ? "Your unsaved lines, at today's prices" : "At today's prices";
    const priced = draft ? '' : cost.of === 1 ? ', its one ingredient priced' : `, all ${cost.of} ingredients priced`;
    const rounding = linesDoNotAdd(cost.perServe, lineCosts) ? ` ${ROUNDING_NOTE}` : '';
    const notes = [
      part > 0 ? `${count(part, 'ingredient is', 'ingredients are')} priced from the ${words.stockWord} with an invoice only` : null,
      // Nothing of it on hand is priced: the figure is what it last cost (r36 gap 1).
      last > 0
        ? `${count(last, 'ingredient is priced at what it last cost', 'ingredients are priced at what they last cost')}, with none priced on hand`
        : null,
    ].filter((n): n is string => n !== null);
    return {
      ...base,
      figure,
      known: true,
      said: (notes.length ? `${lead}; ${notes.join('; ')}.` : `${lead}${priced}.`) + leftOut + rounding,
    };
  }
  if (cost.of === 0) {
    return { ...base, figure: 'Not known', known: false, said: 'Nothing in it is counted from your shelf, so nothing here has a price.' };
  }
  return {
    ...base,
    figure: 'Not known',
    known: false,
    warn: true,
    said: `${cost.priced} of ${count(cost.of, 'ingredient', 'ingredients')} priced${missing ? `; no price yet for ${missing}` : ''}.${leftOut}`,
  };
}

function priceCard(data: CocktailRecipe, sayMoney: (n: number) => string, words: RecipeWords): Card {
  const price = data.cocktail.price;
  return price != null
    ? { id: 'price', label: 'Price', figure: sayMoney(price), known: true, said: `A ${words.unit}, as your list has it.` }
    : { id: 'price', label: 'Price', figure: 'No price', known: false, said: 'Your list has no price for it.' };
}

/**
 * A share in a list cell: the figure alone. While the tax basis is unset or unread it is warned
 * (colour + a hover title), and the sentence is said ONCE under the table (`ShareBasisCaption`),
 * not under every row: a sentence under each figure grew every row (35 to 56 px) the moment the
 * basis was read, a layout shift of 0.10-0.13 on /cocktails (r103 FAIL 11).
 */
export function ShareFigure({ text, tax }: { text: string; tax: ListTax }) {
  const basis = shareBasis(tax);
  if (!basis.warn) return <span title={basis.text}>{text}</span>;
  return (
    <span style={{ color: 'var(--warn)' }} data-warn="true" title={basis.text}>
      {text}
    </span>
  );
}

/**
 * The one sentence under a table of shares. Its room is held from first paint, whatever the basis
 * turns out to be (empty once it is set), so reading the basis moves nothing (ADR 0112: no fade).
 */
export function ShareBasisCaption({ tax }: { tax: ListTax }) {
  const basis = shareBasis(tax);
  // A house whose prices include tax, with no rate recorded, reads "Not known" in every share cell: say why, once, here.
  const saysWhy = basis.warn || (tax.basis === 'prices_include_tax' && tax.ratePct == null);
  return (
    <p className="cl-share-caption cl-dim" data-testid="share-basis-caption" data-warn={basis.warn ? 'true' : 'false'}>
      {saysWhy ? taxSaid(tax) : ''}
    </p>
  );
}

/** Said under every pour-cost %, until the house's tax basis is set (ADR 0359). */
export const POUR_COST_BASIS = taxSaid(UNSET_TAX);

/**
 * Cost per serve over the price, as a % to one decimal; or what is missing.
 * Only a complete cost and a price above 0 make a %: a partial cost would
 * read as a cheaper pour than the real one (ADR 0051).
 */
export function pourCostShare(
  cost: RecipeCost | null,
  price: number | null,
  tax: ListTax = UNSET_TAX,
): { pct: number } | { missing: string[] } {
  const exact = cost?.complete ? (cost.perServeExact ?? cost.perServe) : null;
  const missing: string[] = [];
  if (exact == null) missing.push('the cost is not complete');
  if (price == null) missing.push('your list has no price for it');
  else if (!(price > 0)) missing.push('the price on your list is 0');
  else {
    const net = priceForShare(price, tax);
    if ('missing' in net) missing.push(net.missing);
  }
  if (missing.length || exact == null || price == null) return { missing };
  const against = (priceForShare(price, tax) as { price: number }).price;
  return { pct: Math.round((exact / against) * 1000) / 10 };
}

/**
 * The price less the cost a serve, to the cent; or what is missing. The same
 * rule as `pourCostShare`: only a complete cost and a price above 0.
 */
export function marginPerServe(
  cost: RecipeCost | null,
  price: number | null,
  tax: ListTax = UNSET_TAX,
): { margin: number } | { missing: string[] } {
  const share = pourCostShare(cost, price, tax);
  if (!('pct' in share)) return share;
  const exact = (cost?.perServeExact ?? cost?.perServe) as number;
  const against = (priceForShare(price as number, tax) as { price: number }).price;
  return { margin: Math.round((against - exact) * 100) / 100 };
}

function marginCard(cost: RecipeCost | null, price: number | null, sayMoney: (n: number) => string, words: RecipeWords, tax: ListTax): Card {
  const m = marginPerServe(cost, price, tax);
  const base = { id: 'margin', label: `Margin a ${words.unit}` };
  if (!('margin' in m)) return { ...base, figure: 'Not known', known: false, said: `${capital(m.missing.join(' and '))}.` };
  if (m.margin < 0) {
    return {
      ...base,
      figure: `\u2212${sayMoney(-m.margin)}`,
      known: true,
      warn: true,
      said: `It costs more to make than ${tax.basis === 'prices_include_tax' ? 'your price without tax brings in' : 'your list charges for it'}. ${taxSaid(tax)}`,
    };
  }
  return { ...base, figure: sayMoney(m.margin), known: true, said: `Your price less the cost a ${words.unit}. ${taxSaid(tax)}` };
}

/** A share in the reader's own form, for a caller that does not know the house's. */
const readerPercent: SayPercent = (points) => formatHousePercent(points, null);

function pourCostCard(cost: RecipeCost | null, price: number | null, sayPct: SayPercent, tax: ListTax): Card {
  const share = pourCostShare(cost, price, tax);
  const base = { id: 'pour-cost', label: 'Pour cost' };
  return 'pct' in share
    ? { ...base, figure: sayPct(share.pct), known: true, said: taxSaid(tax) }
    : { ...base, figure: 'Not known', known: false, said: `${capital(share.missing.join(' and '))}.` };
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
  const unit = data.kind === 'dish' ? 'plate' : 'serve';
  return {
    id: 'ingredients',
    label: 'Ingredients',
    figure: String(lines.length),
    known: true,
    warn: unlinked > 0,
    said: `${parts.join(', ')}.${serves > 1 ? ` Makes ${serves} ${unit}s; every card is per ${unit}.` : ''}`,
  };
}

function nutritionCards(data: CocktailRecipe, words: RecipeWords): Card[] {
  const w = data.whatIsIn;
  if (!data.current) return [];
  if (!w || !w.readable) {
    const said = `What is in a ${words.unit} could not be read here, so it is not shown as known.`;
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

/** The cards that open the full card of what is in a serve. */
const OPENS_NUTRITION = new Set(['energy', 'alcohol']);

/** The card's own face, as a button: the card's column, no button chrome, a pointer. */
const OPEN_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: '100%',
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

/** Moves to the card of what is in a serve and puts the focus on it. */
function openNutrition(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

/** A dish says plate and food cost, and has no alcohol card (ADR 0366). */
const DISH_LABELS: Record<string, string> = { cost: 'Cost per plate', 'pour-cost': 'Food cost', energy: 'Energy a plate' };

function CardFace({ c }: { c: Card }) {
  return (
    <>
      <span className="cl-rcp-card-label">{c.label}</span>
      <span className="cl-rcp-card-fig cl-num">{c.figure}</span>
      <span className="cl-rcp-card-said">{c.said}</span>
    </>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DrinkCards({
  data,
  sayMoney,
  unsaved,
  draftCost,
  sayPct = readerPercent,
  tax = UNSET_TAX,
  nutritionId,
}: {
  data: CocktailRecipe;
  /** Null for a role that does not see money: then no cost or price card. */
  sayMoney: ((n: number) => string) | null;
  unsaved: boolean;
  /**
   * The unsaved lines priced at today's prices, once the gateway has answered.
   * Absent while it is asked, when it failed, or when the draft is not whole
   * enough to price: then the cost card keeps the saved recipe's figure.
   */
  draftCost?: DraftCost | null;
  /**
   * Writes the pour/food cost share in the house's form ("%18,7" in a lira
   * house), as /dishes and the inventory drawer write it (r28 recipes audit,
   * gap 15). The reader's own form when not given.
   */
  sayPct?: SayPercent;
  /**
   * What the house says about tax in its list prices. The pour/food cost share
   * and the margin are taken against the price without tax when the house says
   * its prices include it. Unset when not given (the figures as they were).
   */
  tax?: ListTax;
  /**
   * The id of the sheet's card of what is in a serve. When given, the energy
   * and pure-alcohol cards open it (r36 recipes audit, gap 9).
   */
  nutritionId?: string;
}) {
  const isDish = data.kind === 'dish';
  const words = recipeWords(data.kind);
  const draft = unsaved && draftCost ? draftCost : null;
  // A drink never saved has no saved figures; its only card is the draft's
  // cost (and the list's price), once its lines are whole enough to price.
  if (!data.current && !draft) return null;
  // The cost the cost card shows: the unsaved draft's once priced, else the saved recipe's.
  const shownCost: RecipeCost | null = !sayMoney ? null : draft ? draft.cost : data.current ? data.cost : null;
  const cost = !sayMoney
    ? null
    : draft
      ? costCard(
          draft.cost,
          names(draft.cost.lines.flatMap((l, i) => (l.status !== 'untracked' && l.costPerServe == null ? [draft.labels[i] ?? 'a line'] : []))),
          sayMoney,
          true,
          words,
          draft.cost.lines.length,
          draft.cost.lines.map((l) => l.costPerServe),
        )
      : data.current
        ? costCard(data.cost, unpricedNames(data.current.lines), sayMoney, false, words, data.current.lines.length, data.current.lines.map((l) => l.costPerServe))
        : null;
  // Which line drives the cost (r107 g5): from the lines the cost card was made from.
  const shareItems: ShareInput[] = draft
    ? draft.cost.lines.map((l, i) => ({ label: draft.labels[i] ?? 'A line', cost: l.costPerServe, counted: l.status !== 'untracked' }))
    : (data.current?.lines ?? []).map((l) => ({
        label: l.itemName ?? l.label,
        cost: l.costPerServeExact ?? l.costPerServe,
        counted: l.role === 'stocked',
      }));
  const shared = cost && sayMoney ? shareLines(shareItems, sayPct) : null;
  const cards = [
    cost,
    sayMoney ? priceCard(data, sayMoney, words) : null,
    sayMoney ? pourCostCard(shownCost, data.cocktail.price, sayPct, tax) : null,
    sayMoney ? marginCard(shownCost, data.cocktail.price, sayMoney, words, tax) : null,
    ingredientsCard(data),
    ...nutritionCards(data, words),
  ]
    .filter((c): c is Card => c !== null)
    .filter((c) => words.alcohol || c.id !== 'alcohol')
    .map((c) => (isDish && DISH_LABELS[c.id] ? { ...c, label: DISH_LABELS[c.id] } : c));
  return (
    <section className="cl-rcp-kpis" data-testid="drink-cards" aria-label={isDish ? 'This dish in figures' : 'This drink in figures'}>
      {unsaved ? (
        <p className="cl-note">
          {draft && !data.current
            ? 'The cost is your unsaved lines. Nothing else is counted until the recipe is saved.'
            : draft
              ? 'The cost is your unsaved lines. The other figures are the saved recipe’s; save to count them.'
              : 'These are the saved recipe’s figures. Save to count your changes.'}
        </p>
      ) : null}
      <ul className="cl-rcp-cards">
        {cards.map((c) => (
          <li
            key={c.id}
            className="cl-rcp-card"
            data-testid={`drink-card-${c.id}`}
            data-known={c.known ? 'true' : 'false'}
            data-warn={c.warn ? 'true' : 'false'}
          >
            {nutritionId && OPENS_NUTRITION.has(c.id) ? (
              <button
                type="button"
                className="cl-rcp-card-open cl-focus"
                aria-controls={nutritionId}
                title={`See what is in a ${words.unit}`}
                data-testid={`drink-card-${c.id}-open`}
                onClick={() => openNutrition(nutritionId)}
                style={OPEN_STYLE}
              >
                <CardFace c={c} />
              </button>
            ) : (
              <CardFace c={c} />
            )}
          </li>
        ))}
      </ul>
      {shared ? (
        <div className="cl-rcp-card-said" data-testid="line-shares-block" style={{ marginTop: 8 }}>
          <span>Share of the cost a {words.unit}</span>
          <ul data-testid="line-shares" style={{ listStyle: 'none', padding: 0, margin: '2px 0 0' }}>
            {shared.shares.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {shared.sharesNote ? <span>{shared.sharesNote}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
