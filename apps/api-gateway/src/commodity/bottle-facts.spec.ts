/**
 * The per-bottle duty, end to end: the three refusals and the one print.
 *
 * The founder's batch-57 requirement, verbatim: *"duty.ts prints the per-bottle
 * duty line ONLY where abv_percent and a STATED bottle size (not the 750
 * default, which duty.ts already refuses by name) both exist, saying why
 * otherwise"*. These tests are that sentence, one case at a time, through the
 * real resolver against a mocked schema.
 */

import { DatabaseService } from "../database/database.service";
import { BottleFactsService } from "./bottle-facts";
import { perBottleDuty } from "./duty";
import { SERIES } from "./commodity.registry";

const HOUSE = "r1";
const ITEM = "i1";
const WINE = "w1";

const HMRC = SERIES["hmrc.alcohol_duty.spirits_and_wine_8_5_to_22"];
const IL = SERIES["il_dor.liquor_gallonage_tax.above_20_abv"];
const GIB = SERIES["gib.otv_iii_a.asgari_maktu"];

function rateOf(entry: typeof HMRC, value: number) {
  return {
    valueKind: entry.valueKind,
    value,
    currency: entry.currency,
    denominator: entry.dutyDenominator ?? ("unstated" as const),
    issuer: entry.issuer,
    effectiveFrom: entry.effectiveFrom ?? null,
    unit: entry.unit,
  };
}

/**
 * A schema mock holding one house item, one library row and any number of
 * identities. `abv` null is the state of every bottle until somebody types one.
 */
function makeDb(opts: {
  abv?: number | null;
  identities?: Array<{ size_ml: number | null; asserted_for_restaurant_id: string | null }>;
  masterWineId?: string | null;
  errorOn?: string;
}): DatabaseService {
  const client = {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return builder;
        },
        maybeSingle() {
          if (opts.errorOn === table) {
            return Promise.resolve({ data: null, error: { message: "permission denied" } });
          }
          if (table === "restaurant_inventory") {
            return Promise.resolve({
              data: {
                id: ITEM,
                restaurant_id: HOUSE,
                master_wine_id:
                  opts.masterWineId === undefined ? WINE : opts.masterWineId,
              },
              error: null,
            });
          }
          if (table === "master_wine_library") {
            return Promise.resolve({
              data: { id: WINE, abv_percent: opts.abv ?? null },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          if (opts.errorOn === table) {
            return Promise.resolve({
              data: null,
              error: { message: "relation does not exist" },
            }).then(resolve);
          }
          return Promise.resolve({
            data: (opts.identities ?? []).map((i, n) => ({
              id: `id${n}`,
              master_wine_id: WINE,
              ...i,
            })),
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client } as unknown as DatabaseService;
}

describe("THE ONE PRINT: both facts stated, so a figure appears", () => {
  it("prints an HMRC duty from a stated strength and a stated size", async () => {
    // A person typed 40% onto the shared library row, and the bottle's identity
    // states 750 ml. GBP 30.62/l of pure alcohol x 0.3 l = GBP 9.19.
    const svc = new BottleFactsService(
      makeDb({
        abv: 40,
        identities: [{ size_ml: 750, asserted_for_restaurant_id: null }],
      }),
    );
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.refusal).toBeNull();
    expect(resolved.facts).toEqual({
      sizeMl: 750,
      sizeSource: "typed_by_a_person",
      abvPercent: 40,
      abvSource: "typed_by_a_person",
    });

    const out = perBottleDuty(rateOf(HMRC, 30.62), resolved.facts);
    expect(out.derived).toBe(true);
    if (!out.derived) return;
    expect(out.amount).toBe(9.19);
    expect(out.currency).toBe("GBP");
    expect(out.basis).toMatch(/in force from 2026-02-01/);
    expect(out.basis).toMatch(/Duty only; no VAT, no margin, no price/);
  });

  it("prints an Illinois duty from a stated size alone, and prefers THIS HOUSE'S bottle", async () => {
    // The house states a magnum; the platform-wide row says 750. The house's
    // own trade item is the one it actually buys, so 1500 ml wins:
    // USD 8.55/gal / 3.785411784 x 1.5 l = USD 3.39.
    const svc = new BottleFactsService(
      makeDb({
        abv: null,
        identities: [
          { size_ml: 750, asserted_for_restaurant_id: null },
          { size_ml: 1500, asserted_for_restaurant_id: HOUSE },
        ],
      }),
    );
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.facts.sizeMl).toBe(1500);
    const out = perBottleDuty(rateOf(IL, 8.55), resolved.facts);
    expect(out.derived).toBe(true);
    if (out.derived) expect(out.amount).toBe(3.39);
  });

  it("prints a duty of ZERO for a stated 0.0%, which is not the same as unstated", async () => {
    // HMRC's own 0-1.2% band is GBP 0.00, and a de-alcoholised wine is a real
    // product. Collapsing a stated zero into "nobody said" would refuse a
    // correct answer.
    const svc = new BottleFactsService(
      makeDb({ abv: 0, identities: [{ size_ml: 750, asserted_for_restaurant_id: null }] }),
    );
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.facts.abvPercent).toBe(0);
    expect(resolved.facts.abvSource).toBe("typed_by_a_person");
    const out = perBottleDuty(rateOf(HMRC, 0), resolved.facts);
    expect(out.derived).toBe(true);
    if (out.derived) expect(out.amount).toBe(0);
  });
});

describe("REFUSAL 1: no ABV stated", () => {
  it("refuses and names the column a person has to fill", async () => {
    const svc = new BottleFactsService(
      makeDb({ abv: null, identities: [{ size_ml: 750, asserted_for_restaurant_id: null }] }),
    );
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.refusal).toBeNull(); // the RESOLUTION worked; the fact is absent
    expect(resolved.facts.abvPercent).toBeNull();

    const out = perBottleDuty(rateOf(HMRC, 30.62), resolved.facts);
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("no_strength");
    expect(out.detail).toMatch(/nobody has stated one/);
    expect(out.detail).toMatch(/master_wine_library\.abv_percent/);
    expect(out.detail).toMatch(/never inferred from a category/);
  });
});

describe("REFUSAL 2: the size is the library's 750 default", () => {
  it("never reads the library column, so an unstated size stays unstated", async () => {
    // `master_wine_library.bottle_size_ml` is `DEFAULT 750 NOT NULL`, so every
    // row has one and most are the default. The resolver does not read it: no
    // identity states a size, so the size is null and the duty is refused.
    const svc = new BottleFactsService(makeDb({ abv: 40, identities: [] }));
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.facts.sizeMl).toBeNull();
    expect(resolved.facts.sizeSource).toBeNull();

    const out = perBottleDuty(rateOf(IL, 8.55), resolved.facts);
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("no_size");
  });

  it("refuses BY NAME when a caller hands it the default anyway", async () => {
    // The other half of the guarantee: even if some future caller reads the
    // library column, `duty.ts` refuses a `column_default` source outright.
    const out = perBottleDuty(rateOf(IL, 8.55), {
      sizeMl: 750,
      sizeSource: "column_default",
      abvPercent: 40,
      abvSource: "typed_by_a_person",
    });
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("size_is_a_default");
    expect(out.detail).toMatch(/bottle_size_ml DEFAULT 750/);
  });

  it("refuses TWO stated sizes rather than picking one", async () => {
    // Picking the first would compute a magnum's tax for a 750 -- off by a
    // factor of two, and entirely ordinary-looking on a screen.
    const svc = new BottleFactsService(
      makeDb({
        abv: 40,
        identities: [
          { size_ml: 750, asserted_for_restaurant_id: null },
          { size_ml: 1500, asserted_for_restaurant_id: null },
        ],
      }),
    );
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.refusal).toBe("size_ambiguous");
    expect(resolved.detail).toMatch(/registered in more than one size/);
    expect(resolved.facts.sizeMl).toBeNull();
  });
});

