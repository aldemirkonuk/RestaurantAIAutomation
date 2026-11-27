import {
  MICRO,
  RecipeLine,
  RecipeVersion,
  ShelfItem,
  drawKey,
  planRecipeDraw,
  route,
  settle,
} from "./recipe-draw";

/**
 * Inventory r28, gap 1: a dish or cocktail sale never draws its goods. These
 * cases pin the invariants in recipe-draw.ts before any writer uses them.
 */

const stocked = (position: number, inventoryId: string | null, qtyBase: number, baseUnit: RecipeLine["baseUnit"], label = `line ${position}`): RecipeLine => ({
  position,
  role: "stocked",
  inventoryId,
  label,
  qtyBase,
  baseUnit,
});

const garnish = (position: number): RecipeLine => ({
  position,
  role: "untracked",
  inventoryId: null,
  label: "orange peel",
  qtyBase: 1000,
  baseUnit: "each_milli",
});

const bottle = (size: number | null = 700): ShelfItem => ({ uom: "bottle", bottleSizeMl: size });
const kept = (uom: string | null): ShelfItem => ({ uom, bottleSizeMl: null });

/** Book a plan through settle, as the writer will, starting with no carry. */
function book(plan: ReturnType<typeof planRecipeDraw>) {
  if (plan.kind !== "draw") throw new Error("expected a draw");
  return Object.fromEntries(plan.draws.map((d) => [`${d.inventoryId}:${d.via}`, settle(d.exactMicro, d.basePerUnit, 0n).units]));
}

describe("a Negroni sale takes each spirit from its open bottle", () => {
  const negroni: RecipeVersion = {
    id: "v-negroni-1",
    yieldServes: 1,
    lines: [
      stocked(1, "gin", 300, "ml10", "gin"),
      stocked(2, "campari", 300, "ml10", "Campari"),
      stocked(3, "vermouth", 300, "ml10", "sweet vermouth"),
      garnish(4),
    ],
  };
  const shelf = new Map([
    ["gin", bottle()],
    ["campari", bottle(1000)],
    ["vermouth", bottle(750)],
  ]);

  it("two Negronis pour 60 ml of each, and the garnish draws nothing", () => {
    const plan = planRecipeDraw(negroni, 2, shelf);
    expect(plan.kind).toBe("draw");
    expect(book(plan)).toEqual({ "gin:pour": 60, "campari:pour": 60, "vermouth:pour": 60 });
  });

  it("names the version it used, so a void can give back exactly this", () => {
    expect(planRecipeDraw(negroni, 1, shelf).versionId).toBe("v-negroni-1");
  });

  it("if one spirit is not linked, nothing is drawn and the line says which", () => {
    const half = { ...negroni, lines: [...negroni.lines.slice(0, 2), stocked(3, null, 300, "ml10", "sweet vermouth")] };
    expect(planRecipeDraw(half, 1, shelf)).toEqual({
      kind: "wait",
      versionId: "v-negroni-1",
      waits: [{ position: 3, label: "sweet vermouth", reason: "unlinked" }],
    });
  });

  it("an item outside this house's read waits, it is not drawn", () => {
    const foreign = new Map([...shelf].filter(([id]) => id !== "campari"));
    const plan = planRecipeDraw(negroni, 1, foreign);
    expect(plan).toMatchObject({ kind: "wait", waits: [{ position: 2, reason: "not_this_house" }] });
  });

  it("a bottle with no size waits, since a pour cannot be placed in it", () => {
    const plan = planRecipeDraw(negroni, 1, new Map([...shelf, ["gin", bottle(null)]]));
    expect(plan).toMatchObject({ kind: "wait", waits: [{ position: 1, reason: "no_container_size" }] });
    expect(planRecipeDraw(negroni, 1, new Map([...shelf, ["gin", bottle(0)]]))).toMatchObject({ kind: "wait" });
  });

  it("lists every reason at once, not only the first", () => {
    const plan = planRecipeDraw(negroni, 1, new Map([["gin", bottle(null)]]));
    expect(plan.kind === "wait" && plan.waits.map((w) => w.reason)).toEqual([
      "no_container_size",
      "not_this_house",
      "not_this_house",
    ]);
  });
});

describe("a batch recipe divides by what it yields", () => {
  it("a 10-serve punch with 1 l of rum takes 300 ml for 3 serves", () => {
    const punch: RecipeVersion = { id: "v", yieldServes: 10, lines: [stocked(1, "rum", 10_000, "ml10")] };
    expect(book(planRecipeDraw(punch, 3, new Map([["rum", bottle()]])))).toEqual({ "rum:pour": 300 });
  });

  it("a remainder is carried exactly, in millionths", () => {
    const thirds: RecipeVersion = { id: "v", yieldServes: 3, lines: [stocked(1, "rum", 100, "ml10")] };
    const plan = planRecipeDraw(thirds, 1, new Map([["rum", kept("ml")]]));
    expect(plan.kind === "draw" && plan.draws[0].exactMicro).toBe(33_333_333n);
  });
});

