/**
 * What is in one serve of the SAVED recipe, as the gateway summed it
 * (recipes.service whatIsIn). Nothing is added up here. Unknown reads
 * "unknown for <lines>", never 0; a partial sum reads "at least".
 *
 * Allergens: a line that states nothing is named, so the card never reads as
 * allergen-free because nothing was recorded (the round-20 rule).
 */
import type { CocktailRecipe, ServeFigureKey } from '../../../../services/api/recipes';

const ROWS: Array<[ServeFigureKey, string, string]> = [
  ['energyKcal', 'Energy', 'kcal'],
  ['proteinG', 'Protein', 'g'],
  ['fatG', 'Fat', 'g'],
  ['saturatesG', 'of which saturates', 'g'],
  ['carbohydrateG', 'Carbohydrate', 'g'],
  ['sugarsG', 'of which sugars', 'g'],
  ['saltG', 'Salt', 'g'],
];

const names = (list: string[]) => [...new Set(list)].join(', ');
const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');

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
  const stated = Object.entries(w.allergens).filter(([, s]) => s === 'contains' || s === 'may_contain');
  return (
    <div className="cl-rcp-whatisin" data-testid="recipe-whatisin">
      <h5 className="cl-sec" style={{ margin: '10px 0 4px' }}>What is in a serve</h5>
      {unsaved ? <p className="cl-note">This is the saved recipe. Save to count your changes.</p> : null}
      <dl style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7 }}>
        {ROWS.map(([k, label, unit]) => {
          const f = w.figures[k];
          const unknown = f.missing.length > 0 ? `unknown for ${names(f.missing)}` : null;
          const said =
            f.value === null
              ? unknown ?? 'not known'
              : `${f.atLeast ? 'at least ' : ''}${num(f.value)} ${unit}${unknown ? `, ${unknown}` : ''}`;
          return (
            <div key={k} data-testid={`recipe-whatisin-${k}`}>
              <dt style={{ display: 'inline' }}>{label}: </dt>
              <dd style={{ display: 'inline', margin: 0 }}>{said}</dd>
            </div>
          );
        })}
      </dl>
      {stated.length > 0 ? (
        <p className="cl-note" data-testid="recipe-whatisin-allergens">
          {stated
            .map(([a, s]) => `${s === 'contains' ? 'Contains' : 'May contain'} ${a.replace('_', ' ')}`)
            .join('. ')}
          .
        </p>
      ) : null}
      {(w.allergensUnstatedBy ?? []).length > 0 ? (
        <p className="cl-note cl-rcp-note-warn" data-testid="recipe-whatisin-allergens-unstated">
          No allergen can be ruled out: {names(w.allergensUnstatedBy ?? [])}{' '}
          {(w.allergensUnstatedBy ?? []).length === 1 ? 'does' : 'do'} not say what {(w.allergensUnstatedBy ?? []).length === 1 ? 'it contains' : 'they contain'}.
        </p>
      ) : w.allergensUnstatedBy && stated.length === 0 ? (
        <p className="cl-note" data-testid="recipe-whatisin-allergens-free">Every ingredient states it is free of the 14 allergens.</p>
      ) : null}
      {w.notCounted.length > 0 ? (
        <p className="cl-note" data-testid="recipe-whatisin-notcounted">
          Not counted: {w.notCounted.map((n) => `${n.label} (${n.why})`).join('; ')}.
        </p>
      ) : null}
    </div>
  );
}
