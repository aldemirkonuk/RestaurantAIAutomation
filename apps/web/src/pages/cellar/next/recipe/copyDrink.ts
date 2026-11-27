/**
 * Copying a drink (r107 drinks-g3, reworked r108): the form opens first on the
 * copy's own name (prefilled "Gimlet copy") and nothing is written until Save.
 * Save makes a new drink with the same section, glass, method and garnish, then
 * writes the same recipe lines on it as one recipe write (DD-r107-42's two
 * writes); Leave it writes nothing. The price is not copied: a variant is
 * priced on its own. The display name is not copied either: the form does not
 * show it, so a kept "The Gimlet copy" would print on the list over the name
 * the house typed.
 *
 * A line is carried field for field. A made line (a house-made component, ADR
 * 0397) is carried as the same component id and unit: the copy draws the
 * same component, the component itself is never copied. A line this file
 * cannot carry (a made line naming no component, or a role it does not know)
 * stops the copy before anything is written: a copy that quietly left such a
 * line out would read as the same recipe and cost less (ADR 0051).
 */
import type { CocktailRecipe, RecipeLine, SaveRecipeBody, SaveRecipeLine } from '../../../../services/api/recipes';
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

/** Said when the copy and its recipe are both written. */
export const copySaid = (name: string, from: string) => `“${name}” is on this house’s list, with the recipe of “${from}”.`;

/** Said when the copy's own row was refused: nothing was written, the form stays. */
export const copyRefused = (why: string | null) => `Nothing was copied${why ? ` — ${why}` : ''}. The list is unchanged.`;

/** Said when the drink was made and its recipe write was refused. */
export const COPY_RECIPE_FAILED = 'The drink was made but its recipe was not copied. Open it and add the lines.';

/** Said when a line cannot be carried; nothing is written. */
export const COPY_CANNOT_CARRY = 'This drink has a line a copy cannot carry yet, so nothing was copied.';

/** The new drink's own row: the source's section, glass, method and garnish, never its price. */
export function copyFields(src: CopySource): CocktailInput {
  const f: CocktailInput = { name: `${src.name}${COPY_NAME_SUFFIX}` };
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
  const carried = (l: RecipeLine) =>
    l.role === 'stocked' || l.role === 'untracked' || (l.role === 'made' && Boolean(l.componentId));
  if (!cur.lines.every(carried)) return 'cannot';
  const body: SaveRecipeBody = {
    expectedVersionId: null,
    yieldServes: cur.yieldServes,
    lines: cur.lines.map((l): SaveRecipeLine => {
      const line: SaveRecipeLine = {
        role: l.role,
        inventoryId: l.role === 'stocked' ? l.inventoryId : null,
        label: l.label,
        qty: l.qtyEntered,
        unit: l.unitCode,
      };
      if (l.role === 'made') line.componentId = l.componentId as string;
      // A usable share is part of what the line costs; dropping it would copy the line at 100% and cost less (ADR 0051).
      if (l.role === 'stocked' && l.usablePct != null) line.usablePct = l.usablePct;
      return line;
    }),
  };
  if (cur.method) body.method = cur.method;
  if (cur.glass) body.glass = cur.glass;
  if (cur.garnish) body.garnish = cur.garnish;
  return body;
}
