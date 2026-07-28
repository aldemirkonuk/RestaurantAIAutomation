import { NotFoundException } from "@nestjs/common";
import { DistributorDiscoveryService } from "./distributor-discovery.service";

const RESTAURANT_ID = "33333333-3333-3333-3333-333333333333";

/**
 * Chainable Supabase stub, following notifications/low-stock-alerts.service.spec.ts.
 * The `then` key is what makes a chain awaitable — PostgREST builders are thenables.
 */
function makeDb(opts: {
  rpc?: jest.Mock;
  rows?: Record<string, unknown[]>;
  single?: unknown;
}) {
  const rows = opts.rows ?? {};

  const makeChain = (table: string): any => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: opts.single === undefined ? null : opts.single, error: null }),
      then: (resolve: any) => resolve({ data: rows[table] ?? [], error: null }),
    };
    return chain;
  };

  const client = {
    from: (t: string) => makeChain(t),
    rpc: opts.rpc ?? jest.fn().mockResolvedValue({ data: [], error: null }),
  };

  return { getClient: () => client, supabase: client, client } as any;
}

describe("DistributorDiscoveryService", () => {
  describe("search", () => {
    it("passes the restaurant from the caller, never from the query", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await svc.search(RESTAURANT_ID, {});

      expect(rpc).toHaveBeenCalledWith(
        "search_distributors",
        expect.objectContaining({ p_restaurant_id: RESTAURANT_ID }),
      );
    });

    it("gates on territory by default", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await svc.search(RESTAURANT_ID, {});

      expect(rpc.mock.calls[0][1].p_territory_only).toBe(true);
    });

    it("honours an explicit request to drop the territory gate", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await svc.search(RESTAURANT_ID, { territoryOnly: false });

      expect(rpc.mock.calls[0][1].p_territory_only).toBe(false);
    });

    it("escapes LIKE wildcards in the free-text term", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await svc.search(RESTAURANT_ID, { q: "100%" });

      expect(rpc.mock.calls[0][1].p_q).toBe("100\\%");
    });

    it("converts repeated facet params into the grouped jsonb shape", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await svc.search(RESTAURANT_ID, {
        facet: ["region:burgundy", "region:rhone", "varietal:pinot-noir"],
      });

      expect(rpc.mock.calls[0][1].p_facets).toEqual({
        region: ["burgundy", "rhone"],
        varietal: ["pinot-noir"],
      });
    });

    it("drops a partial viewport rather than half-applying it", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await svc.search(RESTAURANT_ID, { minLng: -74.1, minLat: 40.6, maxLng: -73.9 });

      const args = rpc.mock.calls[0][1];
      expect(args.p_bbox_min_lng).toBeNull();
      expect(args.p_bbox_max_lat).toBeNull();
    });

    it("reads the window count off the first row and strips it from the payload", async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          { id: "a", name: "Skurnik", distance_m: 1300, total_count: 13 },
          { id: "b", name: "Empire", distance_m: 16800, total_count: 13 },
        ],
        error: null,
      });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      const res = await svc.search(RESTAURANT_ID, {});

      expect(res.total).toBe(13);
      expect(res.data).toHaveLength(2);
      expect(res.data[0]).not.toHaveProperty("total_count");
    });

    it("reports zero total for an empty page", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      const res = await svc.search(RESTAURANT_ID, {});

      expect(res).toMatchObject({ total: 0, data: [] });
    });

    it("rethrows RPC failures rather than returning an empty result", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      await expect(svc.search(RESTAURANT_ID, {})).rejects.toMatchObject({ message: "boom" });
    });
  });

  describe("findById", () => {
    it("raises NotFound for an unknown or inactive distributor", async () => {
      const svc = new DistributorDiscoveryService(makeDb({ single: null }));

      await expect(svc.findById("missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the vendor with its locations, territories and facets", async () => {
      const svc = new DistributorDiscoveryService(
        makeDb({
          single: { id: "v1", name: "Skurnik Wines & Spirits" },
          rows: {
            vendor_locations: [{ id: "l1", kind: "warehouse" }],
            vendor_service_territories: [{ country: "US", admin_area_code: "NY" }],
            vendor_portfolio_facets: [
              { facet_kind: "region", facet_slug: "burgundy", facet_value: "Burgundy" },
            ],
          },
        }),
      );

      const detail = await svc.findById("v1");

      expect(detail.vendor).toMatchObject({ name: "Skurnik Wines & Spirits" });
      expect(detail.locations).toHaveLength(1);
      expect(detail.territories).toHaveLength(1);
      expect(detail.facets.region[0]).toMatchObject({ slug: "burgundy", value: "Burgundy" });
    });
  });

  describe("facetCounts", () => {
    it("groups counts by kind", async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          { facet_kind: "region", facet_slug: "burgundy", facet_value: "Burgundy", vendors: 4 },
        ],
        error: null,
      });
      const svc = new DistributorDiscoveryService(makeDb({ rpc }));

      const facets = await svc.facetCounts(RESTAURANT_ID, {});

      expect(facets.region).toEqual([{ slug: "burgundy", value: "Burgundy", vendors: 4 }]);
    });
  });
});
