import { HttpException, HttpStatus } from "@nestjs/common";
import { BeveragesController } from "./beverages.controller";
import { BeveragesService } from "./beverages.service";

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
});
