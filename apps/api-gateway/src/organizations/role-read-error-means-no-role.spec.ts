/**
 * An access register that could not be read is not an empty one (ADR 0248).
 *
 * The founder, 2026-10-01: "Next PR: error means no role (Recommended)". The
 * option read: "Fall back to users.role only when the access read SUCCEEDED
 * and found no row. On a read error, return no role, so managers get 403
 * during an outage on these routes."
 *
 * The hole this closes: `lookupRestaurantRole` read `users.role` whenever no
 * access role came back, and an access read that ERRORED returns no data, so
 * the legacy row decided. `registerAccount` writes `users.role = 'owner'` with
 * no house, and `acceptHeldMembership` later sets only `users.restaurant_id`,
 * so an account made by `registerAccount` that joined a house as staff that
 * way read as the house's owner whenever the access read failed.
 *
 * The founder, 2026-10-01, second: "Close both in #561". The option read:
 * "Fall back to users.role only when no access row exists at all, and honour
 * the validity window." So a row that exists decides alone, and gives its role
 * only while `isLiveMembership` holds.
 *
 * Cases marked [REVERT-FAILS] fail on 2019ae7f6. The others pin behaviour the
 * change keeps: the no-row fallback, a live row deciding alone, and the strict
 * reading throwing.
 */

import { ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import {
  OrganizationsService,
  RestaurantRoleUnreadableError,
  lookupRestaurantRole,
  readRestaurantRole,
} from "./organizations.service";
import { DatabaseService } from "../database/database.service";
import { DistributorFeedController } from "../distributor-feed/distributor-feed.controller";
import { DistributorFeedService } from "../distributor-feed/distributor-feed.service";
import { PriceCodeMappingsService } from "../distributor-feed/price-code-mappings.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "33333333-3333-4333-8333-333333333333";
const PERSON = "22222222-2222-4222-8222-222222222222";

interface AccessRow {
  role: string | null;
  is_active: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
}

interface Rows {
  /** The person's one access row here, or null for "the read succeeded and found none". */
  access?: AccessRow | null;
  /** Set to make the access read ERROR. */
  accessError?: { message: string } | null;
  user?: { role: string; restaurant_id: string | null } | null;
  userError?: { message: string } | null;
}

/**
 * A Supabase double for the two reads the lookup makes; it records which
 * tables were read. It applies an `is_active` filter the way PostgREST does,
 * so a query that asks only for active rows does not see an inactive one.
 */
function makeDb(rows: Rows) {
  const tablesRead: string[] = [];
  const query = (table: string) => {
    let activeOnly = false;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === "is_active" && value === true) activeOnly = true;
        return builder;
      },
      maybeSingle: () => {
        tablesRead.push(table);
        if (table === "user_restaurant_access") {
          if (rows.accessError) return Promise.resolve({ data: null, error: rows.accessError });
          const row = rows.access ?? null;
          return Promise.resolve({
            data: row && activeOnly && row.is_active !== true ? null : row,
            error: null,
          });
        }
        if (table === "users") {
          return Promise.resolve(
            rows.userError
              ? { data: null, error: rows.userError }
              : { data: rows.user ?? null, error: null },
          );
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  const supabase = { from: (table: string) => query(table) };
  const db = { supabase } as unknown as DatabaseService;
  return { db, supabase: supabase as unknown as DatabaseService["supabase"], tablesRead };
}

/**
 * One manager-gated route, driven through the REAL `OrganizationsService`:
 * `POST /distributor-feed/codes/:distributorKey` calls
 * `assertCanManageRestaurant` before it writes (distributor-feed.controller.ts).
 */
function gatedRoute(db: DatabaseService) {
  const declare = jest.fn().mockResolvedValue({ ok: true });
  const controller = new DistributorFeedController(
    {} as DistributorFeedService,
    { declare } as unknown as PriceCodeMappingsService,
    new OrganizationsService(db),
  );
  const call = () =>
    controller.declareCode(
      { userId: PERSON, restaurantId: HOUSE, name: "Ada" },
      "acme",
      { priceCode: "N", priceBasis: "net", evidence: "invoice 1" },
    );
  return { call, declare };
}

const OUTAGE = { message: "connection reset" };
const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("an access read that ERRORS returns no role and reads no legacy row", () => {
  it.each(["owner", "manager"])(
    "[REVERT-FAILS] a users row naming this house with role '%s' does not decide",
    async (legacyRole) => {
      const { supabase, tablesRead } = makeDb({
        accessError: OUTAGE,
        user: { role: legacyRole, restaurant_id: HOUSE },
      });

      const answer = await lookupRestaurantRole(supabase, PERSON, HOUSE);

      expect(answer.role).toBeNull();
      expect(answer.readError).toBe(
        "this house's access register could not be read (connection reset)",
      );
      expect(tablesRead).toEqual(["user_restaurant_access"]);
    },
  );

  it.each(["owner", "manager"])(
    "[REVERT-FAILS] the non-strict reading answers null for a legacy '%s'",
    async (legacyRole) => {
      const { db, supabase } = makeDb({
        accessError: OUTAGE,
        user: { role: legacyRole, restaurant_id: HOUSE },
      });

      await expect(
        readRestaurantRole(supabase, PERSON, HOUSE, { strict: false }),
      ).resolves.toBeNull();
      await expect(
        new OrganizationsService(db).resolveRestaurantRole(PERSON, HOUSE),
      ).resolves.toBeNull();
    },
  );

  it.each(["owner", "manager"])(
    "[REVERT-FAILS] assertCanManageRestaurant refuses a legacy '%s' with 403",
    async (legacyRole) => {
      const { db } = makeDb({
        accessError: OUTAGE,
        user: { role: legacyRole, restaurant_id: HOUSE },
      });

      await expect(
        new OrganizationsService(db).assertCanManageRestaurant(
          PERSON,
          HOUSE,
          "state what a distributor price code means",
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each(["owner", "manager"])(
    "[REVERT-FAILS] a manager-gated route refuses a legacy '%s' with 403 and writes nothing",
    async (legacyRole) => {
      const { db } = makeDb({
        accessError: OUTAGE,
        user: { role: legacyRole, restaurant_id: HOUSE },
      });
      const { call, declare } = gatedRoute(db);

      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(declare).not.toHaveBeenCalled();
    },
  );
});

describe("an access read that SUCCEEDS and finds NO row keeps the legacy fallback", () => {
  it("a legacy manager of this house is still a manager, and the route admits them", async () => {
    const { db, supabase, tablesRead } = makeDb({
      access: null,
      user: { role: "manager", restaurant_id: HOUSE },
    });

    expect(await lookupRestaurantRole(supabase, PERSON, HOUSE)).toEqual({
      role: "manager",
      readError: null,
    });
    expect(tablesRead).toEqual(["user_restaurant_access", "users"]);

    const { call, declare } = gatedRoute(db);
    await call();
    expect(declare).toHaveBeenCalledTimes(1);
  });

  it("a users row naming ANOTHER house gives no role here", async () => {
    const { supabase } = makeDb({
      access: null,
      user: { role: "owner", restaurant_id: OTHER_HOUSE },
    });

    expect(await lookupRestaurantRole(supabase, PERSON, HOUSE)).toEqual({
      role: null,
      readError: null,
    });
  });

  it("a users read that errors gives no role and says which read failed", async () => {
    const { supabase } = makeDb({ access: null, userError: OUTAGE });

    expect(await lookupRestaurantRole(supabase, PERSON, HOUSE)).toEqual({
      role: null,
      readError: "the person's home house could not be read (connection reset)",
    });
  });
});

describe("a live access row decides alone", () => {
  it("a staff row is staff even when the users row says owner of this house", async () => {
    const { db, supabase, tablesRead } = makeDb({
      access: { role: "staff", is_active: true },
      user: { role: "owner", restaurant_id: HOUSE },
    });

    expect(await lookupRestaurantRole(supabase, PERSON, HOUSE)).toEqual({
      role: "staff",
      readError: null,
    });
    expect(tablesRead).toEqual(["user_restaurant_access"]);
    await expect(
      new OrganizationsService(db).assertCanManageRestaurant(PERSON, HOUSE, "test"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a manager row inside its window is a manager even when the users row says staff", async () => {
    const { db, supabase } = makeDb({
      access: { role: "manager", is_active: true, valid_from: PAST, valid_until: FUTURE },
      user: { role: "staff", restaurant_id: HOUSE },
    });

    expect((await lookupRestaurantRole(supabase, PERSON, HOUSE)).role).toBe("manager");
    await expect(
      new OrganizationsService(db).assertCanManageRestaurant(PERSON, HOUSE, "test"),
    ).resolves.toBeUndefined();
  });
});

describe("a row that exists decides alone, live or not (Close both in #561)", () => {
  const cases: Array<[string, AccessRow]> = [
    ["an INACTIVE row", { role: "owner", is_active: false }],
    ["an EXPIRED row (valid_until in the past)", { role: "manager", is_active: true, valid_until: PAST }],
    ["a NOT-YET-VALID row (valid_from in the future)", { role: "manager", is_active: true, valid_from: FUTURE }],
    ["a live row with no role", { role: null, is_active: true }],
  ];

  it.each(cases)(
    "[REVERT-FAILS] %s plus a users row saying owner of this house gives no role, and the users row is not read",
    async (_label, row) => {
      const { db, supabase, tablesRead } = makeDb({
        access: row,
        user: { role: "owner", restaurant_id: HOUSE },
      });

      expect(await lookupRestaurantRole(supabase, PERSON, HOUSE)).toEqual({
        role: null,
        readError: null,
      });
      expect(tablesRead).toEqual(["user_restaurant_access"]);
      await expect(
        new OrganizationsService(db).resolveRestaurantRole(PERSON, HOUSE),
      ).resolves.toBeNull();
    },
  );

  it.each(cases)(
    "[REVERT-FAILS] %s refuses a manager-gated route with 403 and writes nothing",
    async (_label, row) => {
      const { db } = makeDb({
        access: row,
        user: { role: "owner", restaurant_id: HOUSE },
      });
      const { call, declare } = gatedRoute(db);

      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(declare).not.toHaveBeenCalled();
    },
  );

  it("[REVERT-FAILS] an inactive row is no role for the strict reading too, and it does not throw", async () => {
    const { supabase } = makeDb({
      access: { role: "owner", is_active: false },
      user: { role: "owner", restaurant_id: HOUSE },
    });

    await expect(
      readRestaurantRole(supabase, PERSON, HOUSE, { strict: true }),
    ).resolves.toBeNull();
  });
});

describe("the strict readings still throw on an access read that errors", () => {
  it("readRestaurantRole({ strict: true }) throws a 500 naming the read", async () => {
    const { supabase } = makeDb({
      accessError: OUTAGE,
      user: { role: "owner", restaurant_id: HOUSE },
    });

    const attempt = readRestaurantRole(supabase, PERSON, HOUSE, { strict: true });
    await expect(attempt).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(
      readRestaurantRole(supabase, PERSON, HOUSE, { strict: true }),
    ).rejects.toThrow("this house's access register could not be read (connection reset)");
  });

  it("OrganizationsService.readRestaurantRole throws RestaurantRoleUnreadableError", async () => {
    const { db } = makeDb({
      accessError: OUTAGE,
      user: { role: "owner", restaurant_id: HOUSE },
    });

    await expect(
      new OrganizationsService(db).readRestaurantRole(PERSON, HOUSE),
    ).rejects.toBeInstanceOf(RestaurantRoleUnreadableError);
  });
});
