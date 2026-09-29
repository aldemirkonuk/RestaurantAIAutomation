import "reflect-metadata";
import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { StorageLocationsController } from "./storage-locations.controller";
import { StorageLocationsService } from "./storage-locations.service";

/**
 * Storage locations answer only for the caller's house (ADR 0147).
 *
 * The lane that asked for this (found by the #510 builder and verifier) read
 * the controller's `@UseGuards(JwtAuthGuard)` as "authentication only". It is
 * more than that: `JwtAuthGuard` runs `assertTenantMatch` right after passport
 * (`auth/guards/jwt-auth.guard.ts`), which refuses any `:restaurantId` in the
 * path that is not the house the token names, and the strategy has already
 * refused a token naming a house the person is not a member of. So part 1 is
 * a PIN, not a fix: it drives the real guard over every route this controller
 * declares — enumerated from Nest's own metadata, so a route added later is
 * covered without editing this file — and holds on `main`. Removing the
 * `assertTenantMatch` call from the guard turns every "house B" case red.
 *
 * Part 2 is the fix. The path's house was checked; the ids AFTER it were not
 * checked against it. A location id from another house (or none) was taken on
 * trust: a mapping could point at house B's zone, B's zone could be "read" as
 * empty, a delete of B's zone answered `{ success: true }` having touched
 * nothing, and an update answered 500 from `.single()` finding no row. Each
 * now answers 404 — identical to a missing id, so it does not confirm that
 * another house's id exists (ADR 0147, review round 2) — and writes nothing.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const ZONE_OF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ZONE_OF_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WINE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/* ── part 1: the real guard, over every declared route ───────────────── */

type Route = { handler: string; method: number; path: string };

function declaredRoutes(): Route[] {
  const proto = StorageLocationsController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .filter((name) => Reflect.hasMetadata(PATH_METADATA, proto[name] as object))
    .map((name) => ({
      handler: name,
      method: Reflect.getMetadata(METHOD_METADATA, proto[name] as object),
      path: Reflect.getMetadata(PATH_METADATA, proto[name] as object),
    }));
}

function paramsFor(path: string, restaurantId: string) {
  const params: Record<string, string> = {};
  for (const segment of path.split("/")) {
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    params[name] =
      name === "restaurantId"
        ? restaurantId
        : name === "locationId"
          ? ZONE_OF_A
          : WINE;
  }
  return params;
}

function contextFor(route: Route, restaurantId: string) {
  const handler = (
    StorageLocationsController.prototype as unknown as Record<string, unknown>
  )[route.handler] as () => unknown;
  const request = {
    headers: {},
    params: paramsFor(route.path, restaurantId),
    query: {},
    body: { wineId: WINE, locationId: ZONE_OF_A, name: "Cellar", capacity: 10 },
    user: {
      userId: "user-of-a",
      restaurantId: HOUSE_A,
      role: "staff",
      emailVerified: true,
    },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => StorageLocationsController,
  } as never;
}

function realGuard() {
  // The real Reflector, so a stray @Public() or @AllowsTenantChange() on a
  // route would be read exactly as Nest reads it.
  const guard = new JwtAuthGuard(new Reflector(), {
    isBlacklisted: jest.fn().mockResolvedValue(false),
  } as never);
  // Stand in for passport only: report success, leave request.user as seeded.
  const passport = Object.getPrototypeOf(Object.getPrototypeOf(guard));
  jest.spyOn(passport, "canActivate").mockResolvedValue(true as never);
  return guard;
}

