import { LEAVE_ROUTE_ENV } from "../__tests__/leave-route-outside-services";
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { AppModule } from "../app.module";
import { DatabaseService } from "../database/database.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { TeamService } from "../team/team.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * "Leave" and "delete account" reach THE removal over the real routes
 * (ADR 0242, OD-204).
 *
 * `AuthService.leaveRestaurant` and `deleteAccount` find `MembersService`
 * lazily, per request, with `moduleRef.get(MembersService, { strict: false })`.
 * The boot check (`check_gateway_boots.sh`) compiles the injector but never
 * serves a request, so it cannot see that lookup fail; the K5 block in
 * `team/team-pay.spec.ts` builds `AuthService` by hand and patches
 * `moduleRef` with a stub. Neither proves that the gateway, as booted, carries
 * a leave from the HTTP route to `TeamService.removeFromHouse`.
 *
 * This boots the FULL `AppModule` and calls both routes with `fetch`. Exactly
 * two things are replaced, and nothing else:
 *
 *   - `JwtAuthGuard`: it verifies a signed token and reads the session store.
 *     The override sets `req.user` from test headers instead, so what is under
 *     test starts at the controller. Its own checks are held by its own specs.
 *   - `DatabaseService`: the in-memory stub (`team/testing/supabase-stub.ts`),
 *     so every service the booted graph wires reads and writes the same rows
 *     the assertions read, and no request leaves the process.
 *
 * `moduleRef` is never touched: the lookup under test is the real one. The
 * spy on `TeamService.prototype.removeFromHouse` does not replace it (no
 * `mockImplementation`), so the effects asserted below are its own.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";

// Far enough out that no clock makes them started, and far enough back that
// none makes them unstarted: the test runs on the real clock, not a faked one,
// because the whole app (its timers included) is running. FUTURE is the first
// Monday a year from today, so the case never ages into the past.
const FUTURE = ((): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
})();
const PAST = "2020-09-07"; // a Monday

function shift(over: Record<string, any>) {
  return {
    schedule_id: null,
    start_time: "09:00",
    end_time: "17:00",
    state: "scheduled",
    shift_breaks: [],
    ...over,
  };
}

/**
 * `release_leaving_shifts` (migration 20261201130000) for the one shape these
 * cases produce: whole unstarted shifts back to the open pool, each re-checked
 * against what was read. A cut (`p_split`) is not modelled and throws, so a
 * seed that grows one fails loudly instead of passing on a half-applied shim.
 * The full shim, with cuts and hand-overs, is `withReleaseRpc` in
 * `team/team-pay.spec.ts`; the SQL is held by its own test under
 * `supabase/tests/`.
 */
function withReleaseRpc(db: StubDb): StubDb {
  (db.supabase as any).rpc = async (fn: string, args: any) => {
    db.ops.push({
      table: `rpc:${fn}`,
      op: "update",
      filters: [],
      payload: args,
    });
    if (fn !== "release_leaving_shifts") throw new Error(`stub: no rpc ${fn}`);
    if (args.p_split.length)
      throw new Error("stub: a cut is not modelled here");
    const rows = db.tables.shifts;
    for (const o of args.p_open) {
      const r = rows.find((x) => x.id === o.id);
      if (
        !r ||
        r.restaurant_id !== args.p_restaurant_id ||
        r.member_id !== args.p_member_id ||
        r.state === "open" ||
        r.shift_date !== o.shift_date ||
        r.start_time !== o.start_time
      )
        return { data: null, error: { message: "not as it was read" } };
    }
    for (const o of args.p_open)
      Object.assign(rows.find((x) => x.id === o.id)!, {
        member_id: null,
        state: "open",
        shift_type: "open",
        labor_cost: null,
      });
    return {
      data: { opened: args.p_open.length, split: 0, rests: [] },
      error: null,
    };
  };
  return db;
}

