/**
 * Branches and chains carry the date the database already holds.
 *
 * WHAT WAS WRONG (p4 `/settings` audit, BLOCKERs 2 and 3)
 * -------------------------------------------------------
 * The rebuilt `/settings` Locations register printed "the chains table records
 * no last-changed date" and "the branch record carries no last-changed date".
 * Both were false about the database and true only about the wire:
 *
 *   - `restaurant_chains.updated_at` — `NOT NULL DEFAULT now()`
 *     (`supabase/migrations/20260805000000_baseline_from_production.sql:5053-5060`);
 *     `getChainsForUser` selected `"id, name, cuisine_type"`.
 *   - `restaurants.updated_at` — present (`baseline:3566-3583`) AND maintained
 *     by `update_restaurants_updated_at BEFORE UPDATE` (`baseline:12300`);
 *     `getBranchesForUser` selected everything but it.
 *
 * A page cannot invent a date it was never handed, so the em dash was the only
 * honest thing the page could print — which made this a gateway defect wearing
 * a copy defect's clothes.
 *
 * THE HALF THAT IS EASY TO GET WRONG
 * ----------------------------------
 * Selecting `restaurant_chains.updated_at` alone would have been WORSE than the
 * em dash. That table has no `BEFORE UPDATE` trigger — in the whole baseline
 * `update_updated_at_column` is attached to `restaurants` (:12300) and
 * `user_preferences` (:12342), never to `restaurant_chains` — so the column
 * would have held the row's creation time for ever and the page would have
 * printed a creation date under the words "changed". `renameChain` therefore
 * stamps `updated_at` itself, and that stamp is asserted below: it is the line
 * that makes the returned column mean what its label says.
 */

import { OrganizationsService } from "./organizations.service";
import { DatabaseService } from "../database/database.service";

interface Rows {
  orgMembers?: { organization_id: string }[];
  chains?: Record<string, unknown>[];
  restaurants?: Record<string, unknown>[];
  ura?: Record<string, unknown>[];
  /** Row answered by `.maybeSingle()` / `.single()` on `restaurant_chains`. */
  chainRow?: Record<string, unknown> | null;
}

interface Probe {
  selects: { table: string; columns: string }[];
  updates: { table: string; patch: Record<string, unknown> }[];
}

function makeService(rows: Rows): {
  service: OrganizationsService;
  probe: Probe;
} {
  const probe: Probe = { selects: [], updates: [] };

  const from = (table: string) => {
    let op: "select" | "update" | "insert" = "select";

    const listResult = () => {
      if (op !== "select") return { data: null, error: null };
      switch (table) {
        case "organization_members":
          return { data: rows.orgMembers ?? [], error: null };
        case "restaurant_chains":
          return { data: rows.chains ?? [], error: null };
        case "restaurants":
          return { data: rows.restaurants ?? [], error: null };
        case "user_restaurant_access":
          return { data: rows.ura ?? [], error: null };
        default:
          return { data: [], error: null };
      }
    };

    const singleResult = () => {
      if (table === "restaurant_chains")
        return { data: rows.chainRow ?? null, error: null };
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {
      select(cols: string) {
        probe.selects.push({ table, columns: cols });
        return builder;
      },
      update(patch: Record<string, unknown>) {
        op = "update";
        probe.updates.push({ table, patch });
        return builder;
      },
      insert() {
        op = "insert";
        return builder;
      },
      upsert: () => Promise.resolve({ data: null, error: null }),
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(singleResult()),
      single: () => Promise.resolve(singleResult()),
      // `getUserOrgIds` and the list reads await the builder itself.
      then: (resolve: (v: unknown) => unknown) => resolve(listResult()),
    };
    return builder;
  };

  const db = { supabase: { from } } as unknown as DatabaseService;
  return { service: new OrganizationsService(db), probe };
}

const ORG = [{ organization_id: "org-1" }];

describe("chains carry their own last-changed date", () => {
  it("asks for updated_at and hands it to the caller", async () => {
    const { service, probe } = makeService({
      orgMembers: ORG,
      chains: [
        {
          id: "c1",
          name: "Harbour Group",
          cuisine_type: "seafood",
          updated_at: "2026-08-30T10:00:00.000Z",
        },
      ],
    });

    const chains = await service.getChainsForUser("u1");

    expect(
      probe.selects.find((s) => s.table === "restaurant_chains")?.columns,
    ).toContain("updated_at");
    expect(chains).toEqual([
      {
        id: "c1",
        name: "Harbour Group",
        cuisine_type: "seafood",
        updated_at: "2026-08-30T10:00:00.000Z",
      },
    ]);
  });

  it("keeps a missing date missing rather than substituting now()", async () => {
    const { service } = makeService({
      orgMembers: ORG,
      chains: [{ id: "c1", name: "Harbour Group", cuisine_type: null }],
    });

    const [chain] = await service.getChainsForUser("u1");
    expect(chain.updated_at).toBeNull();
  });

  it("stamps updated_at on a rename, because the table has no trigger", async () => {
    const { service, probe } = makeService({
      orgMembers: ORG,
      chainRow: { id: "c1" },
    });

    const before = Date.now();
    await service.renameChain("u1", "c1", "  Harbour Collective  ");
    const after = Date.now();

    const patch = probe.updates.find((u) => u.table === "restaurant_chains")
      ?.patch as { name: string; updated_at: string };
    expect(patch.name).toBe("Harbour Collective");
    const stamped = Date.parse(patch.updated_at);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});

describe("branches carry their own last-changed date", () => {
  it("asks for updated_at on the organisation path and maps it", async () => {
    const { service, probe } = makeService({
      orgMembers: ORG,
      restaurants: [
        {
          id: "r1",
          name: "Kadıköy",
          city: "Istanbul",
          chain_id: "c1",
          updated_at: "2026-09-01T08:30:00.000Z",
          restaurant_chains: { name: "Harbour Group" },
        },
      ],
    });

    const branches = await service.getBranchesForUser("u1");

    expect(
      probe.selects.find((s) => s.table === "restaurants")?.columns,
    ).toContain("updated_at");
    expect(branches).toEqual([
      {
        id: "r1",
        name: "Kadıköy",
        city: "Istanbul",
        chain_id: "c1",
        chain_name: "Harbour Group",
        updated_at: "2026-09-01T08:30:00.000Z",
      },
    ]);
  });

  it("asks for it on the legacy access path too", async () => {
    // A branch reachable only through `user_restaurant_access` is exactly the
    // account this fallback exists for; it must not be the one that loses the
    // date and prints an em dash beside branches that have one.
    const { service, probe } = makeService({
      orgMembers: [],
      restaurants: [],
      ura: [
        {
          restaurant_id: "r9",
          restaurants: {
            id: "r9",
            name: "Beşiktaş",
            city: null,
            chain_id: null,
            updated_at: "2026-08-11T12:00:00.000Z",
            restaurant_chains: null,
          },
        },
      ],
    });

    const branches = await service.getBranchesForUser("u1");

    expect(
      probe.selects.find((s) => s.table === "user_restaurant_access")?.columns,
    ).toContain("updated_at");
    expect(branches[0].updated_at).toBe("2026-08-11T12:00:00.000Z");
    expect(branches[0].city).toBeNull();
  });
});
