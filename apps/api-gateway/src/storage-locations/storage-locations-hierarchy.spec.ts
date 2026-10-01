import "reflect-metadata";
import { HttpException, HttpStatus } from "@nestjs/common";
import { StorageLocationsService } from "./storage-locations.service";

/**
 * Zones nest (founder answer 2026-09-29, "Add parent column (Recommended)":
 * "Add a parent_id column (one migration) so zones can nest, e.g. Cellar →
 * Rack A → Shelf 2."). Migration 20261203110000_a_zone_can_sit_inside_another_zone
 * adds storage_locations.parent_id and a database guard; this suite pins the
 * gateway half:
 *
 *  - a parent of the same restaurant is STORED on create and update (#510's
 *    422 is gone), and `parent_id: null` clears it;
 *  - reads return `parent_id`;
 *  - a parent in another restaurant, the zone itself, or a zone already
 *    inside this one (a cycle) is refused with a 422 and writes nothing;
 *  - the database's own refusal (the trigger's 23514) comes back as a 422 in
 *    its words, not a 500, for a path the gateway's pre-check did not see.
 */

const R1 = "11111111-1111-4111-8111-111111111111";
const CELLAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RACK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHELF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LOOSE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_HOUSE_ZONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** Restaurant R1's live zones: Cellar > Rack A > Shelf 2, plus a loose one. */
const R1_ZONES = [
  { id: CELLAR, parent_id: null },
  { id: RACK, parent_id: CELLAR },
  { id: SHELF, parent_id: RACK },
  { id: LOOSE, parent_id: null },
];

/**
 * A supabase chain. A `.select(...)` that is awaited without `.single()` is
 * the zone-tree read and answers the rows of the restaurant it was filtered
 * to; insert/update record their payload and answer one row through
 * `.single()`.
 */
function fakeDb(opts: { writeError?: { code: string; message: string } } = {}) {
  const writes: { op: string; payload: any }[] = [];
  const reads: { cols: string; filters: Record<string, unknown> }[] = [];
  const make = () => {
    const state: { cols?: string; filters: Record<string, unknown>; write?: any } = {
      filters: {},
    };
    const chain: any = {
      select: (cols: string) => {
        state.cols = cols;
        return chain;
      },
      insert: (payload: any) => {
        state.write = { op: "insert", payload };
        writes.push(state.write);
        return chain;
      },
      update: (payload: any) => {
        state.write = { op: "update", payload };
        writes.push(state.write);
        return chain;
      },
      eq: (k: string, v: unknown) => {
        state.filters[k] = v;
        return chain;
      },
      is: (k: string, v: unknown) => {
        state.filters[`is:${k}`] = v;
        return chain;
      },
      order: () => chain,
      single: async () => {
        if (opts.writeError) return { data: null, error: opts.writeError };
        const p = state.write?.payload ?? {};
        return {
          data: {
            id: state.filters.id ?? "new-zone",
            restaurant_id: R1,
            zone: p.zone ?? "Zone",
            capacity_bottles: 12,
            parent_id: p.parent_id ?? null,
          },
          error: null,
        };
      },
      // #516 moved updateLocation to `.maybeSingle()` (no row is a 404, not a
      // 500); every row this fake answers exists, so it answers like single().
      maybeSingle: async () => chain.single(),
      then: (resolve: any, reject: any) => {
        // An awaited write with no .single() (the soft delete) answers the
        // write error when one is configured.
        if (state.write && opts.writeError) {
          return Promise.resolve({ data: null, error: opts.writeError }).then(
            resolve,
            reject,
          );
        }
        reads.push({ cols: state.cols ?? "", filters: { ...state.filters } });
        const rows = state.filters.restaurant_id === R1 ? R1_ZONES : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  const supabase = { from: () => make() };
  return { dbService: { supabase } as any, writes, reads };
}

async function refusal(p: Promise<unknown>) {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
  return err as HttpException;
}

describe("a zone's parent is stored", () => {
  it("create with a same-restaurant parent inserts parent_id", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const out = await svc.createLocation(R1, {
      name: "Shelf 3",
      capacity: 12,
      parent_id: RACK,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ parent_id: RACK });
    expect(out).toMatchObject({ parent_id: RACK });
  });

  it("update with a same-restaurant parent writes parent_id", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const out = await svc.updateLocation(R1, LOOSE, { parent_id: CELLAR });
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ parent_id: CELLAR });
    expect(out).toMatchObject({ parent_id: CELLAR });
  });

  it("update with parent_id: null clears it (moves the zone to the top level)", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await svc.updateLocation(R1, SHELF, { parent_id: null });
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toHaveProperty("parent_id", null);
  });

  it("an update that does not mention parent_id leaves it alone", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await svc.updateLocation(R1, SHELF, { name: "Shelf Two" });
    expect(writes[0].payload).not.toHaveProperty("parent_id");
  });

  it("reads return parent_id (null for a top-level zone)", async () => {
    const { dbService } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    // listLocations reads select("*"); the fake answers R1's rows.
    const rows = await svc.listLocations(R1);
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    expect(byId[RACK]).toHaveProperty("parent_id", CELLAR);
    expect(byId[CELLAR]).toHaveProperty("parent_id", null);
  });
});

