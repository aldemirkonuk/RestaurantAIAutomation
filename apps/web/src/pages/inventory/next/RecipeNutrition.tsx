/**
 * "What is in it" for a recipe: the sum of its lines (sumRecipe, #940), shown on
 * the recipe it belongs to. A figure no line states reads "unknown for <lines>",
 * never 0; a figure some lines lack reads "at least N" and names them.
 */
import { sumRecipe, type RecipeLine, type SumKey } from './nutrition-sum';
import { figureWords } from './nutrition-words';

const ROWS: Array<[SumKey, string, 'kcal' | 'g']> = [
  ['energyKcal', 'Energy', 'kcal'],
  ['proteinG', 'Protein', 'g'],
  ['fatG', 'Fat', 'g'],
  ['carbohydrateG', 'Carbohydrate', 'g'],
  ['sugarsG', 'Sugar', 'g'],
  ['saltG', 'Salt', 'g'],
];

const names = (list: string[]) => [...new Set(list)].join(', ');

export default function RecipeNutrition({ lines }: { lines: RecipeLine[] }) {
  if (lines.length === 0) return null;
  const sum = sumRecipe(lines);
  return (
    <div data-testid="recipe-nutrition" style={{ marginTop: 10 }}>
      <h4 className="cl-sec" style={{ margin: '0 0 6px' }}>What is in it</h4>
      <dl style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7 }}>
        {ROWS.map(([k, label, unit]) => {
          const f = sum.figures[k];
          const unknown = f.missing.length > 0 ? `unknown for ${names(f.missing)}` : null;
          return (
            <div key={k} data-testid={`recipe-nutrition-${k}`}>
              <dt style={{ display: 'inline' }}>{label}: </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {f.value === null ? unknown ?? 'not known' : `${f.atLeast ? 'at least ' : ''}${figureWords(f.value, unit)}${unknown ? `, ${unknown}` : ''}`}
              </dd>
            </div>
          );
        })}
      </dl>
      {sum.notCounted.length > 0 ? (
        <p className="cl-note" data-testid="recipe-nutrition-notcounted">
          Not counted: {sum.notCounted.map((n) => `${n.name} (${n.why})`).join('; ')}.
        </p>
      ) : null}
    </div>
  );
}
