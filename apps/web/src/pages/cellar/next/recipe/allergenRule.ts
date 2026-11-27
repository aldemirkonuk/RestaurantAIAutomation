/**
 * The one allergen rule the list cell, the recipe card, the spec book and the
 * sheet's What is in a serve all say (r110 drinks-3, DD-r109-36). Each surface
 * keeps its own words; none decides "free" or "not known" for itself.
 *
 * - A failed read (or none) is `unread`: never free, never blank.
 * - `free` only when every one of the 14 is stated free and the gateway names
 *   no line that leaves one unstated. An older gateway that sends no
 *   `unstatedBy` cannot be free: it cannot say which lines are silent.
 * - Otherwise what is stated is said, the silent lines are named, and nothing
 *   stated with nobody named is `unknown`, so "nothing recorded" never reads
 *   as allergen-free.
 */
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

export const ALLERGENS_UNREAD = 'Allergens could not be read.';

export type AllergenRead =
  | { readable: true; status: Record<string, string>; unstatedBy?: string[] | null }
  | { readable: false }
  | null
  | undefined;

export type AllergenVerdict =
  | { kind: 'unread' }
  | { kind: 'free' }
  | { kind: 'unknown' }
  /** At least one allergen is stated as in it, or at least one line is silent. */
  | { kind: 'stated'; stated: Array<[string, 'contains' | 'may_contain']>; unstatedBy: string[] };

export function allergenVerdict(read: AllergenRead): AllergenVerdict {
  if (!read || !read.readable) return { kind: 'unread' };
  const status = read.status ?? {};
  // The 14 in their order, then any other key the gateway states: a stated
  // allergen is never dropped for not being one of the 14.
  const keys = [...ALLERGEN_KEYS, ...Object.keys(status).filter((k) => !(ALLERGEN_KEYS as readonly string[]).includes(k))];
  const stated = keys
    .filter((k) => status[k] === 'contains' || status[k] === 'may_contain')
    .map((k) => [k, status[k]] as [string, 'contains' | 'may_contain']);
  const unstatedBy = [...new Set(read.unstatedBy ?? [])];
  if (stated.length > 0 || unstatedBy.length > 0) return { kind: 'stated', stated, unstatedBy };
  if (Array.isArray(read.unstatedBy) && ALLERGEN_KEYS.every((k) => status[k] === 'free')) return { kind: 'free' };
  return { kind: 'unknown' };
}
