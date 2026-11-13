/**
 * The reader of `wine_signature_refold_review` (QA round 10c F3: the
 * migration wrote held-back pairs to a table nothing read).
 *
 * Real: `WineSubmissionsService.listRefoldReview`. Double: the Supabase
 * client, as an in-memory table set that evaluates `is`, `in`, `order` and
 * `limit`, so the spec checks which rows come back rather than which calls
 * were made.
 */
import { ServiceUnavailableException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RefoldReviewQueryDto } from "./dto/wine-submissions.dto";
import { WineSubmissionsService } from "./wine-submissions.service";

type Tables = Record<string, any[]>;

function makeDb(tables: Tables, failing: string[] = []) {
  const from = (table: string) => {
    const preds: Array<(r: any) => boolean> = [];
    const orders: string[] = [];
    let limit = Infinity;
    const run = () => {
      if (failing.includes(table)) return { data: null, error: { message: "boom" } };
      let out = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      for (const col of [...orders].reverse()) {
        out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      }
      return { data: out.slice(0, limit), error: null };
    };
    const b: any = {
      select: () => b,
      is: (col: string, val: any) => (preds.push((r) => (r[col] ?? null) === val), b),
      in: (col: string, vals: any[]) => (preds.push((r) => vals.includes(r[col])), b),
      order: (col: string, opts?: { ascending?: boolean }) => {
        if (opts?.ascending === false) throw new Error("only ascending here");
        orders.push(col);
        return b;
      },
      limit: (n: number) => ((limit = n), b),
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  };
  return new WineSubmissionsService({ supabase: { from } } as any);
}

const LIB = [
  { id: "a1", producer: "Kavaklıdere", name: "Yakut", vintage: "Zq832", deleted_at: null, provisional_for_restaurant_id: null },
  { id: "k1", producer: "KAVAKLIDERE", name: "YAKUT", vintage: "ZQ832", deleted_at: null, provisional_for_restaurant_id: null },
  { id: "b2", producer: "Vinkara", name: "Kiraz Karası", vintage: null, deleted_at: null, provisional_for_restaurant_id: "venue-a" },
  { id: "b1", producer: "Vinkara", name: "Kıraz Karasi", vintage: null, deleted_at: null, provisional_for_restaurant_id: "venue-a" },
];
const ROSTER = [
  { id: "r-old", restaurant_id: "venue-a", wine_name: "Karası Özel" },
  { id: "r-new", restaurant_id: "venue-a", wine_name: "Karasi Ozel" },
];
const REVIEW = [
  { id: "rv2", table_name: "master_wine_library", row_id: "b2", held_by: "b1", stored_hash: "h2", folded_hash: "f2", recorded_at: "2026-11-07T10:00:01Z", resolved_at: null },
  { id: "rv1", table_name: "master_wine_library", row_id: "a1", held_by: "k1", stored_hash: "h1", folded_hash: "f1", recorded_at: "2026-11-07T10:00:00Z", resolved_at: null },
  { id: "rv3", table_name: "restaurant_wine_roster", row_id: "r-old", held_by: "r-new", stored_hash: "h3", folded_hash: "f3", recorded_at: "2026-11-07T10:00:02Z", resolved_at: null },
  { id: "rv0", table_name: "master_wine_library", row_id: "x", held_by: "y", stored_hash: "h0", folded_hash: "f0", recorded_at: "2026-11-01T00:00:00Z", resolved_at: "2026-11-02T00:00:00Z" },
];
const tables = () => ({
  wine_signature_refold_review: REVIEW.map((r) => ({ ...r })),
  master_wine_library: LIB.map((r) => ({ ...r })),
  restaurant_wine_roster: ROSTER.map((r) => ({ ...r })),
});

describe("listRefoldReview: the pairs the dotless-ı refold held back", () => {
  it("lists the open pairs oldest first, each with both sides labelled", async () => {
    const svc = makeDb(tables());
    const out = await svc.listRefoldReview(100);

    expect(out.complete).toBe(true);
    expect(out.pairs.map((p) => p.id)).toEqual(["rv1", "rv2", "rv3"]);
    const [yakut, kiraz, roster] = out.pairs;
    expect(yakut).toMatchObject({
      table: "master_wine_library",
      held: { id: "a1", label: "Kavaklıdere Yakut Zq832", deleted: false },
      heldBy: { id: "k1", label: "KAVAKLIDERE YAKUT ZQ832" },
      storedHash: "h1",
      foldedHash: "f1",
    });
    expect(kiraz.held).toMatchObject({ id: "b2", restaurantId: "venue-a" });
    expect(roster).toMatchObject({
      table: "restaurant_wine_roster",
      held: { id: "r-old", label: "Karası Özel", restaurantId: "venue-a" },
      heldBy: { id: "r-new", label: "Karasi Ozel" },
    });
  });

  it("leaves resolved pairs out", async () => {
    const out = await makeDb(tables()).listRefoldReview(100);
    expect(out.pairs.find((p) => p.id === "rv0")).toBeUndefined();
  });

  it("says the list is incomplete when there are more pairs than the limit", async () => {
    const out = await makeDb(tables()).listRefoldReview(2);
    expect(out.pairs.map((p) => p.id)).toEqual(["rv1", "rv2"]);
    expect(out.complete).toBe(false);
  });

  it("reports a side it cannot find as missing, instead of dropping the pair", async () => {
    const t = tables();
    t.master_wine_library = t.master_wine_library.filter((w) => w.id !== "k1");
    const out = await makeDb(t).listRefoldReview(100);
    const yakut = out.pairs.find((p) => p.id === "rv1")!;
    expect(yakut.heldBy).toEqual({ id: "k1", missing: true });
    expect(yakut.held).toMatchObject({ id: "a1" });
  });

  it.each([
    "wine_signature_refold_review",
    "master_wine_library",
    "restaurant_wine_roster",
  ])("refuses to answer, rather than answer empty, when %s cannot be read", async (table) => {
    const svc = makeDb(tables(), [table]);
    await expect(svc.listRefoldReview(100)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("listRefoldReview: a stable order when pairs share a timestamp", () => {
  it("breaks recorded_at ties by id, so a page boundary never shuffles", async () => {
    const t = tables();
    const at = "2026-11-07T11:00:00Z";
    // Inserted in reverse id order, all at the same instant.
    t.wine_signature_refold_review = ["rv-c", "rv-b", "rv-a"].map((id) => ({
      id, table_name: "master_wine_library", row_id: "a1", held_by: "k1",
      stored_hash: "h", folded_hash: "f", recorded_at: at, resolved_at: null,
    }));
    const out = await makeDb(t).listRefoldReview(100);
    expect(out.pairs.map((p) => p.id)).toEqual(["rv-a", "rv-b", "rv-c"]);
  });
});

describe("RefoldReviewQueryDto: the limit is capped at 200", () => {
  const check = async (limit: unknown) =>
    validate(plainToInstance(RefoldReviewQueryDto, { limit }));

  it("accepts 1 and 200", async () => {
    expect(await check("1")).toHaveLength(0);
    expect(await check("200")).toHaveLength(0);
  });

  it("refuses 201, 0 and a non-integer", async () => {
    expect(await check("201")).not.toHaveLength(0);
    expect(await check("0")).not.toHaveLength(0);
    expect(await check("2.5")).not.toHaveLength(0);
  });
});
