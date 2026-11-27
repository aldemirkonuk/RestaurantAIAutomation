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

export type RecipeLineRole = 'stocked' | 'untracked' | 'made';
export type RecipeLineStatus = 'linked' | 'not_linked' | 'untracked';

export interface RecipeLine {
  id: string;
  position: number;
  role: RecipeLineRole;
  inventoryId: string | null;
  /** A made line: the house-made component it draws, and its name (money roles only). */
  componentId?: string | null;
  componentName?: string | null;
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
  /** The share of what is bought that the amount is, 1 to 100 (lime 45: 45 ml juice is 100 ml bought); null is all of it. Absent from an older gateway. */
  usablePct?: number | null;
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
  /**
   * Beside costBasis "unit_mismatch": the weight the house can state for the
   * linked good so the line is priced (r28 gap 7). Absent from an older gateway.
   */
  needs?: WeightNeeded | null;
  /**
   * The stated weight this line's price went through, when it went through
   * one (2 eggs against eggs kept by the kg). Absent from an older gateway.
   */
  weighed?: WeighedBy | null;
  /**
   * Beside costBasis "last_known_lot_cost" (nothing on hand is priced, so the
   * line is priced at what its good was last bought at): when that lot came
   * in. Absent from an older gateway.
   */
  boughtAt?: string | null;
  /** What one piece of the linked good weighs, in g, as the house stated it. */
  itemPieceGrams?: number | null;
  /** What one ml of the linked good weighs, in g, as the house stated it. */
  itemMlGrams?: number | null;
}

/** piece_grams: what one piece weighs; ml_grams: what one ml weighs. */
export type WeightNeeded = 'piece_grams' | 'ml_grams';

/** A stated weight a line was priced through: which one, and its grams. */
export interface WeighedBy {
  by: WeightNeeded;
  grams: number;
}

/** PUT .../items/:itemId/weights: a field left out is kept, null takes it off. */
export interface StateWeightsBody {
  pieceGrams?: number | null;
  mlGrams?: number | null;
}

export interface StatedWeights {
  id: string;
  pieceGrams: number | null;
  mlGrams: number | null;
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
  /** Priced lines whose good has nothing priced on hand, at what it last cost. */
  lastBought?: number;
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
  /** A dish: what one batch makes (ADR 0397); null until the house says. Absent on a drink. */
  yield?: DishYield | null;
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
  /** A made line carries the component it draws back on save; the gateway refuses one that names nothing. */
  componentId?: string | null;
  label: string;
  qty: number;
  unit: string;
  /** A stocked line's usable share, 1 to 100; null is all of it. The gateway saves a missing one as null. */
  usablePct?: number | null;
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
  /** As on a saved line, so the draft is priced as it will be saved. */
  usablePct?: number | null;
}

export interface PreviewCostBody {
  yieldServes: number;
  lines: PreviewCostLine[];
}

/** What a draft would cost at today's prices: the saved cost's shape, plus each line in the order sent. */
export interface CostPreview extends RecipeCost {
  lines: Array<{ status: RecipeLineStatus; costPerServe: number | null; costBasis: string | null; needs?: WeightNeeded | null }>;
}

export interface SaveRecipeResult {
  versionId: string;
  version: number;
  lines: unknown[];
}

/** POST /inventory/:rid/house-items, as house-item.service.ts takes it. */
export interface AddToShelfBody {
  kind: string;
  uom: string;
  displayName: string;
}

export interface AddedToShelf {
  id: string;
  kind: string;
  uom: string;
  displayName: string;
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

/** What one batch makes, as stored: 700 ml is 7000 of ml10. */
export interface DishYield {
  qtyBase: number;
  baseUnit: 'ml10' | 'mg' | 'each_milli' | string;
}

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

  /**
   * Adds a good to the house's shelf from a recipe line that found none (r28
   * gap 8): the inventory's own "carry this" route (POST /inventory/:rid/
   * house-items, owner or manager), so there is one writer of a house good.
   * Stock is never entered here: it arrives with a delivery.
   */
  async addToShelf(restaurantId: string, body: AddToShelfBody): Promise<AddedToShelf> {
    const r = await apiClient.post<AddedToShelf>(`/inventory/${encodeURIComponent(restaurantId)}/house-items`, body);
    return r.data;
  },

