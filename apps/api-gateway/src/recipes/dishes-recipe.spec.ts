import "reflect-metadata";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DishesController } from "./dishes.controller";
import { DISH_NOT_THIS_HOUSE, RecipesService } from "./recipes.service";
import { B_DISH, GONE, HOUSE_A, HOUSE_B, SOUP, TART, V_TART_1, V_TART_2, fakeDb, twoHouses } from "./dishes.testing";

/**
 * A dish's recipe on the recipe engine (ADR 0366).
 *
 * part 1  the real JwtAuthGuard over every route DishesController declares
 *         (read from Nest's metadata): house B in the path is a 403; writes
 *         are owner/manager.
 * part 2  the real RecipesService over two houses' rows (dishes.testing.ts).
 */

/** Every route the controller declares, and which of them write. */
const DECLARED = [
  "createDish", "dishesUsingItem", "drinkFigures", "drinksUsingItem", "getDishRecipe", "listDishes", "listDishVersions",
  "matchShelf", "previewDishCost", "readDishVersion", "saveDishRecipe", "updateDish",
];
const WRITES = ["createDish", "matchShelf", "previewDishCost", "saveDishRecipe", "updateDish"];

type Route = { handler: string; method: number; path: string };
const proto = DishesController.prototype as unknown as Record<string, object>;
const routes: Route[] = Object.getOwnPropertyNames(proto)
  .filter((n) => n !== "constructor" && Reflect.hasMetadata(PATH_METADATA, proto[n]))
  .map((n) => ({ handler: n, method: Reflect.getMetadata(METHOD_METADATA, proto[n]), path: Reflect.getMetadata(PATH_METADATA, proto[n]) }));

function contextFor(route: Route, pathHouse: string) {
  const params: Record<string, string> = {};
  for (const seg of route.path.split("/")) if (seg.startsWith(":")) params[seg.slice(1)] = seg === ":restaurantId" ? pathHouse : TART;
  const request = { headers: {}, params, query: {}, body: {}, user: { userId: "u-a", restaurantId: HOUSE_A, role: "owner", emailVerified: true } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => proto[route.handler],
    getClass: () => DishesController,
  } as never;
}

function realGuard() {
  const guard = new JwtAuthGuard(new Reflector(), { isBlacklisted: jest.fn().mockResolvedValue(false) } as never);
  jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), "canActivate").mockResolvedValue(true as never);
  return guard;
}

describe("dishes: the path's house is the caller's (real guard, every route)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("declares exactly the dish routes this file covers, all under :restaurantId", () => {
    expect(routes.map((r) => r.handler).sort()).toEqual([...DECLARED].sort());
    for (const r of routes) expect(r.path.split("/")[0]).toBe(":restaurantId");
  });

  it.each(routes.map((r) => [r.handler, r] as const))("%s refuses house B in the path with 403", async (_n, route) => {
    await expect(realGuard().canActivate(contextFor(route, HOUSE_B))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("every write is owner or manager; every read is not role-gated", () => {
    for (const r of routes) {
      const roles = Reflect.getMetadata(ROLES_KEY, proto[r.handler]) ?? null;
      expect([r.handler, roles]).toEqual([r.handler, WRITES.includes(r.handler) ? ["owner", "manager"] : null]);
    }
  });
});

function recipes(rows = twoHouses(), opts: Parameters<typeof fakeDb>[1] = {}) {
  const fake = fakeDb(rows, opts);
  return { recipes: new RecipesService(fake.db), ...fake };
}

describe("dishes: the recipe of a dish", () => {
  it("reads a dish's current recipe under `dish`, with its versions and no legacy lines", async () => {
    const { recipes: svc } = recipes();
    const out = await svc.getDishRecipe(HOUSE_A, TART, "owner");
    expect(out.dish).toMatchObject({ id: TART, name: "Lemon tart", section: "Desserts", price: 9 });
    expect((out.current as any).versionId).toBe(V_TART_2);
    expect(out.versionCount).toBe(2);
    expect(out.legacyLines).toEqual([]);
  });

  it("staff read the dish without its price", async () => {
    const { recipes: svc } = recipes();
    const out = await svc.getDishRecipe(HOUSE_A, TART, "staff");
    expect(out.dish.price).toBeNull();
    expect(out.cost).toBeNull();
  });

  it("another house's dish and a deleted dish are 404", async () => {
    const { recipes: svc } = recipes();
    await expect(svc.getDishRecipe(HOUSE_A, B_DISH, "owner")).rejects.toThrow(DISH_NOT_THIS_HOUSE);
    await expect(svc.getDishRecipe(HOUSE_A, GONE, "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an earlier version of another dish is not this dish's", async () => {
    const { recipes: svc } = recipes();
    await expect(svc.readDishVersion(HOUSE_A, SOUP, V_TART_1, "owner")).rejects.toBeInstanceOf(NotFoundException);
    const v = await svc.readDishVersion(HOUSE_A, TART, V_TART_1, "owner");
    expect((v.version as any).lines[0].label).toBe("Old flour line");
  });

  it("lists only this dish's versions, newest first", async () => {
    const { recipes: svc } = recipes();
    const out = await svc.listDishVersions(HOUSE_A, TART);
    expect(out.map((v) => v.version)).toEqual([2, 1]);
  });

  it("saves through save_dish_recipe_version with the dish and no glass; a stale save is a 409", async () => {
    const { recipes: svc, rpcCalls } = recipes(twoHouses(), {
      rpc: (name) => (name === "save_dish_recipe_version" ? { data: { version_id: "v3", version: 3, lines: [] } } : {}),
    });
    const dto = { expectedVersionId: V_TART_2, yieldServes: 8, glass: "Coupe", garnish: "Mint", lines: [{ role: "untracked" as const, label: " Salt ", qty: 1, unit: "g" }] };
    await expect(svc.saveDishRecipe(HOUSE_A, TART, "u-a", dto)).resolves.toMatchObject({ versionId: "v3", version: 3 });
    expect(rpcCalls[0].name).toBe("save_dish_recipe_version");
    expect(rpcCalls[0].args).toMatchObject({ p_restaurant: HOUSE_A, p_dish: TART, p_expected_version: V_TART_2, p_garnish: "Mint" });
    expect(rpcCalls[0].args).not.toHaveProperty("p_glass");
    expect(rpcCalls[0].args.p_lines[0].label).toBe("Salt");

    const stale = recipes(twoHouses(), { rpc: () => ({ error: { code: "RCP09", message: "stale" } }) });
    await expect(stale.recipes.saveDishRecipe(HOUSE_A, TART, "u-a", dto)).rejects.toBeInstanceOf(ConflictException);
  });
});
