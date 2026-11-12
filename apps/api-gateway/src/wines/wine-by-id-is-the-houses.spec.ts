import { createClient } from "@supabase/supabase-js";
import { HttpException } from "@nestjs/common";
import { WinesService, houseScopeFilter } from "./wines.service";
import { WinesController } from "./wines.controller";
import { SimilarWinesQueryDto } from "./dto/wines.dto";

/**
 * GET /wines/:id read one library row with no house scope, so any member of
 * any house could open another venue's own wine (ADR 0130,
 * `provisional_for_restaurant_id`) by id, while the list reads (#1123) already
 * hid it. The by-id read now carries the same scope, and a row it may not see
 * reads as not found, like an id that does not exist.
 *
 * A real supabase-js client with a recording fetch: the query string that
 * would leave the gateway is asserted, and the reply PostgREST would give
 * (one row, or 406 PGRST116 for none) drives the result.
 */

const HOUSE = "10ca1c4e-0000-4000-8000-000000000001";
const OTHER = "20ca1c4e-0000-4000-8000-000000000002";

type Reply = { status: number; body: unknown };

function recordingClient(replies: Reply[]) {
  const calls: URL[] = [];
  const fakeFetch = async (input: unknown) => {
    calls.push(new URL(String(input)));
    const r = replies.shift() ?? { status: 200, body: [] };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
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

const NONE: Reply = {
  status: 406,
  body: {
    code: "PGRST116",
    message: "JSON object requested, multiple (or no) rows returned",
    details: "The result contains 0 rows",
    hint: null,
  },
};
const one = (over: Record<string, unknown>): Reply => ({
  status: 200,
  body: {
    id: "w1",
    name: "House Red",
    producer: null,
    vintage: null,
    price_reference: null,
    primary_type: "red",
    grape_variety: null,
    country: null,
    region: null,
    appellation: null,
    provisional_for_restaurant_id: null,
    ...over,
  },
});

describe("GET /wines/:id is read in the session's house scope", () => {
  it("asks only for a shared row or this house's own", async () => {
    const { service, calls } = recordingClient([one({})]);
    await service.getWineById("w1", HOUSE);
    expect(calls[0].searchParams.get("id")).toBe("eq.w1");
    expect(calls[0].searchParams.getAll("or")).toEqual([
      `(${houseScopeFilter(HOUSE)})`,
    ]);
  });

  it("with no house, only the shared catalogue", async () => {
    const { service, calls } = recordingClient([one({})]);
    await service.getWineById("w1");
    expect(calls[0].searchParams.getAll("or")).toEqual([
      "(provisional_for_restaurant_id.is.null)",
    ]);
  });

  it("this house's own wine is found and says so", async () => {
    const { service } = recordingClient([
      one({ provisional_for_restaurant_id: HOUSE }),
    ]);
    const w = await service.getWineById("w1", HOUSE);
    expect(w).not.toBeNull();
    expect(w!.houseOwn).toBe(true);
  });

  it("another house's own wine is not found (PostgREST returns no row)", async () => {
    const { service } = recordingClient([NONE]);
    await expect(service.getWineById("w1", OTHER)).resolves.toBeNull();
  });

  it("an id that is not a uuid is not found, not a 500", async () => {
    const { service } = recordingClient([
      {
        status: 400,
        body: {
          code: "22P02",
          message: 'invalid input syntax for type uuid: "nope"',
          details: null,
          hint: null,
        },
      },
    ]);
    await expect(service.getWineById("nope", HOUSE)).resolves.toBeNull();
  });

  it("any other failure is still thrown", async () => {
    const { service } = recordingClient([
      {
        status: 500,
        body: { code: "XX000", message: "boom", details: null, hint: null },
      },
    ]);
    await expect(service.getWineById("w1", HOUSE)).rejects.toBeTruthy();
  });

  it("similar wines start from the seed only when this house may see it", async () => {
    const { service, calls } = recordingClient([NONE]);
    const out = await service.getSimilarWines(
      "w1",
      {} as SimilarWinesQueryDto,
      OTHER,
    );
    expect(out).toEqual([]);
    // One call: the seed read, scoped; nothing was listed from it.
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.getAll("or")).toEqual([
      `(${houseScopeFilter(OTHER)})`,
    ]);
  });
});

describe("WinesController.getById", () => {
  it("passes the session's house and says 404 for a row it may not see", async () => {
    const getWineById = jest.fn().mockResolvedValue(null);
    const controller = new WinesController(
      { getWineById } as any,
      {} as any,
      {} as any,
    );
    await expect(
      controller.getById("w1", { restaurantId: OTHER }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(getWineById).toHaveBeenCalledWith("w1", OTHER);
  });
});