/**
 * Two houses. STAFF works in both, so a leave from A that reached B's rows
 * would show here; OWNER owns both, so neither house is left ownerless and
 * `deleteAccount`'s sole-owner guard does not fire for STAFF.
 */
function seed(): StubDb {
  return withReleaseRpc(
    makeStubDb({
      restaurants: [
        { id: HOUSE_A, timezone: "Europe/Istanbul", country: "TR" },
        { id: HOUSE_B, timezone: "Europe/Istanbul", country: "TR" },
      ],
      user_restaurant_access: [
        {
          id: "a-owner-a",
          user_id: OWNER,
          restaurant_id: HOUSE_A,
          role: "owner",
          is_active: true,
        },
        {
          id: "a-manager-a",
          user_id: MANAGER,
          restaurant_id: HOUSE_A,
          role: "manager",
          is_active: true,
        },
        {
          id: "a-staff-a",
          user_id: STAFF,
          restaurant_id: HOUSE_A,
          role: "staff",
          is_active: true,
        },
        {
          id: "a-owner-b",
          user_id: OWNER,
          restaurant_id: HOUSE_B,
          role: "owner",
          is_active: true,
        },
        {
          id: "a-staff-b",
          user_id: STAFF,
          restaurant_id: HOUSE_B,
          role: "staff",
          is_active: true,
        },
      ],
      users: [
        {
          user_id: OWNER,
          restaurant_id: HOUSE_A,
          role: "owner",
          name: "Ada",
          email: "ada@example.test",
        },
        {
          user_id: MANAGER,
          restaurant_id: HOUSE_A,
          role: "manager",
          name: "Moe",
          email: "moe@example.test",
        },
        {
          user_id: STAFF,
          restaurant_id: HOUSE_A,
          role: "staff",
          name: "Sam",
          email: "sam@example.test",
        },
      ],
      team_members: [
        {
          id: "m-owner-a",
          restaurant_id: HOUSE_A,
          user_id: OWNER,
          display_name: "Ada",
          created_at: "2026-01-01",
        },
        {
          id: "m-manager-a",
          restaurant_id: HOUSE_A,
          user_id: MANAGER,
          display_name: "Moe",
          created_at: "2026-01-02",
        },
        {
          id: "m-staff-a",
          restaurant_id: HOUSE_A,
          user_id: STAFF,
          display_name: "Sam",
          created_at: "2026-01-03",
        },
        {
          id: "m-owner-b",
          restaurant_id: HOUSE_B,
          user_id: OWNER,
          display_name: "Ada",
          created_at: "2026-01-01",
        },
        {
          id: "m-staff-b",
          restaurant_id: HOUSE_B,
          user_id: STAFF,
          display_name: "Sam",
          created_at: "2026-01-03",
        },
      ],
      shifts: [
        shift({
          id: "a-past",
          restaurant_id: HOUSE_A,
          member_id: "m-staff-a",
          shift_date: PAST,
          labor_cost: 150,
        }),
        shift({
          id: "a-next",
          restaurant_id: HOUSE_A,
          member_id: "m-staff-a",
          shift_date: FUTURE,
          labor_cost: 150,
        }),
        shift({
          id: "b-next",
          restaurant_id: HOUSE_B,
          member_id: "m-staff-b",
          shift_date: FUTURE,
          labor_cost: 150,
        }),
      ],
      shift_breaks: [],
      schedules: [],
      team_settings: [],
      time_off_requests: [],
      notifications: [],
      mobile_devices: [],
      system_audit_log: [],
      house_memberships_ended: [],
      organization_invites: [],
      user_oauth_accounts: [],
    }),
  );
}

let db: StubDb;
let app: INestApplication;
let base: string;

// The same placeholder credentials `health/liveness.route.spec.ts` sets, plus
// the outside services the boot reaches; see __tests__/leave-route-outside-services.ts,
// imported first so the pins precede AppModule's own imports.
const ENV = LEAVE_ROUTE_ENV;
const saved: Record<string, string | undefined> = {};

