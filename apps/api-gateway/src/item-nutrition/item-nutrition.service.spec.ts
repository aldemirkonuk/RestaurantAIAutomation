import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ItemNutritionService } from "./item-nutrition.service";
import { ItemNutritionController } from "./item-nutrition.controller";
import { DatabaseService } from "../database/database.service";

/**
 * What a good is made of (migration 20270512091500_a_good_says_what_is_in_it).
 * Pinned here:
 *  - tenant scope: every read filters by the caller's restaurant_id, and the
 *    write names the house to save_item_nutrition();
 *  - an unknown figure is null on the way in and on the way out, never 0;
 *  - a failed read is a 503 sentence, never an empty card.
 */

type Answer = { data: unknown; error: { message: string; code?: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });
const failed: Answer = { data: null, error: { message: "connection reset" } };

function makeService(opts: {
  item?: Answer;
  nutrition?: Answer;
  allergens?: Answer;
  rpc?: Answer;
  filters?: Record<string, Array<[string, unknown]>>;
  rpcCalls?: Array<{ fn: string; args: Record<string, unknown> }>;
}) {
  const answers: Record<string, Answer> = {
    restaurant_inventory: opts.item ?? ok({ id: "inv-1", kind: "food", uom: "g", display_name: "Tulum cheese" }),
    item_nutrition: opts.nutrition ?? ok(null),
    item_allergens: opts.allergens ?? ok([]),
  };
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    if (opts.filters) opts.filters[table] = filters;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      maybeSingle: async () => answers[table],
      then: (resolve: (a: Answer) => unknown) => Promise.resolve(answers[table]).then(resolve),
    };
    return builder;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    opts.rpcCalls?.push({ fn, args });
    return opts.rpc ?? ok(null);
  };
  const db = { supabase: { from, rpc } } as unknown as DatabaseService;
  return new ItemNutritionService(db);
}


