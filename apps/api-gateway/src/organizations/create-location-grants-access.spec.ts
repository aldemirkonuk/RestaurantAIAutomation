import { InternalServerErrorException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";

/**
 * `POST /organizations/locations` — a location its creator could not open.
 *
 * MEASURED 2026-09-03 against a local gateway on `main`: an owner added a
 * location through the product's own door. The `restaurants` row was written
 * (slug `sim-meyhouse-9ef3dde7`, org set) but no `user_restaurant_access` row
 * was, so the very next call on that restaurant —
 * `GET /restaurants/:id/operating-hours`, which goes through
 * `MembersService.assertMembership` (restaurants/members.service.ts:25) —
 * answered 403 "Access denied to this restaurant". `assertMembership` reads a
 * URA row and falls back only to `users.restaurant_id`, which still names the
 * creator's ORIGINAL restaurant; there is no org-level path.
 *
 * `registerRestaurant` (auth.service.ts:759) has always written that row for
 * the founding owner. The second door into `restaurants` did not.
 */

const USER_ID = "user-owner-1";
const ORG_ID = "org-1";
const REST_ID = "rest-new-1";

type Recorded = {
  accessInserts: any[];
  restaurantInserts: any[];
  restaurantDeletes: { col: string; val: any }[];
};

function makeService(opts: { accessInsertError?: { message: string } } = {}) {
  const calls: Recorded = {
    accessInserts: [],
    restaurantInserts: [],
    restaurantDeletes: [],
  };

  // Terminal-awaitable chain: supabase-js resolves with `{ data, error }`
  // whether the caller ends on `.single()` or awaits the builder directly
  // (the URA insert does the latter), so the stub must be thenable too.
  const chain = (result: any): any => {
    const c: any = {
      select: () => c,
      insert: () => c,
      update: () => c,
      delete: () => c,
      eq: () => c,
      in: () => c,
      maybeSingle: async () => result,
      single: async () => result,
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return c;
  };

  const restaurantsChain = (): any => {
    let deleting = false;
    const c: any = {
      insert: (payload: any) => {
        calls.restaurantInserts.push(payload);
        return c;
      },
      select: () => c,
      delete: () => {
        deleting = true;
        return c;
      },
      eq: (col: string, val: any) => {
        if (deleting) calls.restaurantDeletes.push({ col, val });
        return c;
      },
      in: () => c,
      single: async () => ({
        data: { id: REST_ID, name: "Sim Meyhouse" },
        error: null,
      }),
      maybeSingle: async () => ({
        data: { id: REST_ID, name: "Sim Meyhouse" },
        error: null,
      }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return c;
  };

  const accessChain = (): any => {
    const result = { data: null, error: opts.accessInsertError ?? null };
    const c: any = {
      insert: (payload: any) => {
        calls.accessInserts.push(payload);
        return c;
      },
      select: () => c,
      eq: () => c,
      maybeSingle: async () => result,
      single: async () => result,
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return c;
  };

  const supabase = {
    from: (table: string) => {
      if (table === "organization_members")
        return chain({ data: [{ organization_id: ORG_ID }], error: null });
      if (table === "organizations")
        return chain({ data: { id: ORG_ID }, error: null });
      if (table === "restaurants") return restaurantsChain();
      if (table === "user_restaurant_access") return accessChain();
      return chain({ data: null, error: null });
    },
  };

  const svc = new OrganizationsService({ supabase } as any);
  return { svc, calls };
}

const DTO = {
  name: "Sim Meyhouse",
  address: "1 Test St",
  city: "Istanbul",
};

describe("OrganizationsService#createLocation — creator access", () => {
  it("grants the creator owner access to the location it just created", async () => {
    const { svc, calls } = makeService();

    const result = await svc.createLocation(USER_ID, DTO);

    // Response shape is unchanged.
    expect(result).toEqual({ id: REST_ID, name: "Sim Meyhouse" });

    // The decisive assertion: the membership row the 403 was missing.
    expect(calls.accessInserts).toHaveLength(1);
    expect(calls.accessInserts[0]).toMatchObject({
      user_id: USER_ID,
      restaurant_id: REST_ID,
      role: "owner",
      is_active: true,
    });

    // Nothing was rolled back on the happy path.
    expect(calls.restaurantDeletes).toHaveLength(0);
  });

  it("rolls the restaurant back and throws when the access grant fails", async () => {
    const { svc, calls } = makeService({
      accessInsertError: { message: "duplicate key value" },
    });

    await expect(svc.createLocation(USER_ID, DTO)).rejects.toThrow(
      InternalServerErrorException,
    );

    // The restaurant row was created, so it must not be left behind
    // unreachable — same rollback discipline as `registerRestaurant`.
    expect(calls.restaurantInserts).toHaveLength(1);
    expect(calls.restaurantDeletes).toEqual([{ col: "id", val: REST_ID }]);
  });
});
