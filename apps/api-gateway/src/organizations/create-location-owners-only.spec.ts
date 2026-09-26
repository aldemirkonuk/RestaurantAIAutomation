import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * `POST /organizations/locations`: only an owner of the organisation may open
 * a new location in it, and they become its owner (ADR 0164, the founder,
 * 2026-09-18: "Organisation owners only"; v3.0-TECH-DEBT 44.1u).
 *
 * Until then the authority was ANY `organization_members` row: a person the
 * organisation knew only as staff of one house could open a new house in it
 * and be written as that house's owner (PR #393's audit, note 2). The owner of
 * an organisation is the `organization_members` row whose role is `owner`
 * (organizations/org-role.ts).
 */

const ORG = "org-1";
const OTHER_ORG = "org-2";
const P = "user-p";

function world(
  orgRole: string | null,
  extra: Partial<Record<string, any[]>> = {},
): StubDb {
  return makeStubDb({
    organization_members: orgRole
      ? [{ organization_id: ORG, user_id: P, role: orgRole }]
      : [],
    organizations: [{ id: ORG, owner_id: null }],
    restaurant_chains: [
      { id: "chain-own", organization_id: ORG, name: "Harbour" },
      { id: "chain-other", organization_id: OTHER_ORG, name: "Elsewhere" },
    ],
    restaurants: [],
    user_restaurant_access: [],
    ...extra,
  });
}

const service = (db: StubDb) => new OrganizationsService(asDatabaseService(db));
const DTO = { name: "Moda", address: "1 Test St", city: "Istanbul" };

