/**
 * The words a recipe sheet says that depend on what the recipe is for: a drink
 * on the cocktail list, or a dish on the food list (ADR 0366).
 *
 * One table, so the sheet, its lines, its cards and its nutrition card cannot
 * drift apart: a dish never shows a gin-and-Angostura example, a "serve", a
 * bottle it pours from, or a pure-alcohol row. Every string a component builds
 * from these reads the same for a drink as it did before this table existed.
 *
 * A dish has no pure-alcohol figure (`alcohol: false`), on the cards and on
 * the nutrition card alike: what it sums is the raw ingredients' stated
 * strength, and cooking drives an unknown share of that off, so a figure would
 * read as a measured amount it is not.
 */
import { RECIPE_UNITS, type RecipeUnit } from './units';

export type RecipeKind = 'cocktail' | 'dish';

export interface RecipeWords {
  /** One portion: "serve" for a drink, "plate" for a dish. */
  unit: 'serve' | 'plate';
  /** What the recipe makes: "drink" or "dish". */
  thing: 'drink' | 'dish';
  /** What a part-priced cost was priced from: "the bottles that have an invoice". */
  stockWord: 'bottles' | 'deliveries';
  /** One of what the shelf counts, when the shelf does not say: "one bottle of gin". */
  container: 'bottle' | 'pack';
  /** The container a volume line comes out of, said when no price can be found. */
  pourFrom: string;
  /** What a volume line comes out of, in "link the item it ... from". */
  comesFrom: 'pours' | 'comes';
  /** What a paste is called: a bartender's spec, or a kitchen's recipe. */
  pasteWord: 'spec' | 'recipe';
  pastePlaceholder: string;
  garnishPlaceholder: string;
  methodPlaceholder: string;
  /** A line that is not counted, e.g. the garnish. */
  notCountedPlaceholder: string;
  /** Whether a pure-alcohol figure is shown at all. */
  alcohol: boolean;
  /**
   * The units a line's picker offers. A bar's dashes, barspoons and US fluid
   * ounces are not how a kitchen measures, so a dish line offers weight,
   * volume, spoons and a count. A line that already carries another unit
   * keeps it (LineRow adds it back), so nothing saved is hidden.
   */
  units: readonly RecipeUnit[];
  /** The unit a fresh line starts in: a bar pours by the ml, a kitchen weighs by the gram. */
  newLineUnit: RecipeUnit;
}

/** A kitchen measures by weight, volume, the spoon and the piece. */
const DISH_UNITS: readonly RecipeUnit[] = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'each'];

const DRINK: RecipeWords = {
  unit: 'serve',
  thing: 'drink',
  stockWord: 'bottles',
  container: 'bottle',
  pourFrom: 'the single bottle you pour from',
  comesFrom: 'pours',
  pasteWord: 'spec',
  pastePlaceholder: '1½ oz gin\n2 dashes Angostura\n1 egg white\nOrange twist garnish',
  garnishPlaceholder: 'Orange peel',
  methodPlaceholder: 'Stir with ice, strain over a large cube',
  notCountedPlaceholder: 'Orange twist',
  alcohol: true,
  units: RECIPE_UNITS,
  newLineUnit: 'ml',
};

const DISH: RecipeWords = {
  unit: 'plate',
  thing: 'dish',
  stockWord: 'deliveries',
  container: 'pack',
  pourFrom: 'the single bottle, tin or pack it comes from',
  comesFrom: 'comes',
  pasteWord: 'recipe',
  // Every line parses with a unit and no flag (recipeWords.test.ts holds that).
  pastePlaceholder: '250 g bread flour\n2 lemons\n100 ml olive oil\nChopped parsley garnish',
  garnishPlaceholder: 'Chopped parsley',
  methodPlaceholder: 'Bake at 180 °C for 35 minutes; rest 10 before cutting',
  notCountedPlaceholder: 'Chopped parsley',
  alcohol: false,
  units: DISH_UNITS,
  newLineUnit: 'g',
};

/** The words for a recipe's kind. Anything but a dish reads as a drink, as before. */
export function recipeWords(kind: RecipeKind | string | null | undefined): RecipeWords {
  return kind === 'dish' ? DISH : DRINK;
}