describe("REFUSAL 3: GİB's basis is unstated by the issuer", () => {
  it("refuses even when BOTH bottle facts are stated, because the rate has no denominator", async () => {
    // The one refusal no amount of typing fixes. price-sources.md:269: the
    // schedule states an exact TL figure and does NOT state what it is per.
    const svc = new BottleFactsService(
      makeDb({ abv: 45, identities: [{ size_ml: 700, asserted_for_restaurant_id: null }] }),
    );
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.facts.abvPercent).toBe(45);
    expect(resolved.facts.sizeMl).toBe(700);

    const out = perBottleDuty(rateOf(GIB, 1919.1384), resolved.facts);
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("denominator_unstated");
    expect(out.detail).toMatch(/does not state what this figure is per/);
  });
});

describe("an unreadable read is UNKNOWN, never unstated", () => {
  it("says so for the item", async () => {
    const svc = new BottleFactsService(makeDb({ errorOn: "restaurant_inventory" }));
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.refusal).toBe("item_unreadable");
    expect(resolved.detail).toMatch(/unknown, not unstated/);
  });

  it("says so for the library row", async () => {
    const svc = new BottleFactsService(makeDb({ errorOn: "master_wine_library" }));
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.refusal).toBe("item_unreadable");
    expect(resolved.detail).toMatch(/unknown rather than unstated/);
  });

  it("says so when the item names no library row at all", async () => {
    const svc = new BottleFactsService(makeDb({ masterWineId: null }));
    const resolved = await svc.forHouseItem(HOUSE, ITEM);
    expect(resolved.refusal).toBe("no_library_row");
    expect(resolved.detail).toMatch(/no shared bottle to carry a strength/);
  });
});

describe("the house alias never carries a strength", () => {
  it("reads ABV only from the shared library row", async () => {
    // Strength is a property of the liquid: one house cannot hold a different
    // strength of the same wine from another house. The migration asserts on
    // every replay that `beverage_identities` has no abv column; this asserts
    // that the resolver would not read one if it appeared.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "bottle-facts.ts"),
      "utf8",
    ) as string;
    const identityRead = src.slice(src.indexOf('from("beverage_identities")'));
    expect(identityRead.slice(0, 400)).not.toMatch(/abv/i);
    expect(src).toMatch(/from\("master_wine_library"\)[\s\S]{0,120}abv_percent/);
  });

  it("never reads the library's defaulted size column", async () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "bottle-facts.ts"),
      "utf8",
    ) as string;
    const selects = src.match(/\.select\("[^"]+"\)/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.join(" ")).not.toMatch(/bottle_size_ml/);
  });
});
