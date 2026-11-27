/**
 * r105 drinks-6 (walk r104 FAIL 17): the database refuses a made line measured
 * in a different kind of unit than its component ("measured in mg, but the
 * component is made in ml10"). The refusal stands (no ml-vs-g conversion); only
 * the words change: grams, millilitres, pieces, never the stored base-unit token.
 */
import { BadRequestException } from "@nestjs/common";
import { RecipesService, sayBaseUnits } from "./recipes.service";
import { HOUSE_A, TART, fakeDb, twoHouses } from "./dishes.testing";

const refusal = (a: string, b: string) => `Ingredient 2 (House syrup) is measured in ${a}, but the component is made in ${b}.`;
const dto = { expectedVersionId: null, yieldServes: 1, lines: [{ role: "made", componentId: TART, label: "House syrup", qty: 40, unit: "g" }] } as any;

describe("a unit refusal says grams, millilitres and pieces", () => {
  it.each([
    ["mg", "ml10", "grams", "millilitres"],
    ["ml10", "mg", "millilitres", "grams"],
    ["each_milli", "ml10", "pieces", "millilitres"],
    ["mg", "each_milli", "grams", "pieces"],
  ])("%s against %s reads %s against %s", async (a, b, wa, wb) => {
    const svc = new RecipesService(fakeDb(twoHouses(), { rpc: () => ({ error: { code: "RCP00", message: refusal(a, b) } }) }).db);
    for (const save of [() => svc.saveRecipe(HOUSE_A, "c", "u", dto), () => svc.saveDishRecipe(HOUSE_A, TART, "u", dto)]) {
      const err = await save().then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(refusal(wa, wb));
      expect(err.message).not.toMatch(/\bml10\b|\bmg\b|each_milli/);
    }
  });

  it("is still a refusal: it does not convert, and leaves every other sentence as the database wrote it", () => {
    expect(sayBaseUnits(refusal("mg", "ml10"))).toContain("but the component is made in millilitres.");
    const other = "Ingredient 1 (Mg tonic) has a unit we do not know: shot.";
    expect(sayBaseUnits(other)).toBe(other);
  });
});
