import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Test } from "@nestjs/testing";
import { BeveragesService } from "./beverages.service";
import { DatabaseService } from "../database/database.service";
import { UpdateCocktailDto } from "./dto/beverages.dto";

/**
 * /cocktails amends a drink's price; a cleared box sends `price: null` and the
 * drink becomes unpriced (r28 recipes audit, gap 12). Before, the form dropped
 * the field, so the old price stayed while the page said it was amended.
 */
const RID = "11111111-1111-4111-8111-111111111111";
const COCKTAIL_ID = "22222222-2222-4222-8222-222222222222";

const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateCocktailDto, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe("a drink's price can be taken off", () => {
  it("the amend body accepts price null and still refuses text or a negative price", async () => {
    expect(await errorsFor({ price: null })).toEqual([]);
    expect(await errorsFor({ price: 12.5 })).toEqual([]);
    expect(await errorsFor({ price: "12,50" })).toEqual(["price"]);
    expect(await errorsFor({ price: -1 })).toEqual(["price"]);
  });

  it("an amend with price null writes null, and one without a price leaves it", async () => {
    const patches: Record<string, unknown>[] = [];
    const db = {
      getClient: () => ({
        from: () => {
          const self: Record<string, unknown> = {};
          for (const m of ["select", "eq", "is"]) self[m] = jest.fn(() => self);
          self.update = jest.fn((p: Record<string, unknown>) => {
            patches.push(p);
            return self;
          });
          self.maybeSingle = jest.fn(() => Promise.resolve({ data: { id: COCKTAIL_ID }, error: null }));
          return self;
        },
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [BeveragesService, { provide: DatabaseService, useValue: db }],
    }).compile();
    const svc = moduleRef.get(BeveragesService);
    await svc.updateCocktail(RID, COCKTAIL_ID, plainToInstance(UpdateCocktailDto, { price: null }));
    await svc.updateCocktail(RID, COCKTAIL_ID, plainToInstance(UpdateCocktailDto, { name: "Negroni" }));
    expect(patches[0]).toHaveProperty("price", null);
    expect(patches[1]).not.toHaveProperty("price");
  });
});