describe("ItemNutritionService.read", () => {
  it("reads the item, its figures and its allergens by the caller's house, never by id alone", async () => {
    const filters: Record<string, Array<[string, unknown]>> = {};
    await makeService({ filters }).read("r-1", "inv-1");
    for (const t of ["restaurant_inventory", "item_nutrition", "item_allergens"]) {
      expect(filters[t]).toContainEqual(["restaurant_id", "r-1"]);
    }
    expect(filters.restaurant_inventory).toContainEqual(["id", "inv-1"]);
    expect(filters.item_nutrition).toContainEqual(["inventory_id", "inv-1"]);
  });

  it("refuses an item of another house as not found", async () => {
    await expect(makeService({ item: ok(null) }).read("r-1", "inv-other")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("keeps an unknown figure null, never 0, and lists all 14 allergens with the unstated ones said", async () => {
    const out = await makeService({
      nutrition: ok({
        basis: "100g",
        energy_kcal: "350.0",
        fat_g: "28.00",
        saturates_g: null,
        carbohydrate_g: null,
        sugars_g: null,
        protein_g: "22.00",
        salt_g: null,
        abv_pct: null,
        energy_from_abv: false,
        source: "pack_label",
        source_ref: null,
        stated_by_name: "Ayşe",
        stated_at: "2026-11-07T10:00:00Z",
      }),
      allergens: ok([{ allergen: "milk", status: "contains", stated_by_name: "Ayşe", stated_at: "2026-11-07T10:00:00Z" }]),
    }).read("r-1", "inv-1");
    expect(out.figures?.energyKcal).toBe(350);
    expect(out.figures?.saltG).toBeNull();
    expect(out.figures?.sugarsG).toBeNull();
    expect(out.figures?.basis).toBe("100g");
    expect(out.allergens).toHaveLength(14);
    expect(out.allergens.find((a) => a.allergen === "milk")?.status).toBe("contains");
    expect(out.allergens.find((a) => a.allergen === "gluten")?.status).toBe("not_stated");
    expect(out.suggestedBasis).toBe("100g");
  });

  it("answers nothing stated as figures null, not as a card of zeros", async () => {
    const out = await makeService({}).read("r-1", "inv-1");
    expect(out.figures).toBeNull();
    expect(out.allergens.every((a) => a.status === "not_stated")).toBe(true);
  });

  it.each([
    ["the item", { item: failed }],
    ["the figures", { nutrition: failed }],
    ["the allergens", { allergens: failed }],
  ])("says a failed read of %s failed, never an empty card", async (_what, o) => {
    const err = await makeService(o).read("r-1", "inv-1").catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toContain("could not be read");
    expect(err.message).not.toContain("connection reset");
  });
});

describe("ItemNutritionService.save", () => {
  const save = (svc: ItemNutritionService, dto: unknown) =>
    svc.save("r-1", "inv-1", "u-1", "Ayşe", dto as Parameters<ItemNutritionService["save"]>[4]);

  it("names the house, the person and the item to the write, and sends an unknown as null", async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    await save(makeService({ rpcCalls }), {
      figures: { basis: "100g", energyKcal: 350, fatG: 28, source: "pack_label" },
      allergens: [
        { allergen: "milk", status: "contains" },
        { allergen: "gluten", status: "not_stated" },
      ],
    });
    expect(rpcCalls).toHaveLength(1);
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe("save_item_nutrition");
    expect(args.p_restaurant_id).toBe("r-1");
    expect(args.p_inventory_id).toBe("inv-1");
    expect(args.p_stated_by).toBe("u-1");
    expect(args.p_stated_by_name).toBe("Ayşe");
    const n = args.p_nutrition as Record<string, unknown>;
    expect(n.salt_g).toBeNull();
    expect(n.sugars_g).toBeNull();
    expect(n.energy_kcal).toBe(350);
    expect(args.p_allergens).toEqual([{ allergen: "milk", status: "contains" }]);
  });

  it("refuses another house's item as not found", async () => {
    const svc = makeService({ rpc: { data: null, error: { message: "not an item of house", code: "P0002" } } });
    await expect(save(svc, { figures: null, allergens: [] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses ABV per 100 g with a sentence, before any write", async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const err = await save(makeService({ rpcCalls }), {
      figures: { basis: "100g", abvPct: 40, source: "house" },
      allergens: [],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("per 100 ml");
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses macros over 100 g in 100 g with the sum in words, before any write", async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const err = await save(makeService({ rpcCalls }), {
      figures: { basis: "100g", proteinG: 50, fatG: 40, carbohydrateG: 20, source: "pack_label" },
      allergens: [],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("add up to 110 g");
    expect(err.message).toContain("Nothing was saved.");
    expect(rpcCalls).toHaveLength(0);
  });

  it("saves energy that disagrees with 4/4/9 and says so in the answer", async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const out = await save(makeService({ rpcCalls }), {
      figures: { basis: "100g", energyKcal: 600, proteinG: 10, fatG: 10, carbohydrateG: 50, source: "pack_label" },
      allergens: [],
    });
    expect(rpcCalls).toHaveLength(1);
    expect(out.warnings).toEqual([expect.stringContaining("about 330 kcal")]);
  });

  it("refuses an allergen stated twice", async () => {
    await expect(
      save(makeService({}), {
        figures: null,
        allergens: [
          { allergen: "milk", status: "contains" },
          { allergen: "milk", status: "free" },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("says a failed save failed and that nothing changed", async () => {
    const err = await save(makeService({ rpc: failed }), { figures: null, allergens: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toContain("Nothing was changed");
  });
});

describe("ItemNutritionController", () => {
  it("lets only an owner or manager state what is in an item", async () => {
    const organizations = {
      assertCanManageRestaurant: jest.fn().mockRejectedValue(new ForbiddenException("managers only")),
    };
    const nutrition = { save: jest.fn() };
    const ctl = new ItemNutritionController(nutrition as never, organizations as never, {} as never);
    await expect(
      ctl.save("r-1", "inv-1", { figures: null, allergens: [] } as never, { userId: "u-staff", name: "Can" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith("u-staff", "r-1", expect.any(String));
    expect(nutrition.save).not.toHaveBeenCalled();
    await expect(ctl.save("r-1", "inv-1", { figures: null, allergens: [] } as never, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});
