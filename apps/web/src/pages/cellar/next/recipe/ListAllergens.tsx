/**
 * The allergen column of /dishes and /cocktails, and the allergen check above
 * them (r36 recipes audit, gap 8): staff answer "which dishes have nuts"
 * without opening every sheet. The words are the sheet's (WhatIsInAServe):
 * an allergen is free only when every line states it free, and a line that
 * states nothing is named, so a row never reads as allergen-free because
 * nothing was recorded.
 *
 * The check hides only the rows that state the chosen allergen free. A row
 * that contains it, may contain it, does not say, has no recipe yet or could
 * not be read stays shown: for a guest's allergy, "not known" is never "free".
 */
import { useId } from 'react';
import type { RowAllergens } from '../../../../services/api/recipes';
import { EM } from '../cellar-format';
import { names } from './WhatIsInAServe';

/** EU 1169/2011 Annex II, in the gateway's order (recipe-nutrition.ts ALLERGENS). */
export const ALLERGEN_KEYS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;

/** "tree nuts", as the sheet writes it. */
export const allergenWord = (a: string) => a.replace('_', ' ');

/** The cell's sentence, or null for no recipe (or an older gateway). */
export function allergenSentence(a: RowAllergens | null | undefined): string | null {
  if (!a) return null;
  if (!a.readable) return 'Could not be read';
  const of = (s: string) => ALLERGEN_KEYS.filter((k) => a.status[k] === s).map(allergenWord);
  const parts: string[] = [];
  const contains = of('contains');
  const may = of('may_contain');
  if (contains.length) parts.push(`Contains ${contains.join(', ')}`);
  if (may.length) parts.push(`May contain ${may.join(', ')}`);
  if (a.unstatedBy.length) {
    parts.push(parts.length ? `not known for ${names(a.unstatedBy)}` : `Not known: ${names(a.unstatedBy)} say${a.unstatedBy.length === 1 ? 's' : ''} nothing`);
  } else if (!parts.length) {
    parts.push(ALLERGEN_KEYS.every((k) => a.status[k] === 'free') ? 'Free of all 14' : 'Not known');
  }
  return parts.join('; ');
}

export function AllergenCell({ id, a }: { id: string; a: RowAllergens | null | undefined }) {
  const said = allergenSentence(a);
  return (
    <td data-testid={`allergens-${id}`} style={{ fontSize: 12.5 }}>
      {said === null ? <span className="cl-dim">{EM}</span> : a && a.readable ? said : <span className="cl-dim">{said}</span>}
    </td>
  );
}

/** False only when the row states the allergen free; kept otherwise (see the header). */
export function keptFor(a: RowAllergens | null | undefined, allergen: string): boolean {
  if (!allergen) return true;
  return !(a && a.readable && a.status[allergen] === 'free');
}

/**
 * The check: "Every one" or one of the 14. `hidden` is how many rows the
 * check hides; `noun` is "dishes" or "drinks".
 */
export function AllergenCheck({
  value,
  onChange,
  hidden,
  noun,
}: {
  value: string;
  onChange: (v: string) => void;
  hidden: number;
  noun: 'dishes' | 'drinks';
}) {
  const id = useId();
  const word = value ? allergenWord(value) : '';
  return (
    <div style={{ marginTop: 12 }} data-testid="allergen-check">
      <label htmlFor={`${id}-a`} className="cl-said">
        Check an allergen{' '}
        <select id={`${id}-a`} className="cl-field cl-focus" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Show every one</option>
          {ALLERGEN_KEYS.map((k) => (
            <option key={k} value={k}>
              {allergenWord(k)}
            </option>
          ))}
        </select>
      </label>
      {value ? (
        <p className="cl-note" role="status" style={{ marginTop: 6 }} data-testid="allergen-check-said">
          Showing the {noun} that contain {word}, may contain it, or do not say.{' '}
          {hidden === 0
            ? `None says it is free of ${word}.`
            : `${hidden} ${hidden === 1 ? (noun === 'dishes' ? 'dish says it is' : 'drink says it is') : `${noun} say they are`} free of ${word} and ${hidden === 1 ? 'is' : 'are'} hidden.`}
        </p>
      ) : null}
    </div>
  );
}
