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
export type ServesWhy = 'size_not_known' | 'pack_size_not_known' | 'unit_mismatch' | 'no_yield' | 'stock_unread';

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

export interface ItemDishes {
  dishes: ItemDish[];
}

/** Where a dish opens: its own card on /dishes. */
export const dishHref = (dishId: string) => `/dishes?open=${encodeURIComponent(dishId)}`;

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
