import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateWineSubmissionDto } from "./dto/wine-submissions.dto";
import { WineSubmissionsService } from "./wine-submissions.service";

/**
 * F-1221: a beer or a rakı confirmed from a label photo is sent with its kind
 * as `menuCategory` and no wine style. The worker writes that kind to
 * `data_enrichment.menu_category`, the beverage_kind trigger's second input,
 * so the library row classifies as a beer or a spirit — never as a wine.
 */
type Row = Record<string, any>;

/** A library that accepts any write and keeps what it was given. */
function submissionsDb(payload: Row) {
  const written: Row[] = [];
  const library = () => {
    let pending: Row | null = null;
    const q: any = {
      upsert: (row: Row) => ((pending = row), q),
      select: () => q,
      eq: () => q,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => {
        if (!pending) return { data: null, error: null };
        written.push(pending);
        return { data: { id: "mw-new" }, error: null };
      },
    };
    return q;
  };
  const submissions = () => {
    const q: any = {
      select: () => q,
      order: () => q,
      eq: (col: string) =>
        col === "id" ? Promise.resolve({ error: null }) : q,
      update: () => q,
      limit: async () => ({
        data: [{ id: "sub-1", status: "pending", payload }],
        error: null,
      }),
    };
    return q;
  };
  const supabase = {
    from: (t: string) =>
      t === "master_wine_library" ? library() : submissions(),
    rpc: async () => ({ data: [], error: null }),
  };
  return { db: { supabase, getClient: () => supabase } as any, written };
}

const run = async (payload: Row) => {
  const t = submissionsDb(payload);
  const s = new WineSubmissionsService(t.db);
  (s as any).logger.error = jest.fn();
  await s.processPendingSubmissions();
  expect(t.written).toHaveLength(1);
  return t.written[0];
};

describe("a label submission carries a drink kind that is not wine (F-1221)", () => {
  it("writes the stated kind for the classifier, with no wine style", async () => {
    const row = await run({
      name: "Efes Pilsen",
      producer: "Anadolu Efes",
      menuCategory: "beer",
    });
    expect(row.data_enrichment).toEqual({ menu_category: "beer" });
    expect(row.primary_type).toBe("unknown");
  });

  it("a wine names no kind and writes no enrichment", async () => {
    const row = await run({
      name: "Etna Rosso",
      producer: "Benanti",
      primaryType: "red",
    });
    expect(row).toHaveProperty("data_enrichment", null);
    expect(row.primary_type).toBe("red");
  });

  it("accepts only the library's own category words", () => {
    const errors = (body: Row) =>
      validateSync(plainToInstance(CreateWineSubmissionDto, body)).map(
        (e) => e.property,
      );
    const base = { name: "Yeni Rakı", producer: "Mey" };
    expect(errors({ ...base, menuCategory: "spirit" })).toEqual([]);
    expect(errors({ ...base, menuCategory: "rakı" })).toEqual(["menuCategory"]);
  });
});