describe("a parent the tree cannot hold is refused, and nothing is written", () => {
  it("a parent in another restaurant (create)", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const err = await refusal(
      svc.createLocation(R1, {
        name: "Rack Z",
        capacity: 12,
        parent_id: OTHER_HOUSE_ZONE,
      }),
    );
    expect(err.message).toMatch(/not a zone of this restaurant/i);
    expect(writes).toHaveLength(0);
  });

  it("a parent in another restaurant (update)", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await refusal(
      svc.updateLocation(R1, LOOSE, { parent_id: OTHER_HOUSE_ZONE }),
    );
    expect(writes).toHaveLength(0);
  });

  it("the zone itself", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const err = await refusal(
      svc.updateLocation(R1, RACK, { parent_id: RACK }),
    );
    expect(err.message).toMatch(/inside itself/i);
    expect(writes).toHaveLength(0);
  });

  it("a cycle: Cellar cannot go inside Shelf 2, which is inside it", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const err = await refusal(
      svc.updateLocation(R1, CELLAR, { parent_id: SHELF }),
    );
    expect(err.message).toMatch(/inside this zone/i);
    expect(writes).toHaveLength(0);
  });

  it("the tree read is scoped to the restaurant and to live zones", async () => {
    const { dbService, reads } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await svc.updateLocation(R1, LOOSE, { parent_id: CELLAR });
    expect(reads[0].filters).toMatchObject({
      restaurant_id: R1,
      "is:deleted_at": null,
    });
  });

  it("the database's own refusal (23514) is a 422 in its words, not a 500", async () => {
    const { dbService } = fakeDb({
      writeError: {
        code: "23514",
        message:
          "That parent is already inside this zone; a zone cannot sit inside its own contents.",
      },
    });
    const svc = new StorageLocationsService(dbService);
    const err = await refusal(
      svc.updateLocation(R1, LOOSE, { parent_id: CELLAR }),
    );
    expect(err.message).toMatch(/already inside this zone/);
  });
});

/**
 * Verifier nit on #515 (2026-09-29): a soft delete of a parent and a
 * concurrent move of a zone under it take their locks in opposite orders
 * (the delete holds the parent's row and its orphan trigger then waits for
 * the child's row and the house's advisory lock; the move holds the child's
 * row and the advisory lock and waits to FOR SHARE the parent), so Postgres
 * aborts one with 40P01. Nothing was written by the aborted one, and trying
 * again succeeds, so it is a 409 that says so, not a 500.
 */
describe("a write that lost a lock race is a retryable 409, not a 500", () => {
  const deadlock = {
    code: "40P01",
    message: "deadlock detected",
  };

  async function conflict(p: Promise<unknown>) {
    const err = await p.then(
      () => undefined,
      (e) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((err as HttpException).message).toMatch(/at the same moment/i);
    expect((err as HttpException).message).toMatch(/try again/i);
    return err as HttpException;
  }

  it("a zone move that deadlocked (40P01) is a 409 that says try again", async () => {
    const { dbService } = fakeDb({ writeError: deadlock });
    const svc = new StorageLocationsService(dbService);
    await conflict(svc.updateLocation(R1, LOOSE, { parent_id: CELLAR }));
  });

  it("a soft delete that deadlocked (40P01) is a 409 that says try again", async () => {
    const { dbService } = fakeDb({ writeError: deadlock });
    const svc = new StorageLocationsService(dbService);
    await conflict(svc.deleteLocation(R1, CELLAR));
  });

  it("a serialization failure (40001) is the same retryable 409", async () => {
    const { dbService } = fakeDb({
      writeError: { code: "40001", message: "could not serialize access" },
    });
    const svc = new StorageLocationsService(dbService);
    await conflict(svc.createLocation(R1, { name: "Rack Z", capacity: 12, parent_id: CELLAR }));
  });

  it("any other failed delete is still a 500", async () => {
    const { dbService } = fakeDb({
      writeError: { code: "08006", message: "connection failure" },
    });
    const svc = new StorageLocationsService(dbService);
    const err = await svc.deleteLocation(R1, CELLAR).then(
      () => undefined,
      (e) => e,
    );
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});
