import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { ProvidersController } from "./providers.controller";
import { OrganizationsService } from "../organizations/organizations.service";
import type { DatabaseService } from "../database/database.service";

/**
 * F-586: "Add vendors to <new branch>" put them in the house the owner was
 * standing in. The web posted `/providers` with an `X-Restaurant-Id` header
 * nothing here reads, so the token's house got them (name-only ones twice).
 * The copy is now one route: source = the token's house, target = the body,
 * the caller must own both in one organisation, and every vendor is answered
 * added or skipped with the reason.
 */

type Row = Record<string, any>;

/** A supabase double that filters on eq/in/is and records inserts. */
function makeDb(seed: { providers: Row[]; catalogue?: Row[] }) {
  const providers = seed.providers.map((r) => ({ ...r }));
  const inserted: Row[] = [];
  let next = 1;

  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let insertRow: Row | null = null;
    const rows = () => {
      const all =
        table === "providers"
          ? providers
          : table === "vendor_catalogue"
            ? (seed.catalogue ?? [])
            : [];
      return all.filter((r) => filters.every((f) => f(r)));
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (
        filters.push((r) => v.includes(r[c])),
        q
      ),
      is: (c: string, v: unknown) => (
        filters.push((r) => (r[c] ?? null) === v),
        q
      ),
      update: () => q,
      insert: (row: Row) => ((insertRow = row), q),
      single: async () => {
        if (insertRow) {
          const row = { id: `new-${next++}`, deleted_at: null, ...insertRow };
          providers.push(row);
          inserted.push(row);
          return { data: row, error: null };
        }
        const [first] = rows();
        return first
          ? { data: first, error: null }
          : { data: null, error: { message: "none" } };
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: any) => res({ data: rows(), error: null }),
    };
    return q;
  };
  return { db: { supabase: { from } }, inserted };
}

const svc = (db: any) =>
  new ProvidersService(
    db as unknown as DatabaseService,
    { createEvent: async () => undefined } as any,
    {} as any,
  );

const HOUSE_1 = "house-1";
const HOUSE_2 = "house-2";