  /** States what one piece and one ml of a good weigh (owner or manager); the gateway bounds both. */
  async stateWeights(restaurantId: string, itemId: string, body: StateWeightsBody): Promise<StatedWeights> {
    const r = await apiClient.put<StatedWeights>(`${base(restaurantId)}/items/${encodeURIComponent(itemId)}/weights`, body);
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

export type AllergenStatus = 'contains' | 'may_contain' | 'free' | 'not_stated';

/**
 * What a list row says of its recipe's allergens (dishes.service.ts
 * RowAllergens; r36 recipes audit, gap 8). Every role reads it: allergens are
 * not money. `readable: false` is a failed read, never allergen-free.
 */
export type RowAllergens =
  | { readable: true; status: Record<string, AllergenStatus>; unstatedBy: string[] }
  | { readable: false };

/** A list row's cost a serve (or plate); null for staff, or when it could not be read. */
export type ListCost = null | {
  perServe: number | null;
  perServeExact: number | null;
  priced: number;
  of: number;
  complete: boolean;
  partial: number;
};

/**
 * One row of GET /dishes: the dish by name, nothing priced, so the list shows
 * after one read (r41 recipes audit, gap 2). Price is null for staff.
 */
export interface DishListRow {
  id: string;
  name: string;
  section: string | null;
  price: number | null;
}

/** A dish on the house's list with its figures (GET /recipes/:rid/dishes/figures). */
export interface DishFigureRow {
  dishId: string;
  /** Null for a role that does not see the house's money. */
  price: number | null;
  hasRecipe: boolean;
  yieldServes: number | null;
  lineCount: number;
  cost: ListCost;
  /** Null when the dish has no recipe. */
  allergens?: RowAllergens | null;
}

/** GET /recipes/:rid/drinks/figures. `costsUnread`: the pricing read failed, every cost is null. */
export interface DrinkFiguresAnswer {
  costsUnread: boolean;
  drinks: DrinkFigureRow[];
}

/** GET /recipes/:rid/dishes/figures. `costsUnread`: the pricing read failed, every cost is null. */
export interface DishFiguresAnswer {
  costsUnread: boolean;
  dishes: DishFigureRow[];
}

/** A drink on the house's list with its figures (GET /recipes/:rid/drinks/figures). */
export interface DrinkFigureRow {
  cocktailId: string;
  /** Null for a role that does not see the house's money. */
  price: number | null;
  hasRecipe: boolean;
  yieldServes: number | null;
  lineCount: number;
  cost: ListCost;
  /** Null when the drink has no recipe; absent from an older gateway. */
  allergens?: RowAllergens | null;
}

/**
 * What the house's current menu says for one dish or drink of the same name
 * (GET /recipes/:rid/menu-prices; r28 recipes audit, gap 2). `prices` are the
 * line's distinct prices, lowest first; `agrees` is null when either side has
 * no price.
 */
export type MenuPrice =
  | { found: 'one'; prices: number[]; agrees: boolean | null }
  | { found: 'none' }
  | { found: 'several'; lines: number };

export interface MenuPricesAnswer {
  /** True for a role that does not see the house's money: nothing was read. */
  amountsWithheld: boolean;
  /** How many menus are current; 0 is "no current menu". Null when withheld. */
  currentMenus: number | null;
  dishes: Array<{ dishId: string; menu: MenuPrice }>;
  drinks: Array<{ cocktailId: string; menu: MenuPrice }>;
}

/**
 * A dish the current menu holds that is not on the list yet
 * (GET /recipes/:rid/dishes/from-menu; r28 onboarding audit, gap 1, slice 3).
 * `price` is null when the menu gives none, or gives two (`pricesDiffer`).
 */
export interface MenuDishOffer {
  name: string;
  section: string | null;
  price: number | null;
  pricesDiffer: boolean;
}

/** What POST /recipes/:rid/dishes/from-menu did with the names it was sent. */
export interface MenuDishesAdded {
  added: Array<{ id: string; name: string }>;
  /** Already on the list when written (another tab, a double click). */
  already: string[];
  /** Not written: the run stopped at a failed write. */
  notAdded: string[];
  /** No longer offered: listed since, or gone from the menu. */
  notOffered: string[];
}

export interface DishBody {
  name: string;
  section?: string;
  price?: number;
  description?: string;
}

/** A change to a dish: only the fields sent change; a null section or price clears it. */
export interface DishChange {
  name?: string;
  section?: string | null;
  price?: number | null;
}

export interface Dish {
  id: string;
  name: string;
  section: string | null;
  price: number | null;
  description: string | null;
}



/** What taking the menu's prices onto many dishes did, dish by dish (POST dishes/take-menu-prices). */
export interface TakeMenuPricesAnswer {
  changed: Array<{ id: string; name: string; from: number | null; to: number }>;
  /** Every dish left as it was, with the gateway's reason in words. */
  skipped: Array<{ id: string; name: string; why: string }>;
}

/** What taking the dishes the menu does not print off the list did (POST dishes/take-off-menu). */
export interface TakeOffMenuAnswer {
  removed: Array<{ id: string; name: string }>;
  /** Every dish left on the list, with the gateway's reason in words. */
  skipped: Array<{ id: string; name: string; why: string }>;
}

export const dishesApi = {
  async list(restaurantId: string): Promise<DishListRow[]> {
    const r = await apiClient.get<DishListRow[]>(`${base(restaurantId)}/dishes`);
    return r.data;
  },

  /** Every dish's cost a plate and allergens, read beside the names (r41 recipes audit, gaps 2 and 3). */
  async dishFigures(restaurantId: string): Promise<DishFiguresAnswer> {
    const r = await apiClient.get<DishFiguresAnswer>(`${base(restaurantId)}/dishes/figures`);
    // An answer without its rows is unread, never a list of dishes with no figures.
    if (!Array.isArray(r.data?.dishes)) throw new Error('The dishes’ figures came back without their rows.');
    return { costsUnread: r.data.costsUnread === true, dishes: r.data.dishes };
  },

  /** Every drink on the list with its cost a serve, in one read (r28 recipes audit, gap 9). */
  async drinkFigures(restaurantId: string): Promise<DrinkFiguresAnswer> {
    const r = await apiClient.get<{ costsUnread?: boolean; drinks: DrinkFigureRow[] }>(`${base(restaurantId)}/drinks/figures`);
    // An older gateway sends no flag: its costs were read, or the whole read failed.
    return { costsUnread: r.data.costsUnread === true, drinks: r.data.drinks };
  },

  /** The current menu's price beside each dish and drink, in one read (r28 recipes audit, gap 2). */
  async menuPrices(restaurantId: string): Promise<MenuPricesAnswer> {
    const r = await apiClient.get<MenuPricesAnswer>(`${base(restaurantId)}/menu-prices`);
    return r.data;
  },

  /** The current menu's dishes not on the list yet; owner and manager only (gap 1 slice 3). */
  async menuDishes(restaurantId: string): Promise<{ currentMenus: number; dishes: MenuDishOffer[] }> {
    const r = await apiClient.get<{ currentMenus: number; dishes: MenuDishOffer[] }>(`${base(restaurantId)}/dishes/from-menu`);
    return r.data;
  },

  /** Puts the named menu dishes on the list, with the menu's section and price. */
  async addMenuDishes(restaurantId: string, names: string[]): Promise<MenuDishesAdded> {
    const r = await apiClient.post<MenuDishesAdded>(`${base(restaurantId)}/dishes/from-menu`, { names });
    return r.data;
  },

  /**
   * The current menu's cocktails not on the cocktail list yet, by name or
   * shown name; owner and manager only (r36 recipes audit, gap 3). Same
   * shape as the dish offer; `dishes` is named `drinks` here.
   */
  async menuDrinks(restaurantId: string): Promise<{ currentMenus: number; drinks: MenuDishOffer[] }> {
    const r = await apiClient.get<{ currentMenus: number; drinks: MenuDishOffer[] }>(`${base(restaurantId)}/drinks/from-menu`);
    return r.data;
  },

  /** Puts the named menu cocktails on the list in one write; none is added when it fails. */
  async addMenuDrinks(restaurantId: string, names: string[]): Promise<MenuDishesAdded> {
    const r = await apiClient.post<MenuDishesAdded>(`${base(restaurantId)}/drinks/from-menu`, { names });
    return r.data;
  },

  async create(restaurantId: string, body: DishBody): Promise<Dish> {
    const r = await apiClient.post<Dish>(`${base(restaurantId)}/dishes`, body);
    return r.data;
  },

  async update(restaurantId: string, dishId: string, body: DishChange): Promise<Dish> {
    const r = await apiClient.patch<Dish>(`${base(restaurantId)}/dishes/${encodeURIComponent(dishId)}`, body);
    return r.data;
  },

  /** Sets each named dish to the one price the current menu gives it; owner and manager only. */
  async takeMenuPrices(restaurantId: string, ids: string[]): Promise<TakeMenuPricesAnswer> {
    const r = await apiClient.post<TakeMenuPricesAnswer>(`${base(restaurantId)}/dishes/take-menu-prices`, { ids });
    // An answer without its lists is not a result: the page must not say "done" for it.
    if (!Array.isArray(r.data?.changed) || !Array.isArray(r.data?.skipped)) throw new Error('The answer came back without saying which dishes changed.');
    return r.data;
  },

  /** Takes off the named dishes the current menu prints no line of; owner and manager only. */
  async takeOffMenu(restaurantId: string, ids: string[]): Promise<TakeOffMenuAnswer> {
    const r = await apiClient.post<TakeOffMenuAnswer>(`${base(restaurantId)}/dishes/take-off-menu`, { ids });
    // An answer without its lists is not a result: the page must not say "done" for it.
    if (!Array.isArray(r.data?.removed) || !Array.isArray(r.data?.skipped)) throw new Error('The answer came back without saying which dishes came off.');
    return r.data;
  },

  /** Takes the dish off the list (a soft delete); its recipe versions are kept. */
  /** Says what one batch of a house-made component makes; owner and manager only. Every recipe that draws it is priced again. */
  async setYield(restaurantId: string, dishId: string, body: { amount: number; unit: string }): Promise<{ id: string; name: string; yield: { amount: number; unit: string; qtyBase: number; baseUnit: string } }> {
    const r = await apiClient.patch<{ id: string; name: string; yield: { amount: number; unit: string; qtyBase: number; baseUnit: string } }>(`${base(restaurantId)}/dishes/${encodeURIComponent(dishId)}/yield`, body);
    return r.data;
  },

  /** Takes the dish off the list (a soft delete); its recipe versions are kept. */
  async remove(restaurantId: string, dishId: string): Promise<{ id: string; name: string; removed: true }> {
    const r = await apiClient.delete<{ id: string; name: string; removed: true }>(`${base(restaurantId)}/dishes/${encodeURIComponent(dishId)}`);
    return r.data;
  },
};
