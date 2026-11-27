/**
 * Copying a drink (r107 drinks-g3): a new drink with the same section, glass,
 * method, garnish and the same recipe lines, saved as one recipe write on the
 * new drink. The price is not copied: a variant is priced on its own.
 *
 * A line is carried field for field. A line of a kind this file does not
 * know how to carry (the write takes only a stocked or an untracked line)
 * stops the copy before anything is written: a copy that quietly left such a
 * line out would read as the same recipe and cost less (ADR 0051).
 */
import type { CocktailRecipe, SaveRecipeBody } from '../../../../services/api/recipes';
import type { CocktailInput } from '../useCellarNextData';

/** The register row a copy is made from. */
export interface CopySource {
  id: string;
  name: string;
  display_name: string | null;
  menu_section: string | null;
  method: string | null;
  glass: string | null;
  garnish: string | null;
}

export const COPY_NAME_SUFFIX = ' copy';

/** Said when the drink was made and its recipe write was refused. */
export const COPY_RECIPE_FAILED = 'The drink was made but its recipe was not copied. Open it and add the lines.';

/** Said when a line cannot be carried; nothing is written. */
export const COPY_CANNOT_CARRY = 'This drink has a line a copy cannot carry yet (a kind of line it does not know, or an item that was archived or deleted), so nothing was copied.';

/** The new drink's own row: the source's section, glass, method and garnish, never its price. */
export function copyFields(src: CopySource): CocktailInput {
  const f: CocktailInput = { name: `${src.name}${COPY_NAME_SUFFIX}` };
  if (src.display_name) f.displayName = `${src.display_name}${COPY_NAME_SUFFIX}`;
  if (src.menu_section) f.menuSection = src.menu_section;
  if (src.method) f.method = src.method;
  if (src.glass) f.glass = src.glass;
  if (src.garnish) f.garnish = src.garnish;
  return f;
}

/** The recipe write for the copy; null when the source has no saved recipe; `cannot` when a line cannot be carried. */
export function copyRecipeBody(src: CocktailRecipe): SaveRecipeBody | null | 'cannot' {
  const cur = src.current;
  if (!cur) return null;
  if (cur.lines.some((l) => l.role !== 'stocked' && l.role !== 'untracked')) return 'cannot';
  // The gateway refuses to save a line whose item was archived or deleted until it is relinked, and the drink is POSTed first: refuse here so no recipe-less duplicate is left on the list.
  if (cur.lines.some((l) => l.role === 'stocked' && l.itemGone)) return 'cannot';
  const body: SaveRecipeBody = {
    expectedVersionId: null,
    yieldServes: cur.yieldServes,
    lines: cur.lines.map((l) => {
      const line: SaveRecipeBody['lines'][number] = {
        role: l.role,
        inventoryId: l.role === 'stocked' ? l.inventoryId : null,
        label: l.label,
        qty: l.qtyEntered,
        unit: l.unitCode,
      };
      // A line that is 45 % usable costs over what is bought; a copy that saved it as 100 % would cost less than its source (ADR 0051).
      if (l.role === 'stocked' && l.usablePct != null) line.usablePct = l.usablePct;
      return line;
    }),
  };
  if (cur.method) body.method = cur.method;
  if (cur.glass) body.glass = cur.glass;
  if (cur.garnish) body.garnish = cur.garnish;
  return body;
}
