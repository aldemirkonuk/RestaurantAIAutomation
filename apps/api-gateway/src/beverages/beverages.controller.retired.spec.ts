import { HttpException, HttpStatus } from "@nestjs/common";
import { BeveragesController } from "./beverages.controller";
import { BeveragesService } from "./beverages.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";

describe("the old recipe box writer is retired", () => {
  it("answers 410 with a sentence and writes nothing", () => {
    const beverages = {} as BeveragesService;
    const controller = new BeveragesController(beverages);
    let thrown: unknown;
    try {
      controller.setIngredients();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.GONE);
    expect((thrown as HttpException).message).toMatch(/nothing was written/);
    // It names the sheet and the versioned route that replaces it (DD-r102-27).
    expect((thrown as HttpException).message).toMatch(/recipe sheet.*PUT \/recipes\/\{restaurantId\}\/cocktails\/\{cocktailId\}/);
  });

  it("leaves the service with no delete-then-insert writer for cocktail_ingredients", () => {
    expect((BeveragesService.prototype as unknown as Record<string, unknown>).setCocktailIngredients).toBeUndefined();
  });

  it("the old recipe read says it is not writable", async () => {
    const db = new FakeDb();
    db.tables.cocktails = [{ id: "c1", restaurant_id: "h1", deleted_at: null }];
    db.tables.cocktail_ingredients = [{ id: "i1", cocktail_id: "c1", quantity: 1, sort_order: 0 }];
    const svc = new BeveragesService({ getClient: () => db } as any);
    const out = await svc.readCocktailIngredients("h1", "c1");
    expect(out.count).toBe(1);
    expect(out.writable).toBe(false);
  });
});