describe("a weighed good keeps its gram across sales (I1)", () => {
  const fries: RecipeVersion = { id: "v", yieldServes: 1, lines: [stocked(1, "salt", 7_500, "mg", "salt")] };

  it("7.5 g a plate books 7, 8, 7, 8 g, and four plates take exactly 30 g", () => {
    const plan = planRecipeDraw(fries, 1, new Map([["salt", kept("g")]]));
    if (plan.kind !== "draw") throw new Error("expected a draw");
    const [d] = plan.draws;
    let carry = 0n;
    const booked: number[] = [];
    for (let i = 0; i < 4; i++) {
      const s = settle(d.exactMicro, d.basePerUnit, carry);
      booked.push(s.units);
      carry = s.carryOut;
    }
    expect(booked).toEqual([7, 8, 7, 8]);
    expect(carry).toBe(0n);
  });

  it("draws from a good kept in kg, in kg, and owes nothing until a whole kg is used", () => {
    const plan = planRecipeDraw(fries, 1, new Map([["salt", kept("kg")]]));
    if (plan.kind !== "draw") throw new Error("expected a draw");
    expect(plan.draws[0].basePerUnit).toBe(1_000_000n);
    expect(settle(plan.draws[0].exactMicro, plan.draws[0].basePerUnit, 0n)).toEqual({
      units: 0,
      carryOut: 7_500n * MICRO,
    });
  });
});

describe("units never cross (I6)", () => {
  it.each([
    ["ml10", "ml", "book", 10n],
    ["ml10", "l", "book", 10_000n],
    ["ml10", "keg", "pour", 10n],
    ["mg", "mg", "book", 1n],
    ["mg", "g", "book", 1_000n],
    ["mg", "kg", "book", 1_000_000n],
    ["each_milli", "each", "book", 1_000n],
  ] as const)("%s reaches a good kept in %s by %s, %s base units to one", (base, uom, via, per) => {
    expect(route(base, { uom, bottleSizeMl: 750 })).toEqual({ via, basePerUnit: per });
  });

  it.each([
    ["ml10", "g"],
    ["ml10", "kg"],
    ["ml10", "each"],
    ["ml10", "case"],
    ["mg", "ml"],
    ["mg", "l"],
    ["mg", "bottle"],
    ["mg", "each"],
    ["each_milli", "g"],
    ["each_milli", "ml"],
    ["each_milli", "l"],
    ["each_milli", "kg"],
    // A piece is never one container: the cost side refuses the same pairs (r36 gap 4).
    ["each_milli", "bottle"],
    ["each_milli", "case"],
    ["each_milli", "pack"],
    ["each_milli", "keg"],
    ["each_milli", "glass"],
    ["each_milli", "shot"],
  ] as const)("%s against a good kept in %s waits", (base, uom) => {
    expect(route(base, { uom, bottleSizeMl: 750 })).toEqual({ wait: "measure_mismatch" });
  });

  it("a good with no unit waits, whatever the line measures", () => {
    for (const base of ["ml10", "mg", "each_milli"] as const) {
      expect(route(base, kept(null))).toEqual({ wait: "no_unit" });
      expect(route(base, kept(""))).toEqual({ wait: "no_unit" });
    }
  });

  it("a glass of olive oil measured in ml against oil kept in g waits, with its line named", () => {
    const v: RecipeVersion = { id: "v", yieldServes: 1, lines: [stocked(1, "oil", 150, "ml10", "olive oil")] };
    expect(planRecipeDraw(v, 1, new Map([["oil", kept("g")]]))).toEqual({
      kind: "wait",
      versionId: "v",
      waits: [{ position: 1, label: "olive oil", reason: "measure_mismatch" }],
    });
  });

  it("one egg a plate takes one egg", () => {
    const v: RecipeVersion = { id: "v", yieldServes: 1, lines: [stocked(1, "egg", 1_000, "each_milli")] };
    expect(book(planRecipeDraw(v, 6, new Map([["egg", kept("each")]])))).toEqual({ "egg:book": 6 });
  });

  it("one lime against limes kept by the case waits, and never takes a case a serve", () => {
    const v: RecipeVersion = { id: "v", yieldServes: 1, lines: [stocked(1, "lime", 1_000, "each_milli", "lime")] };
    expect(planRecipeDraw(v, 3, new Map([["lime", kept("case")]]))).toEqual({
      kind: "wait",
      versionId: "v",
      waits: [{ position: 1, label: "lime", reason: "measure_mismatch" }],
    });
  });
});

