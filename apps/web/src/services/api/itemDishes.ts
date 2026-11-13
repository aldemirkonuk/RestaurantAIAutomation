/**
 * The dishes whose current recipe uses one good (ADR 0366 item 5).
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

export interface ItemDish {
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
