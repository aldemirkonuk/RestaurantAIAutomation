/**
 * The dishes (and drinks) whose current recipe uses one good (ADR 0366 item 5).
 * GET /recipes/:rid/items/:itemId/dishes. Kept apart from recipes.ts, which
 * lives on the recipe stack.
 */
import { apiClient, getActiveRestaurantId } from './client';

export interface ItemDishCost {
  perServe: number | null;
  perServeExact: number | null;
  priced: number;
  of: number;
  complete: boolean;
  partial: number;
}

/**
 * Why the serves the stock on hand makes are not known (r108 g11):
 * the bottle size or pack size is not recorded, the recipe measures the good
 * another way than the shelf counts it, the recipe makes no serve, or the
 * stock could not be read.
 */
export type ServesWhy = 'size_not_known' | 'pack_size_not_known' | 'unit_mismatch' | 'no_yield' | 'stock_unread' | 'never_counted';

/** How many serves the stock on hand makes; a quantity, so every role is sent it. Absent from an older gateway. */
export interface ItemServes {
  servesFromStock?: number | null;
  servesWhy?: ServesWhy | null;
}

/**
 * This good's share of the serve's cost (r108 g17), from the lines' exact
 * costs, rounded once. Null for staff, and from an older gateway absent.
 */
export interface ItemGoodShare {
  costPerServe: number | null;
  /** Whole percent; null when this good is not priced or there is nothing to share. */
  pct: number | null;
  /** The serve has an unpriced line: the share is of the priced part. */
  ofPricedPart: boolean;
  priced: number;
  of: number;
  /** A line of this good has no price. */
  unpriced: boolean;
}

export interface ItemDish extends ItemServes {
  /** Null for staff. */
  goodShare?: ItemGoodShare | null;
  dishId: string;
  name: string;
  section: string | null;
  /** Null for staff, or when the dish has no price. */
  price: number | null;
  hasRecipe: boolean;
  yieldServes: number | null;
  lineCount: number;
  /** Null for staff. */
  cost: ItemDishCost | null;
  /** This good's lines in the dish's current recipe, for the whole batch of yieldServes plates. */
  uses: Array<{ label: string; qtyEntered: number; unitCode: string }>;
}

/** Why the good in one serve, through a component, is not known (r110 g1). */
export type ThroughWhy = 'unit_mismatch' | 'no_yield' | 'no_serves' | 'cycle';

/** A current drink or dish that draws a house-made component this good is in, with the good in one serve. */
export interface ItemThroughOwner {
  kind: 'dish' | 'cocktail';
  id: string;
  name: string;
  /** In `baseUnit`: mg, ml10 (tenths of a ml) or each_milli. Null with `why`. */
  perServeQtyBase: number | null;
  baseUnit: 'mg' | 'ml10' | 'each_milli' | null;
  why: ThroughWhy | null;
}

/** A house-made component that takes this good (level 1), or one made from such a component (2, 3). */
export interface ItemThroughComponent {
  componentId: string;
  componentName: string;
  level: number;
  owners: ItemThroughOwner[];
}

export interface ItemDishes {
  dishes: ItemDish[];
  /** The recipes that draw it through a component. Null when that read failed; absent from an older gateway. Never money. */
  through?: ItemThroughComponent[] | null;
}

/** Where a dish opens: its own card on /dishes. */
export const dishHref = (dishId: string) => `/dishes?open=${encodeURIComponent(dishId)}`;

/** Where a good opens: its drawer on /inventory (the way back from a recipe line; iv-url.ts reads `open`). */
export const inventoryHref = (inventoryId: string) => `/inventory?open=${encodeURIComponent(inventoryId)}`;

export async function getItemDishes(itemId: string, restaurantId?: string): Promise<ItemDishes> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');
  const response = await apiClient.get<ItemDishes>(`/recipes/${id}/items/${encodeURIComponent(itemId)}/dishes`);
  return response.data;
}

/**
 * The house's drinks whose current recipe uses one good, each with the same
 * figures a dish has. GET /recipes/:rid/items/:itemId/drinks.
 */
export interface ItemDrink extends ItemServes {
  /** Null for staff. */
  goodShare?: ItemGoodShare | null;
  cocktailId: string;
  name: string;
  section: string | null;
  /** Null for staff, or when the drink has no price. */
  price: number | null;
  hasRecipe: boolean;
  yieldServes: number | null;
  lineCount: number;
  /** Null for staff. */
  cost: ItemDishCost | null;
  /** This good's lines in the drink's current recipe, for the whole batch of yieldServes serves. */
  uses: Array<{ label: string; qtyEntered: number; unitCode: string }>;
}

export interface ItemDrinks {
  drinks: ItemDrink[];
}

export async function getItemDrinks(itemId: string, restaurantId?: string): Promise<ItemDrinks> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error('No restaurant ID available');
  const response = await apiClient.get<ItemDrinks>(`/recipes/${id}/items/${encodeURIComponent(itemId)}/drinks`);
  return response.data;
}