describe("copyProvidersToHouse (F-586)", () => {
  it("adds into the TARGET house and answers each vendor", async () => {
    const { db, inserted } = makeDb({
      providers: [
        {
          id: "p1",
          restaurant_id: HOUSE_1,
          name: "Local Farm",
          contact_email: null,
          catalogue_vendor_id: null,
          contact_phone: "+15550001111",
        },
        {
          id: "p2",
          restaurant_id: HOUSE_1,
          name: "Breakthru",
          contact_email: "b@x.com",
          catalogue_vendor_id: "cat-1",
        },
      ],
      catalogue: [
        {
          id: "cat-1",
          name: "Breakthru",
          is_active: true,
          type: "distributor",
        },
      ],
    });
    const results = await svc(db).copyProvidersToHouse(
      HOUSE_1,
      HOUSE_2,
      ["p1", "p2"],
      "u1",
    );

    expect(results.map((r) => [r.providerId, r.outcome])).toEqual([
      ["p1", "added"],
      ["p2", "added"],
    ]);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((r) => r.restaurant_id === HOUSE_2)).toBe(true);
    expect(inserted[0]).toMatchObject({
      name: "Local Farm",
      contact_phone: "+15550001111",
      is_custom: true,
    });
    expect(inserted[1]).toMatchObject({
      catalogue_vendor_id: "cat-1",
      is_custom: false,
    });
  });

  it("skips what the target already has, and anything not this house's, with the reason", async () => {
    const { db, inserted } = makeDb({
      providers: [
        {
          id: "p1",
          restaurant_id: HOUSE_1,
          name: "Local Farm",
          contact_email: null,
          catalogue_vendor_id: null,
        },
        {
          id: "p2",
          restaurant_id: HOUSE_1,
          name: "Breakthru",
          contact_email: null,
          catalogue_vendor_id: "cat-1",
        },
        {
          id: "p3",
          restaurant_id: HOUSE_1,
          name: "Wine Co",
          contact_email: "Orders@WineCo.com",
          catalogue_vendor_id: null,
        },
        {
          id: "p4",
          restaurant_id: HOUSE_1,
          name: "local farm ",
          contact_email: null,
          catalogue_vendor_id: null,
        },
        {
          id: "other",
          restaurant_id: "house-9",
          name: "Elsewhere",
          contact_email: null,
          catalogue_vendor_id: null,
        },
        {
          id: "t1",
          restaurant_id: HOUSE_2,
          name: "LOCAL FARM",
          contact_email: null,
          catalogue_vendor_id: null,
        },
        {
          id: "t2",
          restaurant_id: HOUSE_2,
          name: "Breakthru Beverage",
          contact_email: null,
          catalogue_vendor_id: "cat-1",
        },
        {
          id: "t3",
          restaurant_id: HOUSE_2,
          name: "Another name",
          contact_email: "orders@wineco.com",
          catalogue_vendor_id: null,
        },
      ],
    });
    const results = await svc(db).copyProvidersToHouse(
      HOUSE_1,
      HOUSE_2,
      ["p1", "p2", "p3", "p4", "other"],
      "u1",
    );

    expect(inserted).toHaveLength(0);
    expect(results.map((r) => [r.providerId, r.outcome, r.reason])).toEqual([
      ["p1", "skipped", "That house already has a vendor by this name."],
      ["p2", "skipped", "Already on that house's list."],
      ["p3", "skipped", "That house already has a vendor with this email."],
      ["p4", "skipped", "That house already has a vendor by this name."],
      ["other", "skipped", "Not one of this house's vendors."],
    ]);
  });

  it("does not add two copies when the selection itself repeats a name", async () => {
    const { db, inserted } = makeDb({
      providers: [
        {
          id: "p1",
          restaurant_id: HOUSE_1,
          name: "Suvla",
          contact_email: null,
          catalogue_vendor_id: null,
        },
        {
          id: "p2",
          restaurant_id: HOUSE_1,
          name: "Suvla",
          contact_email: null,
          catalogue_vendor_id: null,
        },
      ],
    });
    const results = await svc(db).copyProvidersToHouse(
      HOUSE_1,
      HOUSE_2,
      ["p1", "p2"],
      "u1",
    );
    expect(inserted).toHaveLength(1);
    expect(results[1]).toMatchObject({
      outcome: "skipped",
      reason: "That house already has a vendor by this name.",
    });
  });

  it("refuses the whole copy when the target cannot be read for duplicates", async () => {
    const { db, inserted } = makeDb({
      providers: [{ id: "p1", restaurant_id: HOUSE_1, name: "Suvla" }],
    });
    const realFrom = db.supabase.from;
    let call = 0;
    (db.supabase as any).from = (t: string) => {
      const q = realFrom(t);
      if (t === "providers" && ++call === 2) {
        q.then = (res: any) =>
          res({ data: null, error: { message: "timeout" } });
      }
      return q;
    };
    await expect(
      svc(db).copyProvidersToHouse(HOUSE_1, HOUSE_2, ["p1"], "u1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(inserted).toHaveLength(0);
  });
});

/** Organisation double: roles per house, houses with their organisation. */
function makeOrgs(opts: {
  roles: Record<string, string | null>;
  houses: Row[];
  roleReadFails?: boolean;
}) {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (
        filters.push((r) => v.includes(r[c])),
        q
      ),
      maybeSingle: async () => {
        if (table === "user_restaurant_access") {
          if (opts.roleReadFails)
            return { data: null, error: { message: "down" } };
          const house = Object.keys(opts.roles).find((h) =>
            filters.every((f) =>
              f({ restaurant_id: h, user_id: "u1", is_active: true }),
            ),
          );
          const role = house ? opts.roles[house] : null;
          return { data: role ? { role } : null, error: null };
        }
        return { data: null, error: null };
      },
      then: (res: any) =>
        res({
          data:
            table === "restaurants"
              ? opts.houses.filter((r) => filters.every((f) => f(r)))
              : [],
          error: null,
        }),
    };
    return q;
  };
  return new OrganizationsService({
    supabase: { from },
  } as unknown as DatabaseService);
}

