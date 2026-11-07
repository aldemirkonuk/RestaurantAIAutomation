import { BadGatewayException, BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { FDC_KEY_ENV, NutritionLookupService } from "./nutrition-lookup.service";
import { ItemNutritionController } from "./item-nutrition.controller";
import type { ItemNutritionService } from "./item-nutrition.service";
import type { Basis } from "./nutrition-figures";

/**
 * The lookup fills a DRAFT and saves nothing. Pinned here:
 *  - a figure the source does not give stays null, never 0;
 *  - a source that cannot be reached is a worded 502, never an empty answer;
 *  - no FoodData Central key: skipped, and the answer says so;
 *  - the item is checked as this house's before anything goes outbound.
 * The draft itself (salt from sodium, basis, allergens) is pinned in
 * nutrition-lookup.spec.ts. No spec here goes outbound: fetch is injected.
 */

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const reply = (status: number, body: unknown): Reply => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function setup(opts: { basis?: Basis | null; routes?: Array<[RegExp, Reply | Error]>; readFails?: Error }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const hit = (opts.routes ?? []).find(([re]) => re.test(url));
    if (!hit) throw new Error(`no route for ${url}`);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  const reads: Array<[string, string]> = [];
  const nutrition = {
    read: async (rid: string, id: string) => {
      reads.push([rid, id]);
      if (opts.readFails) throw opts.readFails;
      return { suggestedBasis: opts.basis === undefined ? "100g" : opts.basis };
    },
  } as unknown as ItemNutritionService;
  return { svc: new NutritionLookupService(nutrition, fetchImpl), calls, reads };
}

const OFF_PRODUCT = /openfoodfacts\.org\/api\/v2\/product\//;
const OFF_SEARCH = /openfoodfacts\.org\/cgi\/search\.pl/;
const FDC_FOOD = /api\.nal\.usda\.gov\/fdc\/v1\/food\//;
const FDC_SEARCH = /api\.nal\.usda\.gov\/fdc\/v1\/foods\/search/;

const savedKey = process.env[FDC_KEY_ENV];
afterEach(() => {
  if (savedKey === undefined) delete process.env[FDC_KEY_ENV];
  else process.env[FDC_KEY_ENV] = savedKey;
});
beforeEach(() => {
  delete process.env[FDC_KEY_ENV];
});

describe("lookup by barcode (Open Food Facts)", () => {
  it("drafts per 100 ml for a drink sold by volume, keeps a missing salt null and never states an allergen free", async () => {
    const { svc, calls } = setup({
      basis: "100ml",
      routes: [
        [
          OFF_PRODUCT,
          reply(200, {
            status: 1,
            product: {
              product_name: "Ayran",
              brands: "Sütaş",
              quantity: "1 l",
              product_quantity_unit: "ml",
              nutriments: { "energy-kcal_100g": 38, fat_100g: 1.8, proteins_100g: 1.7, carbohydrates_100g: 2.6 },
              allergens_tags: ["en:milk"],
              traces_tags: ["en:nuts", "en:milk"],
            },
          }),
        ],
      ],
    });
    const out = await svc.lookup("r-1", "inv-1", { barcode: "8690000000001" });
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    const d = out.draft;
    expect(d.basis).toBe("100ml");
    expect(d.figures.energyKcal).toBe(38);
    expect(d.figures.saltG).toBeNull();
    expect(d.figures.sugarsG).toBeNull();
    expect(d.source).toBe("open_food_facts");
    expect(d.sourceRef).toBe("8690000000001");
    expect(d.allergens).toEqual(
      expect.arrayContaining([
        { allergen: "milk", status: "contains" },
        { allergen: "tree_nuts", status: "may_contain" },
      ]),
    );
    expect(d.allergens.every((a) => a.status === "contains" || a.status === "may_contain")).toBe(true);
    expect(d.attribution).toContain("Open Database License");
    expect(calls[0].headers["User-Agent"]).toMatch(/^Mudavym/);
  });

  it("answers an unknown barcode as found nothing, not as a draft of zeros", async () => {
    const { svc } = setup({ routes: [[OFF_PRODUCT, reply(404, { status: 0 })]] });
    const out = await svc.lookup("r-1", "inv-1", { barcode: "8690000000004" });
    expect(out.kind).toBe("none");
    if (out.kind === "none") expect(out.why).toContain("no product with barcode 8690000000004");
  });

  it.each([
    ["the network fails", new Error("ECONNRESET")],
    ["it answers 503", reply(503, {})],
  ])("says Open Food Facts could not be reached when %s", async (_why, r) => {
    const { svc } = setup({ routes: [[OFF_PRODUCT, r]] });
    const err = await svc.lookup("r-1", "inv-1", { barcode: "8690000000005" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).toContain("Open Food Facts could not be reached");
    expect(err.message).toContain("type the figures from the pack");
    expect(err.message).not.toContain("ECONNRESET");
  });
});

describe("lookup by name", () => {
  it("without a FoodData Central key: searches Open Food Facts only, and says raw ingredients were skipped", async () => {
    const { svc, calls } = setup({
      routes: [[OFF_SEARCH, reply(200, { products: [{ code: "8690000000001", product_name: "Ayran", brands: "Sütaş" }, { code: "x", product_name: "bad code" }] })]],
    });
    const out = await svc.lookup("r-1", "inv-1", { name: "ayran" });
    expect(out.kind).toBe("choices");
    if (out.kind !== "choices") return;
    expect(out.choices).toEqual([{ source: "open_food_facts", ref: "8690000000001", name: "Ayran", brand: "Sütaş" }]);
    expect(out.said.join(" ")).toMatch(/FoodData Central\) are not searched/);
    expect(calls.some((c) => FDC_SEARCH.test(c.url))).toBe(false);
  });

  it("with the key: lists FoodData Central entries too, sending the key as a header and never in the URL", async () => {
    process.env[FDC_KEY_ENV] = "test-key";
    const { svc, calls } = setup({
      routes: [
        [OFF_SEARCH, reply(200, { products: [] })],
        [FDC_SEARCH, reply(200, { foods: [{ fdcId: 173430, description: "Butter, salted" }] })],
      ],
    });
    const out = await svc.lookup("r-1", "inv-1", { name: "butter" });
    if (out.kind !== "choices") throw new Error("expected choices");
    expect(out.choices).toEqual([{ source: "usda_fdc", ref: "173430", name: "Butter, salted", brand: null }]);
    expect(out.said).toEqual([]);
    const fdc = calls.find((c) => FDC_SEARCH.test(c.url));
    expect(fdc?.headers["X-Api-Key"]).toBe("test-key");
    expect(fdc?.url).not.toContain("test-key");
  });

  it("says Open Food Facts failed while still answering with what FoodData Central found", async () => {
    process.env[FDC_KEY_ENV] = "test-key";
    const { svc } = setup({
      routes: [
        [OFF_SEARCH, new Error("timeout")],
        [FDC_SEARCH, reply(200, { foods: [{ fdcId: 1, description: "Tomato, raw" }] })],
      ],
    });
    const out = await svc.lookup("r-1", "inv-1", { name: "tomato" });
    if (out.kind !== "choices") throw new Error("expected choices");
    expect(out.said).toContain("Open Food Facts could not be reached, so nothing was looked up there.");
  });

  it("is a worded 502 when nothing could be searched at all", async () => {
    const { svc } = setup({ routes: [[OFF_SEARCH, new Error("dns")]] });
    const err = await svc.lookup("r-1", "inv-1", { name: "tomato" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).toContain("Open Food Facts could not be reached");
    expect(err.message).toContain("not set up yet");
  });

  it("answers no match as found nothing, still saying what was skipped", async () => {
    const { svc } = setup({ routes: [[OFF_SEARCH, reply(200, { products: [] })]] });
    const out = await svc.lookup("r-1", "inv-1", { name: "zzzz" });
    expect(out.kind).toBe("none");
    if (out.kind === "none") expect(out.said.length).toBe(1);
  });
});

describe("lookup by FoodData Central entry", () => {
  it("is refused with a sentence when no key is set, without going outbound", async () => {
    const { svc, calls } = setup({});
    const err = await svc.lookup("r-1", "inv-1", { fdcId: "173430" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("not set up yet");
    expect(calls).toHaveLength(0);
  });

});

describe("before anything goes outbound", () => {
  it("checks the item is this house's, and sends nothing for another house's item", async () => {
    const { svc, calls, reads } = setup({ readFails: new NotFoundException("not this house's"), routes: [[OFF_PRODUCT, reply(200, {})]] });
    await expect(svc.lookup("r-1", "inv-other", { barcode: "8690000000001" })).rejects.toBeInstanceOf(NotFoundException);
    expect(reads).toEqual([["r-1", "inv-other"]]);
    expect(calls).toHaveLength(0);
  });

  it("asks for exactly one thing to look up by", async () => {
    const { svc } = setup({});
    await expect(svc.lookup("r-1", "inv-1", {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.lookup("r-1", "inv-1", { barcode: "8690000000001", name: "ayran" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.lookup("r-1", "inv-1", { barcode: "12ab" })).rejects.toThrow("6 to 14 digits");
  });

  it("lets only an owner or manager ask for a draft", async () => {
    const organizations = { assertCanManageRestaurant: jest.fn().mockRejectedValue(new ForbiddenException("managers only")) };
    const lookups = { lookup: jest.fn() };
    const ctl = new ItemNutritionController({} as never, organizations as never, lookups as never);
    await expect(ctl.lookup("r-1", "inv-1", { barcode: "8690000000001" }, { userId: "u-staff" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(lookups.lookup).not.toHaveBeenCalled();
  });
});
