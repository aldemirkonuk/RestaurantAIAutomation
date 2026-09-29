import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { StorageLocationsController } from "./storage-locations.controller";
import { StorageLocationsService } from "./storage-locations.service";
import { ZonesService } from "../cellar/zones.service";

/**
 * Who may set up a zone (ADR 0238). The founder, 2026-09-29, asked "who may
 * create, rename, resize or delete a zone, and who may place wines in zones?
 * Today every house member can do all of it", answered verbatim:
 *
 *   "managers/owners+ the people they assign"
 *
 * So a zone SETUP write — create, rename, resize (capacity), any other field
 * of the zone, delete, and a rename through the cellar floor — is an owner's,
 * a manager's, or a staff member's whom an owner or manager assigned
 * (`user_restaurant_access.zone_setup_access`). Anyone else is refused 403
 * with nothing written. Placing and counting wines are NOT gated: the answer
 * does not separate them, so they stay open to every member as before and the
 * question is OD-200.
 *
 * Part 1 drives the real controller (and the cellar's ZonesService) over a
 * fake client that applies eq/is filters to seeded rows, so a gate that read
 * the wrong house or the wrong person would be seen. Part 2 is the grant: only
 * an owner or a manager of the same house assigns or withdraws it, only a
 * staff member is assigned, and every change is an audit row and a notice.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const ZONE_OF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WINE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const OWNER = "0a000000-0000-4000-8000-00000000000a";
const MANAGER = "0b000000-0000-4000-8000-00000000000b";
const STAFF = "0c000000-0000-4000-8000-00000000000c";
const ASSIGNED = "0d000000-0000-4000-8000-00000000000d";
const OTHER_HOUSE_STAFF = "0e000000-0000-4000-8000-00000000000e";
const MANAGER_OF_B = "0f000000-0000-4000-8000-00000000000f";

type Row = Record<string, unknown>;
type Rows = Record<string, Row[]>;
type Write = { table: string; op: string; values?: unknown };

/**
 * Applies eq/is/in filters to seeded rows; UPDATEs are applied to the matched
 * rows (so a grant is visible to the next read), inserts are appended, and
 * every write is recorded. `failReads` makes a SELECT on that table answer an
 * error, to prove an unreadable role or switch refuses instead of passing.
 */