const SAME_ORG = [
  { id: HOUSE_1, name: "Meyhane", organization_id: "org-1" },
  { id: HOUSE_2, name: "Uptown", organization_id: "org-1" },
];

describe("assertOwnsBothHousesInOneOrganisation (F-586)", () => {
  it("passes an owner of both houses in one organisation and names the target", async () => {
    const orgs = makeOrgs({
      roles: { [HOUSE_1]: "owner", [HOUSE_2]: "Owner" },
      houses: SAME_ORG,
    });
    await expect(
      orgs.assertOwnsBothHousesInOneOrganisation("u1", HOUSE_1, HOUSE_2),
    ).resolves.toEqual({ toHouseName: "Uptown" });
  });

  it("refuses a manager of the target house", async () => {
    const orgs = makeOrgs({
      roles: { [HOUSE_1]: "owner", [HOUSE_2]: "manager" },
      houses: SAME_ORG,
    });
    await expect(
      orgs.assertOwnsBothHousesInOneOrganisation("u1", HOUSE_1, HOUSE_2),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses houses of two organisations", async () => {
    const orgs = makeOrgs({
      roles: { [HOUSE_1]: "owner", [HOUSE_2]: "owner" },
      houses: [SAME_ORG[0], { ...SAME_ORG[1], organization_id: "org-2" }],
    });
    await expect(
      orgs.assertOwnsBothHousesInOneOrganisation("u1", HOUSE_1, HOUSE_2),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("says 503, not 403, when the role could not be read", async () => {
    const orgs = makeOrgs({ roles: {}, houses: SAME_ORG, roleReadFails: true });
    await expect(
      orgs.assertOwnsBothHousesInOneOrganisation("u1", HOUSE_1, HOUSE_2),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("refuses copying a house into itself", async () => {
    const orgs = makeOrgs({ roles: { [HOUSE_1]: "owner" }, houses: SAME_ORG });
    await expect(
      orgs.assertOwnsBothHousesInOneOrganisation("u1", HOUSE_1, HOUSE_1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("POST /providers/copy-to-house (F-586)", () => {
  const user = { userId: "u1", restaurantId: HOUSE_1 };

  it("copies from the token's house into the checked target", async () => {
    const copy = jest.fn().mockResolvedValue([]);
    const assert = jest.fn().mockResolvedValue({ toHouseName: "Uptown" });
    const controller = new ProvidersController(
      { copyProvidersToHouse: copy } as any,
      { assertOwnsBothHousesInOneOrganisation: assert } as any,
    );
    await expect(
      controller.copyToHouse(
        { targetRestaurantId: HOUSE_2, providerIds: ["p1"] },
        user,
      ),
    ).resolves.toEqual({
      targetRestaurantId: HOUSE_2,
      targetName: "Uptown",
      results: [],
    });
    expect(assert).toHaveBeenCalledWith("u1", HOUSE_1, HOUSE_2);
    expect(copy).toHaveBeenCalledWith(HOUSE_1, HOUSE_2, ["p1"], "u1");
  });

  it("copies nothing when the ownership check refuses", async () => {
    const copy = jest.fn();
    const controller = new ProvidersController(
      { copyProvidersToHouse: copy } as any,
      {
        assertOwnsBothHousesInOneOrganisation: jest
          .fn()
          .mockRejectedValue(new ForbiddenException("no")),
      } as any,
    );
    await expect(
      controller.copyToHouse(
        { targetRestaurantId: HOUSE_2, providerIds: ["p1"] },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(copy).not.toHaveBeenCalled();
  });
});
