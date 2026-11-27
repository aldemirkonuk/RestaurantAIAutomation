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
  /** How the shelf counts the linked item (bottle, kg, each...); absent from an older gateway. */
  itemUom?: string | null;
  /** The linked item was archived or deleted since; such a line cannot be saved until linked again. */
  itemGone?: 'archived' | 'deleted' | null;
  qtyEntered: number;
  unitCode: string;
  qtyBase: number;
  baseUnit: string;
  status: RecipeLineStatus;
  /**
   * The line's own cost, rounded to the cent on its own: equal costs read the
   * same, and the lines can be a cent off the total, which is rounded once.
   */
  costPerServe: number | null;
  /** The same cost at six places. */
  costPerServeExact?: number | null;
  /**
   * A cost basis, or why there is no price: size_not_known (a bottle with no
   * size), pack_size_not_known (case, pack, glass, shot), unit_mismatch.
   */
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
  perServeExact?: number | null;
  priced: number;
  of: number;
  complete: boolean;
  /** Priced lines whose average covers only part of the stock on hand. */
  partial?: number;
}

export interface LegacyRecipeLine {
  label: string | null;
  quantity: number | null;
  unit: string | null;
}

export type ServeFigureKey =
  | 'energyKcal'
  | 'fatG'
  | 'saturatesG'
  | 'carbohydrateG'
  | 'sugarsG'
  | 'proteinG'
  | 'saltG';

export interface ServeFigure {
  /** Per serve; null when not known, never 0. */
  value: number | null;
  atLeast: boolean;
  missing: string[];
}

/** recipes.service.ts WhatIsIn. */
export type WhatIsIn =
  | {
      readable: true;
      /**
       * Per serve. `alcoholMl` is millilitres of pure alcohol from each line's
       * stated ABV; absent from an older gateway, and then said as not read.
       */
      figures: Record<ServeFigureKey, ServeFigure> & { alcoholMl?: ServeFigure };
      notCounted: Array<{ label: string; why: string }>;
      allergens: Record<string, 'contains' | 'may_contain' | 'free' | 'not_stated'>;
      /** Lines that leave an allergen unstated; absent from an older gateway. */
      allergensUnstatedBy?: string[];
    }
  | { readable: false; sentence: string };

/** What a recipe belongs to (ADR 0366). A bare string means a cocktail. */
export type RecipeOwner = { kind: 'cocktail' | 'dish'; id: string };

export const ownerOf = (o: string | RecipeOwner): RecipeOwner => (typeof o === 'string' ? { kind: 'cocktail', id: o } : o);

export interface CocktailRecipe {
  /** Absent means a cocktail. A dish also fills `cocktail` (follow-up: rename it `owner`). */
  kind?: 'cocktail' | 'dish';
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
  /** Absent from an older gateway: said as not read. */
  whatIsIn?: WhatIsIn | null;
  versionCount: number;
  legacyLines: LegacyRecipeLine[];
}

export interface RecipeVersionSummary {
  versionId: string;
  version: number;
  createdAt: string;
  author: string | null;
  /** Who saved it, by name; null when not known. */
  authorName?: string | null;
  lineCount: number;
}

/** One earlier version, as GET .../versions/:versionId sends it. */
export interface PastRecipeVersion {
  version: RecipeVersion;
  cost: RecipeCost | null;
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

/** One line of an unsaved draft, as POST .../cost-preview takes it. */
export interface PreviewCostLine {
  role: RecipeLineRole;
  inventoryId: string | null;
  qtyEntered: number;
  unitCode: string;
}

export interface PreviewCostBody {
  yieldServes: number;
  lines: PreviewCostLine[];
}

/** What a draft would cost at today's prices: the saved cost's shape, plus each line in the order sent. */
export interface CostPreview extends RecipeCost {
  lines: Array<{ status: RecipeLineStatus; costPerServe: number | null; costBasis: string | null }>;
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

/**
 * One pasted label's shelf item by exact name, case and runs of spaces folded
 * (ADR 0366 item 7). `item` is null when no live item, or more than one, has
 * that name; `sameName` says how many do.
 */
export interface ShelfMatch {
  label: string;
  item: ShelfItem | null;
  sameName: number;
}

const base = (restaurantId: string) => `/recipes/${encodeURIComponent(restaurantId)}`;

/** `cocktails/<id>` or `dishes/<id>`: the one place a recipe's path is built. */
const ownerPath = (restaurantId: string, owner: string | RecipeOwner) => {
  const o = ownerOf(owner);
  return `${base(restaurantId)}/${o.kind === 'dish' ? 'dishes' : 'cocktails'}/${encodeURIComponent(o.id)}`;
};

/** GET /dishes/:dishId as the gateway sends it. */
interface DishRecipeAnswer extends Omit<CocktailRecipe, 'cocktail' | 'kind'> {
  dish: { id: string; name: string; section: string | null; price: number | null; description: string | null };
}

export const recipesApi = {
  async get(restaurantId: string, owner: string | RecipeOwner): Promise<CocktailRecipe> {
    if (ownerOf(owner).kind === 'dish') {
      const r = await apiClient.get<DishRecipeAnswer>(ownerPath(restaurantId, owner));
      const { dish, ...rest } = r.data;
      return {
        ...rest,
        kind: 'dish',
        cocktail: { id: dish.id, name: dish.name, price: dish.price, glass: null, garnish: null, method: null, description: dish.description },
      };
    }
    const r = await apiClient.get<CocktailRecipe>(ownerPath(restaurantId, owner));
    return r.data;
  },

  async versions(restaurantId: string, owner: string | RecipeOwner): Promise<RecipeVersionSummary[]> {
    const r = await apiClient.get<RecipeVersionSummary[]>(`${ownerPath(restaurantId, owner)}/versions`);
    return r.data;
  },

  async version(restaurantId: string, owner: string | RecipeOwner, versionId: string): Promise<PastRecipeVersion> {
    const r = await apiClient.get<PastRecipeVersion>(`${ownerPath(restaurantId, owner)}/versions/${encodeURIComponent(versionId)}`);
    return r.data;
  },

  async save(restaurantId: string, owner: string | RecipeOwner, body: SaveRecipeBody): Promise<SaveRecipeResult> {
    const r = await apiClient.put<SaveRecipeResult>(ownerPath(restaurantId, owner), body);
    return r.data;
  },

  /** Prices an unsaved draft at today's prices. The server prices it; nothing is written. */
  async previewCost(restaurantId: string, owner: string | RecipeOwner, body: PreviewCostBody): Promise<CostPreview> {
    const r = await apiClient.post<CostPreview>(`${ownerPath(restaurantId, owner)}/cost-preview`, body);
    return r.data;
  },

  /** Proposes a shelf item for each pasted label; writes nothing. */
  async matchShelf(restaurantId: string, labels: string[]): Promise<ShelfMatch[]> {
    const r = await apiClient.post<ShelfMatch[]>(`${base(restaurantId)}/shelf/match`, { labels });
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