describe("what makes the whole line wait before any good is read", () => {
  const v: RecipeVersion = { id: "v", yieldServes: 1, lines: [stocked(1, "egg", 1_000, "each_milli")] };
  const shelf = new Map([["egg", kept("each")]]);

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("%s serves waits", (serves) => {
    expect(planRecipeDraw(v, serves, shelf)).toEqual({
      kind: "wait",
      versionId: "v",
      waits: [{ position: null, label: null, reason: "bad_quantity" }],
    });
  });

  it.each([0, -2, 0.5])("a yield of %s waits", (yieldServes) => {
    expect(planRecipeDraw({ ...v, yieldServes }, 1, shelf)).toMatchObject({
      kind: "wait",
      waits: [{ reason: "bad_yield" }],
    });
  });

  it.each([0, -5, 2.5])("a line of %s base units waits", (qtyBase) => {
    expect(planRecipeDraw({ ...v, lines: [stocked(1, "egg", qtyBase, "each_milli")] }, 1, shelf)).toMatchObject({
      kind: "wait",
      waits: [{ position: 1, reason: "bad_quantity" }],
    });
  });
});

describe("lines and keys", () => {
  it("a recipe of only untracked lines draws nothing and does not wait", () => {
    expect(planRecipeDraw({ id: "v", yieldServes: 1, lines: [garnish(1)] }, 3, new Map())).toEqual({
      kind: "draw",
      versionId: "v",
      draws: [],
    });
  });

  it("two lines using one good merge into one draw, under one key (I4)", () => {
    const v: RecipeVersion = {
      id: "v",
      yieldServes: 1,
      lines: [stocked(1, "butter", 10_000, "mg"), stocked(2, "flour", 200_000, "mg"), stocked(3, "butter", 5_000, "mg")],
    };
    const plan = planRecipeDraw(v, 2, new Map([["butter", kept("g")], ["flour", kept("kg")]]));
    if (plan.kind !== "draw") throw new Error("expected a draw");
    expect(plan.draws.map((d) => [d.inventoryId, d.positions, d.exactMicro])).toEqual([
      ["butter", [1, 3], 30_000n * MICRO],
      ["flour", [2], 400_000n * MICRO],
    ]);
    expect(new Set(plan.draws.map((d) => drawKey("pos:toast:c1:item:1", d))).size).toBe(plan.draws.length);
  });

  it("a key names the sale, the good and the way it was drawn", () => {
    expect(drawKey("pos:toast:c1:item:1", { inventoryId: "gin", via: "pour" })).toBe("pos:toast:c1:item:1:r:gin:pour");
  });
});

describe("settle", () => {
  it("refuses a negative draw, a negative carry and a unit that is not positive", () => {
    expect(() => settle(-1n, 10n, 0n)).toThrow(RangeError);
    expect(() => settle(1n, 10n, -1n)).toThrow(RangeError);
    expect(() => settle(1n, 0n, 0n)).toThrow(RangeError);
  });

  it("books a million serves of a 750 ml pour exactly", () => {
    const v: RecipeVersion = { id: "v", yieldServes: 1, lines: [stocked(1, "wine", 7_500, "ml10")] };
    expect(book(planRecipeDraw(v, 1_000_000, new Map([["wine", bottle(750)]])))).toEqual({ "wine:pour": 750_000_000 });
  });

  it("refuses to book a draw too large to be a whole number in JavaScript", () => {
    expect(() => settle(BigInt(Number.MAX_SAFE_INTEGER) * MICRO + MICRO, 1n, 0n)).toThrow("draw too large to book");
    expect(settle(BigInt(Number.MAX_SAFE_INTEGER) * MICRO, 1n, 0n).units).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("over any run of sales, booked units plus the carry are the exact draw, and the carry stays under one unit", () => {
    let seed = 20261113;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 200; run++) {
      const basePerUnit = [1n, 10n, 1_000n, 10_000n, 1_000_000n][rand(5)];
      const unitMicro = basePerUnit * MICRO;
      let carry = 0n;
      let booked = 0n;
      let exact = 0n;
      for (let sale = 0; sale < 50; sale++) {
        const draw = (BigInt(1 + rand(50_000)) * BigInt(1 + rand(9)) * MICRO) / BigInt(1 + rand(12));
        exact += draw;
        const s = settle(draw, basePerUnit, carry);
        expect(s.units).toBeGreaterThanOrEqual(0);
        booked += BigInt(s.units);
        carry = s.carryOut;
        expect(carry >= 0n && carry < unitMicro).toBe(true);
        expect(booked * unitMicro + carry).toBe(exact);
      }
    }
  });
});
