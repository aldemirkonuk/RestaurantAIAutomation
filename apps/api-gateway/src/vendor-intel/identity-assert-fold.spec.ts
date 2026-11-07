import { IdentityService } from "./identity.service";
import { couldBeBeforeFold, readIdentity } from "./beverage-identity";
import { normalizeIdentityTextBeforeFold } from "./wine-identity";

// QA round 10c F1: one row per bottle, whatever spelling asserts it. The
// in-memory register evaluates eq / like / limit, so the spec counts rows.
type Row = Record<string, any>;
const keyOf = (r: Row) =>
  [r.producer_normalised, r.name_normalised, r.vintage_text, r.size_ml ?? "size?", r.pack ?? "pack?"].join("|");
const likeRe = (p: string) =>
  new RegExp(`^${p.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

function makeRegister(seed: Row[], likeFails = false) {
  const rows = seed.map((r) => ({ ...r }));
  const from = () => {
    const preds: Array<(r: Row) => boolean> = [];
    let usedLike = false;
    let limit = Infinity;
    const run = () =>
      rows
        .map((r) => ({ ...r, identity_key: keyOf(r) }))
        .filter((r) => preds.every((p) => p(r)))
        .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
        .slice(0, limit);
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => (preds.push((r) => r[c] === v), b),
      like: (c: string, p: string) => ((usedLike = true), preds.push((r) => likeRe(p).test(r[c])), b),
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (ok: any, ko: any) =>
        Promise.resolve(
          likeFails && usedLike ? { data: null, error: { message: "statement timeout" } } : { data: run(), error: null },
        ).then(ok, ko),
      insert: (payload: Row) => {
        const row = { id: `ident-${rows.length + 1}`, created_at: "2026-11-08", ...payload };
        const dup = rows.some((r) => keyOf(r) === keyOf(row));
        if (!dup) rows.push(row);
        const out = dup ? { data: null, error: { message: "duplicate key" } } : { data: row, error: null };
        return { select: () => ({ single: async () => out }) };
      },
    };
    return b;
  };
  return { svc: new IdentityService({ supabase: { from } } as any), rows };
}

/** The row the code before the fold wrote when this was asserted. */
function beforeFold(producer: string, name: string, sizeMl = 750): Row {
  const r = readIdentity({ producer, name, sizeMl, pack: 1 }, normalizeIdentityTextBeforeFold);
  if (!r.ok) throw new Error("unreadable");
  return {
    id: "ident-old",
    producer_normalised: r.producerNormalised,
    name_normalised: r.nameNormalised,
    vintage_text: r.vintageText,
    size_ml: r.sizeMl,
    pack: r.pack,
    display_label: `${producer} ${name} (${sizeMl}ml)`,
    standing: "provisional",
    curation_state: "queued",
    created_at: "2026-10-01",
  };
}

const assertAs = (svc: IdentityService, producer: string, name: string) =>
  svc.assertIdentity({ subject: { producer, name, sizeMl: 750, pack: 1 }, userId: "u", restaurantId: "h" });

describe("ı, then ASCII, then caps", () => {
  it("is one bottle when the ı row predates the fold", async () => {
    const old = beforeFold("Kavaklıdere", "Yakut");
    expect(keyOf(old)).toBe("kavakl dere|yakut|unstated|750|1");
    const { svc, rows } = makeRegister([old]);
    const outs = [
      await assertAs(svc, "Kavaklidere", "Yakut"),
      await assertAs(svc, "KAVAKLIDERE", "YAKUT"),
      await assertAs(svc, "Kavaklıdere", "Yakut"),
    ];
    expect(rows).toHaveLength(1);
    for (const out of outs) expect(out).toMatchObject({ created: false, id: "ident-old" });
  });

  it.each([
    ["ı in producer and name", "Kavaklıdere", "Kalecik Karası", "KAVAKLIDERE", "KALECIK KARASI"],
    ["a leading ı trimmed away", "Kavaklıdere", "ışık", "KAVAKLIDERE", "ISIK"],
  ])("stays one bottle with %s", async (_, p0, n0, p1, n1) => {
    const { svc, rows } = makeRegister([beforeFold(p0, n0)]);
    await assertAs(svc, p1, n1);
    expect(rows).toHaveLength(1);
  });

  it("is one bottle when the ı row is new", async () => {
    const { svc, rows } = makeRegister([]);
    await assertAs(svc, "Kavaklıdere", "Yakut");
    await assertAs(svc, "Kavaklidere", "Yakut");
    await assertAs(svc, "KAVAKLIDERE", "YAKUT");
    expect(rows.map(keyOf)).toEqual(["kavaklidere|yakut|unstated|750|1"]);
  });
});

describe("what the pre-fold lookup must not take", () => {
  it.each([
    // "domaine al" IS a pre-fold image of "domaine ali"; the typed label differs.
    ["'Domaine Al' for 'Domaine Ali'", beforeFold("Domaine Al", "Kırmızı"), "Domaine Ali", "Kirmizi"],
    ["a real space for an i", beforeFold("Kavakl Dere", "Yakut"), "Kavaklidere", "Yakut"],
    ["another size of the same wine", beforeFold("Kavaklıdere", "Yakut", 375), "KAVAKLIDERE", "YAKUT"],
  ])("does not take %s", async (_, old, producer, name) => {
    const { svc, rows } = makeRegister([old]);
    expect((await assertAs(svc, producer, name)).created).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("refuses, writing nothing, when the read fails", async () => {
    const { svc, rows } = makeRegister([beforeFold("Kavaklıdere", "Yakut")], true);
    await expect(assertAs(svc, "KAVAKLIDERE", "YAKUT")).rejects.toThrow(/statement timeout\)\. Nothing was written/);
    expect(rows).toHaveLength(1);
  });
});

it.each([
  ["kavaklidere", "kavakl dere", true],
  ["isik", "s k", true],
  ["kavaklidere", "kavak dere", false],
  ["yakut", "yakut ", false],
])("couldBeBeforeFold(%s, %s) is %s", (folded, stored, want) => {
  expect(couldBeBeforeFold(folded, stored)).toBe(want);
});