describe("createLocation: organisation owners only (ADR 0164)", () => {
  it("lets an owner of the organisation open a location, and makes them its owner", async () => {
    // Seeded with an active house in ORG already — OD-131(a) (below) added a
    // second gate requiring one; this case is about the FIRST gate.
    const db = world("owner", {
      restaurants: [{ id: "house-existing", organization_id: ORG }],
      user_restaurant_access: [
        { user_id: P, restaurant_id: "house-existing", is_active: true },
      ],
    });

    const created = await service(db).createLocation(P, DTO);

    expect(db.tables.restaurants).toHaveLength(2);
    const newRestaurant = db.tables.restaurants.find(
      (r: any) => r.id === created.id,
    );
    expect(newRestaurant).toMatchObject({ organization_id: ORG });
    expect(db.tables.user_restaurant_access).toContainEqual(
      expect.objectContaining({
        user_id: P,
        restaurant_id: created.id,
        role: "owner",
        is_active: true,
      }),
    );
  });

  it.each(["manager", "staff"])(
    "refuses a %s of the organisation and creates nothing",
    async (role) => {
      const db = world(role);

      const err = await service(db)
        .createLocation(P, DTO)
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: "NOT_ORGANISATION_OWNER",
      });
      expect(db.tables.restaurants).toHaveLength(0);
      expect(db.tables.user_restaurant_access).toHaveLength(0);
    },
  );

  it("refuses the caller even when a DIFFERENT person owns an organisation (item 7, 2026-09-19 — mutant V7: the owner read losing its own user_id filter)", async () => {
    // Every other case in this file seeds organization_members with only P's
    // own rows, so a mutant that dropped `.eq("user_id", userId)` from the
    // read changed nothing any of them could see: with the whole table
    // already belonging to the caller, reading all of it or just theirs
    // looks identical. This seeds someone else's owner row and no row at all
    // for P, so only the filtered read refuses P.
    const db = world(null, {
      organization_members: [
        { organization_id: ORG, user_id: "someone-else", role: "owner" },
      ],
    });

    const err = await service(db)
      .createLocation(P, DTO)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NOT_ORGANISATION_OWNER",
    });
    expect(db.tables.restaurants).toHaveLength(0);
  });

  it("refuses a person with no organisation row, even one who owns a house by their users row", async () => {
    const db = world(null, {
      users: [{ user_id: P, restaurant_id: "house-a", role: "owner" }],
    });

    await expect(service(db).createLocation(P, DTO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.tables.restaurants).toHaveLength(0);
  });

  it("answers 503 and creates nothing when the organisation rows cannot be read", async () => {
    const db = world("owner");
    db.errors["organization_members:select"] = { message: "connection reset" };

    await expect(service(db).createLocation(P, DTO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(db.tables.restaurants).toHaveLength(0);
  });

  it("opens the location in the named group's organisation when the owner owns it", async () => {
    const db = world("owner", {
      restaurants: [{ id: "house-existing", organization_id: ORG }],
      user_restaurant_access: [
        { user_id: P, restaurant_id: "house-existing", is_active: true },
      ],
    });

    await service(db).createLocation(P, { ...DTO, chainId: "chain-own" });

    const created = db.tables.restaurants.find(
      (r: any) => r.chain_id === "chain-own",
    );
    expect(created).toMatchObject({
      organization_id: ORG,
      chain_id: "chain-own",
    });
  });

  it("refuses a group in an organisation the caller does not own", async () => {
    const db = world("owner");

    await expect(
      service(db).createLocation(P, { ...DTO, chainId: "chain-other" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tables.restaurants).toHaveLength(0);
  });

  it("asks which organisation when the caller owns two and names no group", async () => {
    const db = world("owner", {
      organization_members: [
        { organization_id: ORG, user_id: P, role: "owner" },
        { organization_id: OTHER_ORG, user_id: P, role: "owner" },
      ],
    });

    await expect(service(db).createLocation(P, DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.tables.restaurants).toHaveLength(0);
  });
});

/**
 * OD-131(a) (`OPEN-DECISIONS.md`), the founder's batch-4 answer, 2026-09-19
 * (`founder-sketch-decisions-106-115.md`): an organisation owner removed from
 * EVERY house of their organisation keeps the organisation role — a
 * house-level removal never touches `organization_members` — but opening a
 * location now ALSO requires an active `user_restaurant_access` row in a
 * house of the SAME organisation being opened into. Before this fix, the
 * owner-only gate above was necessary but not sufficient: an owner of
 * nothing could still open a location and immediately own it, exactly the
 * gap ADR 0164's "Open items for the founder (a)" left unruled.
 */
describe("createLocation: an organisation owner also needs an active house in that organisation (ADR 0164, OD-131a)", () => {
  it("refuses an organisation owner who holds no active house anywhere", async () => {
    const db = world("owner"); // user_restaurant_access defaults to []

    const err = await service(db)
      .createLocation(P, DTO)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NO_ACTIVE_HOUSE_IN_ORGANISATION",
    });
    expect(db.tables.restaurants).toHaveLength(0);
  });

  it("refuses an organisation owner whose only active house belongs to a DIFFERENT organisation", async () => {
    const db = world("owner", {
      restaurants: [
        { id: "chain-own", organization_id: ORG, name: "Harbour" },
        { id: "chain-other", organization_id: OTHER_ORG, name: "Elsewhere" },
        { id: "house-elsewhere", organization_id: OTHER_ORG, name: "Elsewhere House" },
      ],
      user_restaurant_access: [
        { user_id: P, restaurant_id: "house-elsewhere", is_active: true },
      ],
    });

    const err = await service(db)
      .createLocation(P, DTO)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NO_ACTIVE_HOUSE_IN_ORGANISATION",
    });
    expect(db.tables.restaurants).toHaveLength(3);
  });

  it("refuses an organisation owner whose only house in this organisation is an INACTIVE (removed) membership", async () => {
    const db = world("owner", {
      restaurants: [{ id: "house-in-org", organization_id: ORG, name: "Moda" }],
      user_restaurant_access: [
        { user_id: P, restaurant_id: "house-in-org", is_active: false },
      ],
    });

    const err = await service(db)
      .createLocation(P, DTO)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NO_ACTIVE_HOUSE_IN_ORGANISATION",
    });
  });

  it("lets an organisation owner open a location once they hold an active house in that organisation", async () => {
    const db = world("owner", {
      restaurants: [{ id: "house-in-org", organization_id: ORG, name: "Moda" }],
      user_restaurant_access: [
        { user_id: P, restaurant_id: "house-in-org", is_active: true },
      ],
    });

    const created = await service(db).createLocation(P, DTO);

    expect(db.tables.restaurants).toHaveLength(2);
    expect(
      db.tables.restaurants.find((r: any) => r.id === created.id),
    ).toMatchObject({ organization_id: ORG });
  });

  it("answers 503 and creates nothing when the caller's active houses cannot be read", async () => {
    const db = world("owner");
    db.errors["user_restaurant_access:select"] = {
      message: "connection reset",
    };

    await expect(service(db).createLocation(P, DTO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(db.tables.restaurants).toHaveLength(0);
  });
});
