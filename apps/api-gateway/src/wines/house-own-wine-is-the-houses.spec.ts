import { createClient } from "@supabase/supabase-js";
import { WinesService, houseScopeFilter } from "./wines.service";
import { WinesController } from "./wines.controller";
import { GetWinesQueryDto, WineSuggestionsQueryDto } from "./dto/wines.dto";

/**
 * 2026-11-12 (menu walk): "House Red" and "House White" sat on /wines as
 * "unattributed", beside catalogue rows whose producer was never recorded.
 * They are generic names kept as ONE venue's own wine (ADR 0130,
 * `provisional_for_restaurant_id`). Two things follow:
 *
 *  - a list read shows such a row to its own house only. Before, every list
 *    read returned every venue's own rows, so house A's "House Red" was on
 *    house B's /wines too;
 *  - the row says it is the house's own (`houseOwn`), so the page can say so
 *    instead of "unattributed".
 *
 * A real supabase-js client with a recording fetch: what is asserted is the
 * query string that would leave the gateway.
 */

const HOUSE = "10ca1c4e-0000-4000-8000-000000000001";
const OTHER = "20ca1c4e-0000-4000-8000-000000000002";

function recordingClient(rows: unknown[] = []) {
  const calls: URL[] = [];
  const fakeFetch = async (input: unknown) => {
    calls.push(new URL(String(input)));
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient("http://postgrest.invalid", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch as unknown as typeof fetch },
  });
  const service = new WinesService({ getClient: () => client } as any);
  return { service, calls };
}

const row = (over: Record<string, unknown>) => ({
  id: "w1",
  name: "House Red",
  producer: null,
  vintage: null,
  price_reference: null,
  primary_type: null,
  grape_variety: null,
  country: null,
  region: null,
  appellation: null,
  provisional_for_restaurant_id: null,
  ...over,
});

describe("houseScopeFilter", () => {
  it("lets a house see the shared catalogue and its own wines", () => {
    expect(houseScopeFilter(HOUSE)).toBe(
      `provisional_for_restaurant_id.is.null,provisional_for_restaurant_id.eq.${HOUSE}`,
    );
  });

  it("with no house, or anything that is not a uuid, only the shared catalogue", () => {
    expect(houseScopeFilter(undefined)).toBe(
      "provisional_for_restaurant_id.is.null",
    );
    expect(houseScopeFilter(null)).toBe("provisional_for_restaurant_id.is.null");
    expect(houseScopeFilter("x,id.not.is.null")).toBe(
      "provisional_for_restaurant_id.is.null",
    );
  });
});

describe("GET /wines — another house's own wine is not listed", () => {
  it("scopes the list to the shared catalogue and this house's own wines", async () => {
    const { service, calls } = recordingClient();
    await service.searchWines({} as GetWinesQueryDto, HOUSE);
    expect(calls[0].searchParams.getAll("or")).toEqual([
      `(${houseScopeFilter(HOUSE)})`,
    ]);
  });

  it("keeps the search as its own condition, ANDed with the scope", async () => {
    const { service, calls } = recordingClient();
    await service.searchWines({ search: "Red" } as GetWinesQueryDto, HOUSE);
    expect(calls[0].searchParams.getAll("or")).toEqual([
      "(name.ilike.%Red%,producer.ilike.%Red%)",
      `(${houseScopeFilter(HOUSE)})`,
    ]);
  });

  it("suggestions are scoped the same way, and read the owner column", async () => {
    const { service, calls } = recordingClient();
    await service.getWineSuggestions(
      { text: "House" } as WineSuggestionsQueryDto,
      HOUSE,
    );
    expect(calls[0].searchParams.getAll("or")).toContain(
      `(${houseScopeFilter(HOUSE)})`,
    );
    expect(calls[0].searchParams.get("select")).toMatch(
      /provisional_for_restaurant_id/,
    );
  });

  it("marks this house's own wine, and only for this house", async () => {
    const { service } = recordingClient([
      row({ id: "h1", provisional_for_restaurant_id: HOUSE }),
      row({ id: "c1", name: "Nameless Red" }),
    ]);
    const [own, shared] = await service.searchWines(
      {} as GetWinesQueryDto,
      HOUSE,
    );
    expect(own.houseOwn).toBe(true);
    expect(shared.houseOwn).toBe(false);

    const other = recordingClient([
      row({ id: "h1", provisional_for_restaurant_id: HOUSE }),
    ]);
    const [seenByOther] = await other.service.searchWines(
      {} as GetWinesQueryDto,
      OTHER,
    );
    expect(seenByOther.houseOwn).toBe(false);
  });

  it("does not say either way when no house asked", async () => {
    const { service } = recordingClient([
      row({ provisional_for_restaurant_id: HOUSE }),
    ]);
    const [w] = await service.searchWines({} as GetWinesQueryDto);
    expect(w.houseOwn).toBeUndefined();
  });

  it("the controller passes the session's house to the read", async () => {
    const searchWines = jest.fn().mockResolvedValue([]);
    const controller = new WinesController(
      { searchWines } as any,
      {} as any,
      {} as any,
    );
    await controller.searchWines({} as GetWinesQueryDto, {
      restaurantId: HOUSE,
    });
    expect(searchWines).toHaveBeenCalledWith({}, HOUSE);
  });
});
