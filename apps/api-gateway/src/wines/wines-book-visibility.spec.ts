import { createClient } from "@supabase/supabase-js";
import { WinesService } from "./wines.service";
import { WinesController } from "./wines.controller";
import { GetWinesQueryDto, WineSuggestionsQueryDto } from "./dto/wines.dto";

/**
 * F-496 — the wine book is the SHARED library, minus what one house must not
 * see.
 *
 * Every read in WinesService goes through the service-role client, so RLS
 * filters nothing. Before this fix the book listed every other house's own
 * provisional wines ("House White Wine", ADR 0130: "never offered to another
 * venue") and every row a merge retired (`deleted_at`), so a deduped wine
 * showed twice.
 *
 * A REAL supabase-js client runs against a fake fetch that applies the
 * filters the request actually carried to a fixture table, so what is
 * asserted is which rows a house gets back, from the query that would have
 * left the gateway. Only the filters these reads use are modelled.
 */

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, any>;

const ROWS: Row[] = [
  { id: "shared", name: "Barolo", country: "Italy", primary_type: "red", deleted_at: null, provisional_for_restaurant_id: null },
  { id: "a-own", name: "House White Wine", country: "Turkey", primary_type: "white", deleted_at: null, provisional_for_restaurant_id: HOUSE_A },
  { id: "b-own", name: "House Red Wine", country: "Georgia", primary_type: "orange", deleted_at: null, provisional_for_restaurant_id: HOUSE_B },
  { id: "merged-away", name: "Barolo (copy)", country: "Chile", primary_type: "red", deleted_at: "2026-10-01T00:00:00Z", provisional_for_restaurant_id: null },
];

/** One PostgREST condition, `col op value`, against one row. */
function holds(row: Row, col: string, op: string, value: string): boolean {
  if (op === "is" && value === "null") return row[col] === null || row[col] === undefined;
  if (op === "eq") return String(row[col]) === value;
  if (op === "neq") return String(row[col]) !== value;
  throw new Error(`unmodelled filter ${col}.${op}.${value}`);
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or") {
      const parts = raw.slice(1, -1).split(",");
      const anyHolds = parts.some((p) => {
        const [col, op, ...rest] = p.split(".");
        if (op === "ilike") {
          const needle = rest.join(".").replace(/[%"]/g, "").toLowerCase();
          return String(row[col] ?? "").toLowerCase().includes(needle);
        }
        return holds(row, col, op, rest.join("."));
      });
      if (!anyHolds) return false;
      continue;
    }
    if (raw === "not.is.null") {
      if (row[key] === null || row[key] === undefined) return false;
      continue;
    }
    const [op, ...rest] = raw.split(".");
    if (!holds(row, key, op, rest.join("."))) return false;
  }
  return true;
}

function book() {
  const fakeFetch = async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const rows = ROWS.filter((r) => matches(r, url.searchParams));
    const accept = new Headers(init?.headers).get("accept") ?? "";
    if (accept.includes("vnd.pgrst.object")) {
      if (rows.length !== 1) {
        return new Response(
          JSON.stringify({ code: "PGRST116", message: "0 rows" }),
          { status: 406, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(rows[0]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient("http://postgrest.invalid", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch as unknown as typeof fetch },
  });
  return new WinesService({ getClient: () => client } as any);
}

const ids = (wines: Array<{ id: string }>) => wines.map((w) => w.id).sort();

describe("F-496 the wine book shows a house only the shared library and its own wines", () => {
  it("house A sees the shared wine and its own house wine, never B's, never a merged-away copy", async () => {
    const wines = await book().searchWines({} as GetWinesQueryDto, HOUSE_A);
    expect(ids(wines)).toEqual(["a-own", "shared"]);
  });

  it("house B sees its own house wine and not A's", async () => {
    const wines = await book().searchWines({} as GetWinesQueryDto, HOUSE_B);
    expect(ids(wines)).toEqual(["b-own", "shared"]);
  });

  it("no house, or a house id that is not a uuid, sees the shared library only", async () => {
    expect(ids(await book().searchWines({} as GetWinesQueryDto))).toEqual(["shared"]);
    expect(
      ids(await book().searchWines({} as GetWinesQueryDto, "x,id.not.is.null")),
    ).toEqual(["shared"]);
  });

  it("an id lookup hides B's wine and a merged-away row from house A", async () => {
    const s = book();
    expect(await s.getWineById("b-own", HOUSE_A)).toBeNull();
    expect(await s.getWineById("merged-away", HOUSE_A)).toBeNull();
    expect((await s.getWineById("a-own", HOUSE_A))?.id).toBe("a-own");
    expect((await s.getWineById("b-own", HOUSE_B))?.id).toBe("b-own");
  });

  it("suggestions, similar wines and the country/type lists apply the same fence", async () => {
    const s = book();
    const suggested = await s.getWineSuggestions(
      { text: "House" } as WineSuggestionsQueryDto,
      HOUSE_A,
    );
    expect(ids(suggested)).toEqual(["a-own"]);
    expect(await s.getWineCountries(HOUSE_A)).toEqual(["Italy", "Turkey"]);
    expect(await s.getWineCategories(HOUSE_A)).toEqual(["red", "white"]);
    expect(await s.getSimilarWines("b-own", {} as any, HOUSE_A)).toEqual([]);
  });

  it("the controller passes the caller's house to the book", async () => {
    const searchWines = jest.fn(async () => []);
    const getWineById = jest.fn(async () => ({ id: "a-own" }));
    const controller = new WinesController(
      { searchWines, getWineById } as any,
      {} as any,
      {} as any,
    );
    await controller.searchWines({} as GetWinesQueryDto, { restaurantId: HOUSE_A });
    await controller.getById("a-own", { restaurantId: HOUSE_A });
    expect(searchWines).toHaveBeenCalledWith({}, HOUSE_A);
    expect(getWineById).toHaveBeenCalledWith("a-own", HOUSE_A);
  });
});