async function boot(
  extra?: (b: ReturnType<typeof Test.createTestingModule>) => void,
) {
  db = seed();
  const builder = Test.createTestingModule({ imports: [AppModule] });
  builder
    .overrideProvider(DatabaseService)
    .useValue(asDatabaseService(db))
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: req.headers["x-test-user"],
          restaurantId: req.headers["x-test-house"],
          role: req.headers["x-test-role"],
        };
        return true;
      },
    });
  extra?.(builder);
  const mod = await builder.compile();
  app = mod.createNestApplication({ logger: false });
  // As `main.ts` sets them: the prefix the web app calls, and the pipe that
  // holds `LeaveRestaurantDto` to a UUID.
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/v1`;
}

async function call(
  method: string,
  path: string,
  as: { user: string; house?: string; role?: string },
  body?: unknown,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-user": as.user,
  };
  if (as.house) headers["x-test-house"] = as.house;
  if (as.role) headers["x-test-role"] = as.role;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const shiftById = (id: string) => db.tables.shifts.find((r) => r.id === id);
const removals = () =>
  db.tables.system_audit_log.filter((r) => r.action === "team_member_removed");

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("leave and delete account reach THE removal over the real routes (ADR 0242)", () => {
  let removeFromHouse: jest.SpyInstance;

  beforeAll(async () => {
    await boot();
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    // A fresh world per case on the same booted app: the stub's arrays are
    // swapped in place, because every service holds the one stub object.
    const fresh = seed();
    for (const k of Object.keys(db.tables)) delete db.tables[k];
    Object.assign(db.tables, fresh.tables);
    db.ops.length = 0;
    removeFromHouse = jest.spyOn(TeamService.prototype, "removeFromHouse");
  });
  afterEach(() => {
    removeFromHouse.mockRestore();
  });

  it("POST /auth/me/leave-restaurant runs the Team page's removal for that house, and only that house", async () => {
    const res = await call(
      "POST",
      "/auth/me/leave-restaurant",
      { user: STAFF, house: HOUSE_A, role: "staff" },
      { restaurantId: HOUSE_A },
    );

    expect(res).toEqual({
      status: 200,
      body: { success: true, message: "Left restaurant" },
    });

    // The one removal, called once, for the leaver's roster row in A.
    expect(removeFromHouse).toHaveBeenCalledTimes(1);
    expect(removeFromHouse).toHaveBeenCalledWith(
      { userId: STAFF, role: "staff", via: "MembersService.removeMember" },
      HOUSE_A,
      "m-staff-a",
      null,
      null,
    );

    // Its effects: the unstarted shift is open again, the worked one is not
    // rewritten, the roster and access rows are gone, the leave is filed as a
    // self-leave and stamped 'left'.
    expect(shiftById("a-next")).toMatchObject({
      member_id: null,
      state: "open",
      labor_cost: null,
    });
    expect(shiftById("a-past")).toMatchObject({
      member_id: "m-staff-a",
      labor_cost: 150,
    });
    expect(db.tables.team_members.some((m) => m.id === "m-staff-a")).toBe(
      false,
    );
    expect(
      db.tables.user_restaurant_access.some((r) => r.id === "a-staff-a"),
    ).toBe(false);
    expect(removals()).toHaveLength(1);
    expect(removals()[0].changes).toMatchObject({
      via: "MembersService.removeMember",
      self_leave: true,
      shifts_opened: 1,
    });
    const stamped = db.opsOn("house_memberships_ended", "update");
    expect(stamped).toHaveLength(1);
    expect(stamped[0].payload).toEqual({ end_reason: "left" });
    expect(stamped[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "user_id", value: STAFF },
        { kind: "eq", column: "restaurant_id", value: HOUSE_A },
      ]),
    );

    // House isolation: the same person's membership in B is untouched.
    expect(db.tables.team_members.some((m) => m.id === "m-staff-b")).toBe(true);
    expect(
      db.tables.user_restaurant_access.find((r) => r.id === "a-staff-b"),
    ).toMatchObject({ is_active: true });
    expect(shiftById("b-next")).toMatchObject({
      member_id: "m-staff-b",
      state: "scheduled",
      labor_cost: 150,
    });
  });

  it("DELETE /auth/me leaves every house through the same removal before the account goes", async () => {
    const res = await call("DELETE", "/auth/me", { user: STAFF });

    expect(res).toEqual({
      status: 200,
      body: { success: true, message: "Account deleted" },
    });

    expect(removeFromHouse).toHaveBeenCalledTimes(2);
    const calls = removeFromHouse.mock.calls.map((c) => [c[0], c[1], c[2]]);
    expect(calls).toEqual(
      expect.arrayContaining([
        [
          { userId: STAFF, role: "staff", via: "MembersService.removeMember" },
          HOUSE_A,
          "m-staff-a",
        ],
        [
          { userId: STAFF, role: "staff", via: "MembersService.removeMember" },
          HOUSE_B,
          "m-staff-b",
        ],
      ]),
    );

    expect(shiftById("a-next")).toMatchObject({
      member_id: null,
      state: "open",
    });
    expect(shiftById("b-next")).toMatchObject({
      member_id: null,
      state: "open",
    });
    expect(shiftById("a-past")).toMatchObject({
      member_id: "m-staff-a",
      labor_cost: 150,
    });
    expect(db.tables.team_members.some((m) => m.user_id === STAFF)).toBe(false);
    expect(removals().map((r) => r.changes)).toEqual([
      expect.objectContaining({
        via: "MembersService.removeMember",
        self_leave: true,
      }),
      expect.objectContaining({
        via: "MembersService.removeMember",
        self_leave: true,
      }),
    ]);
    expect(db.tables.users.some((u) => u.user_id === STAFF)).toBe(false);
    expect(
      db.tables.user_restaurant_access.some((r) => r.user_id === STAFF),
    ).toBe(false);

    // Nobody else was removed.
    expect(db.tables.team_members.map((m) => m.id).sort()).toEqual([
      "m-manager-a",
      "m-owner-a",
      "m-owner-b",
    ]);
  });

  /*
   * A ROW OUTSIDE ITS WINDOW STILL LETS ITS PERSON LEAVE (founder, 2026-10-01:
   * "Let leaving and deletion through (Recommended)", ADR 0248). Removing
   * oneself, here and in account deletion, needs only a row that exists;
   * every other check keeps the window. These cases set `valid_from` /
   * `valid_until` on rows that stay `is_active`, so the stubbed JWT step
   * (overridden above, as it would pass them: `validateJwtPayload` reads
   * `is_active` alone) is not what decides.
   *
   * [REVERT-FAILS] here means red with `restaurants/members.service.ts` as it
   * was at `5cd2fb001^`, before this change, when `assertMembership` refused a row
   * outside its window even to the person removing themself. The last case is
   * a pin of the window rule itself: it passes at `5cd2fb001^` and is red at
   * 2019ae7f6, where the window was not read.
   */
  const LONG_AGO = "2020-01-01T00:00:00.000Z";
  const FAR_AHEAD = "2999-01-01T00:00:00.000Z";
  const rowOf = (id: string) =>
    db.tables.user_restaurant_access.find((r) => r.id === id)!;

  it.each([
    ["an EXPIRED row (valid_until in the past)", { valid_until: LONG_AGO }],
    ["a NOT-YET-VALID row (valid_from years ahead)", { valid_from: FAR_AHEAD }],
  ])(
    "[REVERT-FAILS] POST /auth/me/leave-restaurant lets %s leave, and the removal runs",
    async (_label, window) => {
      Object.assign(rowOf("a-staff-a"), window);

      const res = await call(
        "POST",
        "/auth/me/leave-restaurant",
        { user: STAFF, house: HOUSE_A, role: "staff" },
        { restaurantId: HOUSE_A },
      );

      expect(res).toEqual({
        status: 200,
        body: { success: true, message: "Left restaurant" },
      });
      expect(removeFromHouse).toHaveBeenCalledTimes(1);
      expect(
        db.tables.user_restaurant_access.some((r) => r.id === "a-staff-a"),
      ).toBe(false);
      expect(db.tables.team_members.some((m) => m.id === "m-staff-a")).toBe(
        false,
      );
    },
  );

  it("[REVERT-FAILS] DELETE /auth/me completes when one of the person's rows is EXPIRED", async () => {
    Object.assign(rowOf("a-staff-b"), { valid_until: LONG_AGO });

    const res = await call("DELETE", "/auth/me", { user: STAFF });

    expect(res).toEqual({
      status: 200,
      body: { success: true, message: "Account deleted" },
    });
    expect(removeFromHouse).toHaveBeenCalledTimes(2);
    expect(db.tables.users.some((u) => u.user_id === STAFF)).toBe(false);
    expect(
      db.tables.user_restaurant_access.some((r) => r.user_id === STAFF),
    ).toBe(false);
  });

  it("an EXPIRED manager row still cannot remove ANOTHER member: 403, and nothing is removed", async () => {
    Object.assign(rowOf("a-manager-a"), { valid_until: LONG_AGO });

    const res = await call(
      "DELETE",
      `/restaurants/${HOUSE_A}/members/${STAFF}`,
      { user: MANAGER, house: HOUSE_A, role: "manager" },
    );

    expect(res.status).toBe(403);
    expect(removeFromHouse).not.toHaveBeenCalled();
    expect(rowOf("a-staff-a")).toMatchObject({ is_active: true });
    expect(db.tables.team_members.some((m) => m.id === "m-staff-a")).toBe(true);
    expect(removals()).toHaveLength(0);
  });
});

describe("negative control: the same routes with the removal unwired refuse before any roster or account write", () => {
  // Proves the cases above can fail. `TeamService` resolves to nothing, so the
  // `MembersService` the lazy lookup finds has no removal to run (the refusal
  // at members.service.ts, not AuthService's own "no MembersService" branch).
  // Everything else is the same boot. The leave case compares every table; the
  // delete case checks the account, roster and access rows only, because
  // `deleteAccount` stops the person's calendar links before its removal loop
  // (ADR 0242, "can stop part-way") and the seed has none to see.
  let removeFromHouse: jest.SpyInstance;

  beforeAll(async () => {
    await boot((b) =>
      b.overrideProvider(TeamService).useFactory({ factory: () => undefined }),
    );
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    removeFromHouse = jest.spyOn(TeamService.prototype, "removeFromHouse");
  });
  afterEach(() => {
    removeFromHouse.mockRestore();
  });

  it("leave answers the documented 500 and the leaver is still there", async () => {
    const before = JSON.stringify(db.tables);

    const res = await call(
      "POST",
      "/auth/me/leave-restaurant",
      { user: STAFF, house: HOUSE_A, role: "staff" },
      { restaurantId: HOUSE_A },
    );

    expect(res.status).toBe(500);
    expect(res.body.message).toBe(
      "Could not remove this member: their shifts could not be released, so nothing was changed.",
    );
    expect(removeFromHouse).not.toHaveBeenCalled();
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("delete account answers the documented 500 and keeps the account, roster and access rows", async () => {
    const res = await call("DELETE", "/auth/me", { user: STAFF });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe(
      "Could not remove this member: their shifts could not be released, so nothing was changed.",
    );
    expect(removeFromHouse).not.toHaveBeenCalled();
    expect(db.tables.users.some((u) => u.user_id === STAFF)).toBe(true);
    expect(
      db.tables.team_members.filter((m) => m.user_id === STAFF),
    ).toHaveLength(2);
    expect(
      db.tables.user_restaurant_access.filter((r) => r.user_id === STAFF),
    ).toHaveLength(2);
  });
});