function fakeDb(rows: Rows, failReads: string[] = []) {
  const writes: Write[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op = "select";
    let values: unknown;
    const matched = () =>
      (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const result = (mode: "many" | "single" | "maybe") => {
      if (op === "select" && failReads.includes(table)) {
        return { data: null, error: { message: `${table} is unreadable` } };
      }
      if (op !== "select") writes.push({ table, op, values });
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(values) ? values : [values];
        rows[table] = [...(rows[table] ?? []), ...(list as Row[])];
        return { data: mode === "many" ? list : list[0], error: null };
      }
      const hit = matched();
      if (op === "update") {
        for (const r of hit) Object.assign(r, values as Row);
      }
      if (op === "delete") {
        rows[table] = (rows[table] ?? []).filter((r) => !hit.includes(r));
      }
      if (mode === "many") return { data: hit, error: null };
      if (mode === "maybe") return { data: hit[0] ?? null, error: null };
      return hit.length === 1
        ? { data: hit[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } };
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
  const supabase = { from };
  return {
    db: { supabase, getClient: () => supabase } as never,
    writes,
    rows,
  };
}

function access(
  userId: string,
  restaurantId: string,
  role: string,
  zoneSetupAccess = false,
): Row {
  return {
    user_id: userId,
    restaurant_id: restaurantId,
    role,
    is_active: true,
    zone_setup_access: zoneSetupAccess,
  };
}

function house(failReads: string[] = []) {
  return fakeDb(
    {
      user_restaurant_access: [
        access(OWNER, HOUSE_A, "owner"),
        access(MANAGER, HOUSE_A, "manager"),
        access(STAFF, HOUSE_A, "staff"),
        access(ASSIGNED, HOUSE_A, "staff", true),
        access(OTHER_HOUSE_STAFF, HOUSE_B, "staff"),
        access(MANAGER_OF_B, HOUSE_B, "manager"),
      ],
      users: [],
      storage_locations: [
        {
          id: ZONE_OF_A,
          restaurant_id: HOUSE_A,
          zone: "A cellar",
          deleted_at: null,
        },
      ],
      wine_location_mappings: [],
      system_audit_log: [],
      notifications: [],
    },
    failReads,
  );
}

function asUser(userId: string, role = "staff") {
  return { userId, restaurantId: HOUSE_A, role };
}

async function statusOf(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

function build(failReads: string[] = []) {
  const h = house(failReads);
  const svc = new StorageLocationsService(h.db);
  const ctl = new StorageLocationsController(svc);
  const zones = new ZonesService(h.db);
  return { ...h, svc, ctl, zones };
}

const zoneWrites = (writes: Write[]) =>
  writes.filter((w) => w.table === "storage_locations");

/** Every zone setup write the web or the floor can make, as one caller. */
const SETUP_ROUTES: Array<
  [string, (b: ReturnType<typeof build>, userId: string) => Promise<unknown>]
> = [
  [
    "create",
    (b, u) =>
      b.ctl.createLocation(asUser(u), HOUSE_A, {
        name: "New rack",
        capacity: 24,
      } as never),
  ],
  [
    "rename",
    (b, u) =>
      b.ctl.updateLocation(asUser(u), HOUSE_A, ZONE_OF_A, {
        name: "Renamed",
      } as never),
  ],
  [
    "resize",
    (b, u) =>
      b.ctl.updateLocation(asUser(u), HOUSE_A, ZONE_OF_A, {
        capacity: 12,
      } as never),
  ],
  [
    "re-parent",
    (b, u) =>
      b.ctl.updateLocation(asUser(u), HOUSE_A, ZONE_OF_A, {
        parent_id: "99999999-9999-4999-8999-999999999999",
      } as never),
  ],
  [
    "a count sent with a rename",
    (b, u) =>
      b.ctl.updateLocation(asUser(u), HOUSE_A, ZONE_OF_A, {
        current_count: 3,
        name: "Sneaky",
      } as never),
  ],
  ["delete", (b, u) => b.ctl.deleteLocation(asUser(u), HOUSE_A, ZONE_OF_A)],
  [
    "rename on the cellar floor",
    (b, u) => b.zones.confirm(HOUSE_A, ZONE_OF_A, "Floor name", u),
  ],
];

describe("zone setup — refused to a member nobody assigned (403, nothing written)", () => {
  it.each(SETUP_ROUTES)("%s: staff without the grant is 403", async (_n, call) => {
    const b = build();
    expect(await statusOf(call(b, STAFF))).toBe(403);
    expect(zoneWrites(b.writes)).toEqual([]);
  });

  it.each(SETUP_ROUTES)(
    "%s: another house's staff is 403 here too",
    async (_n, call) => {
      const b = build();
      expect(await statusOf(call(b, OTHER_HOUSE_STAFF))).toBe(403);
      expect(zoneWrites(b.writes)).toEqual([]);
    },
  );

  it.each(SETUP_ROUTES)(
    "%s: a role that cannot be read is a 500, never a pass",
    async (_n, call) => {
      const b = build(["user_restaurant_access"]);
      expect(await statusOf(call(b, STAFF))).toBe(500);
      expect(zoneWrites(b.writes)).toEqual([]);
    },
  );

  it("a session naming nobody is 403 on a setup write", async () => {
    const b = build();
    expect(
      await statusOf(
        b.ctl.createLocation({} as never, HOUSE_A, {
          name: "x",
          capacity: 1,
        } as never),
      ),
    ).toBe(403);
    expect(await statusOf(b.zones.confirm(HOUSE_A, ZONE_OF_A, "x", null))).toBe(
      403,
    );
    expect(zoneWrites(b.writes)).toEqual([]);
  });
});

describe("zone setup — admitted to owners, managers and the people they assign", () => {
  for (const [who, userId] of [
    ["owner", OWNER],
    ["manager", MANAGER],
    ["assigned staff", ASSIGNED],
  ] as const) {
    it.each(SETUP_ROUTES)(`%s: ${who} is admitted`, async (_n, call) => {
      const b = build();
      expect(await statusOf(call(b, userId))).toBe(200);
      expect(zoneWrites(b.writes).length).toBeGreaterThan(0);
    });
  }
});

describe("placing and counting stay open to every member (OD-200)", () => {
  it("staff without the grant may count a zone, place, and remove a wine", async () => {
    const b = build();
    await expect(
      b.ctl.updateLocation(asUser(STAFF), HOUSE_A, ZONE_OF_A, {
        current_count: 5,
      } as never),
    ).resolves.toMatchObject({ id: ZONE_OF_A });
    await expect(
      b.ctl.assignWineToLocation(HOUSE_A, {
        wineId: WINE,
        locationId: ZONE_OF_A,
        quantity: 2,
      } as never),
    ).resolves.toMatchObject({ locationId: ZONE_OF_A });
    await expect(
      b.ctl.removeWineFromLocation(HOUSE_A, WINE),
    ).resolves.toEqual({ success: true });
  });

  it("confirming a zone's detected name without renaming it stays open", async () => {
    const b = build();
    await expect(
      b.zones.confirm(HOUSE_A, ZONE_OF_A, null, STAFF),
    ).resolves.toMatchObject({ provenance: "confirmed" });
  });
});

describe("GET setup-access — what the web reads to show or hide the controls", () => {
  it("answers each caller for themself", async () => {
    const b = build();
    await expect(b.ctl.readSetupAccess(asUser(STAFF), HOUSE_A)).resolves.toMatchObject({
      mine: { allowed: false, via: null },
      assigned: null,
    });
    await expect(b.ctl.readSetupAccess(asUser(ASSIGNED), HOUSE_A)).resolves.toMatchObject({
      mine: { allowed: true, via: "assigned" },
      assigned: null,
    });
    await expect(b.ctl.readSetupAccess(asUser(OWNER), HOUSE_A)).resolves.toMatchObject({
      mine: { allowed: true, via: "house_role" },
    });
  });

  it("lists who is assigned to an owner or manager, and to nobody else", async () => {
    const b = build();
    const seen = await b.ctl.readSetupAccess(asUser(MANAGER), HOUSE_A);
    expect(seen.assigned).toEqual([ASSIGNED]);
    const staffSees = await b.ctl.readSetupAccess(asUser(ASSIGNED), HOUSE_A);
    expect(staffSees.assigned).toBeNull();
  });
});

describe("the grant — only an owner or manager of the same house assigns it", () => {
  const grant = (b: ReturnType<typeof build>, actor: string, target: string, allowed: boolean) =>
    b.ctl.setSetupAccess(asUser(actor), HOUSE_A, target, { allowed } as never);
  const accessOf = (b: ReturnType<typeof build>, userId: string) =>
    b.rows.user_restaurant_access.find(
      (r) => r.user_id === userId && r.restaurant_id === HOUSE_A,
    );

  it.each([
    ["an owner", OWNER],
    ["a manager", MANAGER],
  ])("%s assigns a staff member, audited and told", async (_n, actor) => {
    const b = build();
    await expect(grant(b, actor, STAFF, true)).resolves.toMatchObject({
      userId: STAFF,
      allowed: true,
      changed: true,
      audited: true,
      notified: true,
    });
    expect(accessOf(b, STAFF)?.zone_setup_access).toBe(true);
    const audit = b.rows.system_audit_log;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "zone_setup_access_changed",
      actor_id: actor,
      entity_type: "restaurant_member",
      entity_id: STAFF,
      restaurant_id: HOUSE_A,
      changes: { zone_setup_access: { from: false, to: true } },
    });
    expect(b.rows.notifications[0]).toMatchObject({ user_id: STAFF });
    // …and the person can now set up zones.
    expect(
      await statusOf(
        b.ctl.createLocation(asUser(STAFF), HOUSE_A, {
          name: "Now mine",
          capacity: 6,
        } as never),
      ),
    ).toBe(200);
  });

  it.each([
    ["an owner", OWNER],
    ["a manager", MANAGER],
  ])("%s withdraws it, audited, and the person is refused again", async (_n, actor) => {
    const b = build();
    await expect(grant(b, actor, ASSIGNED, false)).resolves.toMatchObject({
      allowed: false,
      changed: true,
      audited: true,
    });
    expect(accessOf(b, ASSIGNED)?.zone_setup_access).toBe(false);
    expect(
      await statusOf(
        b.ctl.deleteLocation(asUser(ASSIGNED), HOUSE_A, ZONE_OF_A),
      ),
    ).toBe(403);
  });

  it("a staff member cannot assign it, even one who holds it", async () => {
    const b = build();
    expect(await statusOf(grant(b, ASSIGNED, STAFF, true))).toBe(403);
    expect(await statusOf(grant(b, STAFF, STAFF, true))).toBe(403);
    expect(await statusOf(grant(b, STAFF, ASSIGNED, false))).toBe(403);
    expect(accessOf(b, STAFF)?.zone_setup_access).toBe(false);
    expect(accessOf(b, ASSIGNED)?.zone_setup_access).toBe(true);
    expect(b.writes).toEqual([]);
  });

  it("a manager of another house cannot assign here", async () => {
    const b = build();
    expect(await statusOf(grant(b, MANAGER_OF_B, STAFF, true))).toBe(403);
    expect(b.writes).toEqual([]);
  });

  it("a person who is not a member of this house is a 404", async () => {
    const b = build();
    expect(await statusOf(grant(b, OWNER, OTHER_HOUSE_STAFF, true))).toBe(404);
    expect(
      b.rows.user_restaurant_access.find((r) => r.user_id === OTHER_HOUSE_STAFF)
        ?.zone_setup_access,
    ).toBe(false);
    expect(b.writes).toEqual([]);
  });

  it("an owner or manager is not assigned: they set up zones already", async () => {
    const b = build();
    expect(await statusOf(grant(b, OWNER, MANAGER, true))).toBe(400);
    expect(await statusOf(grant(b, MANAGER, OWNER, true))).toBe(400);
    expect(b.writes).toEqual([]);
  });

  it("a save that moves nothing records nothing", async () => {
    const b = build();
    await expect(grant(b, OWNER, ASSIGNED, true)).resolves.toMatchObject({
      changed: false,
      audited: false,
      notified: false,
    });
    expect(b.writes).toEqual([]);
  });

  it("an unreadable register refuses the grant with a 500, nothing written", async () => {
    const b = build(["user_restaurant_access"]);
    expect(await statusOf(grant(b, OWNER, STAFF, true))).toBe(500);
    expect(b.writes).toEqual([]);
  });
});
