/**
 * A drink's recipe, over the gateway's `recipes/` routes (ADR 0360).
 *
 * The shapes below are copied from `apps/api-gateway/src/recipes/
 * recipes.service.ts` and `dto/recipes.dto.ts` by hand: a web page does not
 * import gateway code. If the two ever differ, the gateway is right.
 *
 * Money is null whenever the caller's role does not see it: the server nulls
 * the price and every cost for that role, so a page can never show what the
 * server did not send.
 */
import { apiClient } from './client';

export type RecipeLineRole = 'stocked' | 'untracked';
export type RecipeLineStatus = 'linked' | 'not_linked' | 'untracked';

export interface RecipeLine {
  id: string;
  position: number;
  role: RecipeLineRole;
  inventoryId: string | null;
  label: string;
  itemName: string | null;
  itemKind: string | null;
  qtyEntered: number;
  unitCode: string;
  qtyBase: number;
  baseUnit: string;
  status: RecipeLineStatus;
  costPerServe: number | null;
  costBasis: string | null;
}

export interface RecipeVersion {
  versionId: string;
  version: number;
  yieldServes: number;
  method: string | null;
  glass: string | null;
  garnish: string | null;
  createdAt: string;
  lines: RecipeLine[];
}

export interface RecipeCost {
  perServe: number | null;
  priced: number;
  of: number;
  complete: boolean;
}

export interface LegacyRecipeLine {
  label: string | null;
  quantity: number | null;
  unit: string | null;
}

export interface CocktailRecipe {
  cocktail: {
    id: string;
    name: string;
    price: number | null;
    glass: string | null;
    garnish: string | null;
    method: string | null;
    description: string | null;
  };
  current: RecipeVersion | null;
  cost: RecipeCost | null;
  versionCount: number;
  legacyLines: LegacyRecipeLine[];
}

export interface RecipeVersionSummary {
  versionId: string;
  version: number;
  createdAt: string;
  author: string | null;
  lineCount: number;
}

export interface SaveRecipeLine {
  role: RecipeLineRole;
  inventoryId: string | null;
  label: string;
  qty: number;
  unit: string;
}

export interface SaveRecipeBody {
  expectedVersionId: string | null;
  yieldServes: number;
  method?: string;
  glass?: string;
  garnish?: string;
  lines: SaveRecipeLine[];
}

export interface SaveRecipeResult {
  versionId: string;
  version: number;
  lines: unknown[];
}

export interface ShelfItem {
  id: string;
  name: string;
  kind: string | null;
  uom: string | null;
  bottleSizeMl: number | null;
}

const base = (restaurantId: string) => `/recipes/${encodeURIComponent(restaurantId)}`;

export const recipesApi = {
  async get(restaurantId: string, cocktailId: string): Promise<CocktailRecipe> {
    const r = await apiClient.get<CocktailRecipe>(`${base(restaurantId)}/cocktails/${encodeURIComponent(cocktailId)}`);
    return r.data;
  },

  async versions(restaurantId: string, cocktailId: string): Promise<RecipeVersionSummary[]> {
    const r = await apiClient.get<RecipeVersionSummary[]>(
      `${base(restaurantId)}/cocktails/${encodeURIComponent(cocktailId)}/versions`,
    );
    return r.data;
  },

  async save(restaurantId: string, cocktailId: string, body: SaveRecipeBody): Promise<SaveRecipeResult> {
    const r = await apiClient.put<SaveRecipeResult>(
      `${base(restaurantId)}/cocktails/${encodeURIComponent(cocktailId)}`,
      body,
    );
    return r.data;
  },

  async shelf(restaurantId: string, search: string): Promise<ShelfItem[]> {
    const term = search.trim();
    const r = await apiClient.get<ShelfItem[]>(`${base(restaurantId)}/shelf`, {
      params: term ? { search: term, limit: 20 } : { limit: 20 },
    });
    return r.data;
  },
};