describe("storage-locations — the path's house is the caller's (pin)", () => {
  afterEach(() => jest.restoreAllMocks());

  const routes = declaredRoutes();

  it("declares the eight routes the web calls, all under :restaurantId", () => {
    expect(routes.map((r) => r.handler).sort()).toEqual(
      [
        "assignWineToLocation",
        "createLocation",
        "deleteLocation",
        "getWinesAtLocation",
        "listLocations",
        "listMappings",
        "removeWineFromLocation",
        "updateLocation",
      ].sort(),
    );
    for (const r of routes) expect(r.path.split("/")[0]).toBe(":restaurantId");
  });

  it("puts JwtAuthGuard on the whole class", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StorageLocationsController),
    ).toContain(JwtAuthGuard);
  });

  it.each(routes.map((r) => [r.handler, r] as const))(
    "%s refuses house B's id in the path with 403",
    async (_name, route) => {
      await expect(
        realGuard().canActivate(contextFor(route, HOUSE_B)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each(routes.map((r) => [r.handler, r] as const))(
    "%s admits the caller's own house",
    async (_name, route) => {
      await expect(
        realGuard().canActivate(contextFor(route, HOUSE_A)),
      ).resolves.toBe(true);
    },
  );
});

/* ── part 2: the ids after the house are checked against it ──────────── */

type Rows = Record<string, Array<Record<string, unknown>>>;

/**
 * A Supabase stand-in that actually applies eq/is filters to seeded rows, so
 * a query missing its house filter returns the other house's row and the test
 * sees it. Writes are recorded, never applied.
 */
function fakeDb(rows: Rows) {
  const writes: Array<{ table: string; op: string; values?: unknown }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let op = "select";
    let values: unknown;
    const matched = () =>
      (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const result = (mode: "many" | "single" | "maybe") => {
      if (op !== "select") writes.push({ table, op, values });
      if (op === "insert" || op === "upsert") {
        return { data: values, error: null };
      }
      const hit = matched();
      if (mode === "many") return { data: hit, error: null };
      if (mode === "maybe") return { data: hit[0] ?? null, error: null };
      return hit.length === 1
        ? { data: hit[0], error: null }
        : {
            data: null,
            error: {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
            },
          };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (v: unknown) => ((op = "insert"), (values = v), q),
      update: (v: unknown) => ((op = "update"), (values = v), q),
      upsert: (v: unknown) => ((op = "upsert"), (values = v), q),
      delete: () => ((op = "delete"), q),
      eq: (col: string, val: unknown) => (
        filters.push((r) => r[col] === val),
        q
      ),
      is: (col: string, val: unknown) => (
        filters.push((r) => (r[col] ?? null) === val),
        q
      ),
      in: (col: string, vals: unknown[]) => (
        filters.push((r) => vals.includes(r[col])),
        q
      ),
      order: () => q,
      single: async () => result("single"),
      maybeSingle: async () => result("maybe"),
      then: (resolve: (v: unknown) => unknown) => resolve(result("many")),
    };
    return q;
  };
  return { db: { supabase: { from } } as never, writes };
}

function seeded() {
  return fakeDb({
    storage_locations: [
      {
        id: ZONE_OF_A,
        restaurant_id: HOUSE_A,
        zone: "A cellar",
        deleted_at: null,
      },
      {
        id: ZONE_OF_B,
        restaurant_id: HOUSE_B,
        zone: "B cellar",
        deleted_at: null,
      },
    ],
    wine_location_mappings: [
      {
        id: "m-b",
        restaurant_id: HOUSE_B,
        wine_id: WINE,
        location_id: ZONE_OF_B,
      },
    ],
    master_wine_library: [{ id: WINE, wine_name: "W" }],
  });
}

async function statusOf(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

describe("storage-locations — another house's location id is a 404", () => {
  it("assigning a wine to house B's zone is refused, nothing written", async () => {
    const { db, writes } = seeded();
    const svc = new StorageLocationsService(db);
    expect(
      await statusOf(
        svc.assignWineToLocation(HOUSE_A, {
          wineId: WINE,
          locationId: ZONE_OF_B,
        } as never),
      ),
    ).toBe(HttpStatus.NOT_FOUND);
    expect(writes).toEqual([]);
  });

  it("reading the wines at house B's zone is a 404, not an empty zone", async () => {
    const { db } = seeded();
    const svc = new StorageLocationsService(db);
    expect(await statusOf(svc.getWinesAtLocation(HOUSE_A, ZONE_OF_B))).toBe(
      HttpStatus.NOT_FOUND,
    );
  });

  it("updating house B's zone is a 404, not a 500", async () => {
    const { db } = seeded();
    const svc = new StorageLocationsService(db);
    expect(
      await statusOf(
        svc.updateLocation(HOUSE_A, ZONE_OF_B, { name: "mine now" } as never),
      ),
    ).toBe(HttpStatus.NOT_FOUND);
  });

  it("deleting house B's zone is a 404, not { success: true }", async () => {
    const { db } = seeded();
    const svc = new StorageLocationsService(db);
    expect(await statusOf(svc.deleteLocation(HOUSE_A, ZONE_OF_B))).toBe(
      HttpStatus.NOT_FOUND,
    );
  });

  it("the caller's own zone still assigns, reads, updates and deletes", async () => {
    const { db, writes } = seeded();
    const svc = new StorageLocationsService(db);
    expect(
      await statusOf(
        svc.assignWineToLocation(HOUSE_A, {
          wineId: WINE,
          locationId: ZONE_OF_A,
        } as never),
      ),
    ).not.toBe(HttpStatus.NOT_FOUND);
    expect(writes.some((w) => w.op === "upsert")).toBe(true);
    await expect(svc.getWinesAtLocation(HOUSE_A, ZONE_OF_A)).resolves.toEqual(
      [],
    );
    await expect(
      svc.updateLocation(HOUSE_A, ZONE_OF_A, { name: "Renamed" } as never),
    ).resolves.toMatchObject({ id: ZONE_OF_A });
    await expect(svc.deleteLocation(HOUSE_A, ZONE_OF_A)).resolves.toEqual({
      success: true,
    });
  });

  it("house B's mappings never appear in house A's list", async () => {
    const { db } = seeded();
    const svc = new StorageLocationsService(db);
    await expect(svc.listMappings(HOUSE_A)).resolves.toEqual([]);
  });
});
