/**
 * The drink's nutrition card: what is in one serve of the SAVED recipe, as the
 * gateway summed it (recipes.service whatIsIn). Nothing is added up here.
 * Unknown reads "unknown for <lines>", never 0; a partial sum reads "at least".
 *
 * Allergens come first (inventory proposal S3, the legal floor), then the
 * figures per serve, then pure alcohol from each line's stated strength.
 *
 * Allergens: a line that states nothing is named, so the card never reads as
 * allergen-free because nothing was recorded (the round-20 rule).
 */
import type { CocktailRecipe, ServeFigure, ServeFigureKey } from '../../../../services/api/recipes';

const ROWS: Array<[ServeFigureKey, string, string]> = [
  ['energyKcal', 'Energy', 'kcal'],
  ['proteinG', 'Protein', 'g'],
  ['fatG', 'Fat', 'g'],
  ['saturatesG', 'of which saturates', 'g'],
  ['carbohydrateG', 'Carbohydrate', 'g'],
  ['sugarsG', 'of which sugars', 'g'],
  ['saltG', 'Salt', 'g'],
];

/** Ethanol's density, g/ml (EU 1169/2011 Annex XIV works energy from it). */
export const ETHANOL_G_PER_ML = 0.789;

export const names = (list: string[]) => [...new Set(list)].join(', ');
/**
 * One decimal, but two under one gram: the gateway sums to the hundredth
 * (recipe-nutrition.ts round2), and 0.06 g of salt read as "0.1 g" was a
 * two-thirds overstatement (browser walk 2026-11-11). EU 1169/2011's rounding
 * guidance also gives salt under 1 g to 0.01 g.
 */
export const num = (n: number, unit: string) =>
  unit === 'g' && Math.abs(n) < 1
    ? (Math.round(n * 100) / 100).toLocaleString('en-US')
    : (Math.round(n * 10) / 10).toLocaleString('en-US');

/** "at least 66.6 kcal", "178.5 kcal", or null when no line states it. */
export function figureAmount(f: ServeFigure, unit: string): string | null {
  if (f.value === null) return null;
  return `${f.atLeast ? 'at least ' : ''}${num(f.value, unit)} ${unit}`;
}

/** "unknown for Campari, Gin", or null when every line states it. */
export function figureUnknown(f: ServeFigure): string | null {
  return f.missing.length > 0 ? `unknown for ${names(f.missing)}` : null;
}

function figureWords(f: ServeFigure, unit: string): string {
  const amount = figureAmount(f, unit);
  const unknown = figureUnknown(f);
  if (amount === null) return unknown ?? 'not known';
  return unknown ? `${amount}, ${unknown}` : amount;
}

/** "at least 20 ml (15.8 g), unknown for Tonic": the grams sit with the amount they convert. */
export function alcoholGrams(f: ServeFigure): string | null {
  return f.value === null ? null : `${num(f.value * ETHANOL_G_PER_ML, 'g')} g`;
}
function alcoholWords(f: ServeFigure): string {
  const amount = figureAmount(f, 'ml');
  const unknown = figureUnknown(f);
  if (amount === null) return unknown ?? 'not known';
  const said = `${amount} (${alcoholGrams(f)})`;
  return unknown ? `${said}, ${unknown}` : said;
}

function Allergens({ w }: { w: Extract<NonNullable<CocktailRecipe['whatIsIn']>, { readable: true }> }) {
  const stated = Object.entries(w.allergens).filter(([, s]) => s === 'contains' || s === 'may_contain');
  const unstatedBy = w.allergensUnstatedBy ?? [];
  return (
    <>
      {stated.length > 0 ? (
        <p className="cl-note" data-testid="recipe-whatisin-allergens">
          {stated
            .map(([a, s]) => `${s === 'contains' ? 'Contains' : 'May contain'} ${a.replace('_', ' ')}`)
            .join('. ')}
          .
        </p>
      ) : null}
      {unstatedBy.length > 0 ? (
        <p className="cl-note cl-rcp-note-warn" data-testid="recipe-whatisin-allergens-unstated">
          No allergen can be ruled out: {names(unstatedBy)} {unstatedBy.length === 1 ? 'does' : 'do'} not say what{' '}
          {unstatedBy.length === 1 ? 'it contains' : 'they contain'}.
        </p>
      ) : w.allergensUnstatedBy && stated.length === 0 ? (
        <p className="cl-note" data-testid="recipe-whatisin-allergens-free">Every ingredient states it is free of the 14 allergens.</p>
      ) : null}
    </>
  );
}

export default function WhatIsInAServe({ data, unsaved }: { data: CocktailRecipe; unsaved: boolean }) {
  if (!data.current) return null;
  const w = data.whatIsIn;
  if (w === undefined || w === null || !w.readable) {
    return (
      <p className="cl-note" role="status" data-testid="recipe-whatisin-unread">
        {w && !w.readable ? w.sentence : 'What is in a serve was not read here, so nothing about it is shown as known.'}
      </p>
    );
  }
  const alcohol = w.figures.alcoholMl;
  return (
    <section className="cl-rcp-nutrition" data-testid="recipe-whatisin" aria-label="What is in a serve">
      <h5 className="cl-sec" style={{ margin: '0 0 4px' }}>What is in a serve</h5>
      {unsaved ? <p className="cl-note">This is the saved recipe. Save to count your changes.</p> : null}
      <Allergens w={w} />
      <dl style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.7 }}>
        {ROWS.map(([k, label, unit]) => (
          <div key={k} data-testid={`recipe-whatisin-${k}`}>
            <dt style={{ display: 'inline' }}>{label}: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{figureWords(w.figures[k], unit)}</dd>
          </div>
        ))}
        {/* An older gateway sends no alcohol figure: then the row is absent, not 0. */}
        {alcohol ? (
          <div data-testid="recipe-whatisin-alcoholMl">
            <dt style={{ display: 'inline' }}>Pure alcohol: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{alcoholWords(alcohol)}</dd>
          </div>
        ) : null}
      </dl>
      {w.notCounted.length > 0 ? (
        <p className="cl-note" data-testid="recipe-whatisin-notcounted">
          Not counted: {w.notCounted.map((n) => `${n.label} (${n.why})`).join('; ')}.
        </p>
      ) : null}
    </section>
  );
}
