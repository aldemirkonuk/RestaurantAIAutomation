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
 * The chain routes (sim wave 22, org-chain-owner.md):
 *
 *   F-313  create, rename and delete are for an owner of the organisation.
 *   F-657  a house goes only into a chain of its own organisation.
 *   F-658  a failed read is a 503, never "no chain"; the GET never writes.
 *   F-659  owners get each chain's real house count; others see only the
 *          chains their own houses are in, with no count.
 *   F-660  a chain is created in the session house's organisation, so an
 *          owner of two organisations can create one.
 */

const ORG = "org-1";
const ORG2 = "org-2";
const P = "user-p";

function world(extra: Partial<Record<string, any[]>> = {}): StubDb {
  return makeStubDb({
    organization_members: [{ organization_id: ORG, user_id: P, role: "owner" }],
    organizations: [{ id: ORG, owner_id: P }],
    restaurant_chains: [
      { id: "chain-a", organization_id: ORG, name: "Harbour" },
      { id: "chain-b", organization_id: ORG, name: "Uplands" },
      { id: "chain-x", organization_id: ORG2, name: "Elsewhere" },
    ],
    restaurants: [
      { id: "house-1", organization_id: ORG, chain_id: "chain-a" },
      { id: "house-2", organization_id: ORG, chain_id: "chain-a" },
      { id: "house-3", organization_id: ORG, chain_id: "chain-b" },
      { id: "house-9", organization_id: ORG2, chain_id: null },
    ],
    user_restaurant_access: [
      { user_id: P, restaurant_id: "house-1", role: "owner", is_active: true },
    ],
    users: [],
    ...extra,
  });
}

const service = (db: StubDb) => new OrganizationsService(asDatabaseService(db));
const settle = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe("F-313: chain create, rename and delete are for an organisation owner", () => {
  const asManager = () =>
    world({
      organization_members: [
        { organization_id: ORG, user_id: P, role: "manager" },
      ],
    });

  it("refuses a manager of the organisation on create and creates nothing", async () => {
    const db = asManager();
    const err = await settle(
      service(db).createChain(P, { name: "New" }, "house-1"),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NOT_ORGANISATION_OWNER",
    });
    expect(db.tables.restaurant_chains).toHaveLength(3);
  });

  it("refuses a manager on rename and changes nothing", async () => {
    const db = asManager();
    await expect(
      service(db).renameChain(P, "chain-a", "Renamed"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      db.tables.restaurant_chains.find((c: any) => c.id === "chain-a")?.name,
    ).toBe("Harbour");
  });

  it("refuses a manager on delete and deletes nothing", async () => {
    const db = asManager();
    await expect(service(db).deleteChain(P, "chain-a")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.tables.restaurant_chains).toHaveLength(3);
  });

  it("lets the owner rename and delete a chain of their organisation", async () => {
    const db = world();
    await service(db).renameChain(P, "chain-a", "Renamed");
    expect(
      db.tables.restaurant_chains.find((c: any) => c.id === "chain-a")?.name,
    ).toBe("Renamed");
    await service(db).deleteChain(P, "chain-b");
    expect(db.tables.restaurant_chains.map((c: any) => c.id).sort()).toEqual([
      "chain-a",
      "chain-x",
    ]);
  });
});

describe("F-657: a house goes only into a chain of its own organisation", () => {
  it("refuses a chain of another organisation the caller also belongs to", async () => {
    const db = world({
      organization_members: [
        { organization_id: ORG, user_id: P, role: "owner" },
        { organization_id: ORG2, user_id: P, role: "manager" },
      ],
    });
    await expect(
      service(db).updateLocation(P, "house-1", { chainId: "chain-x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      db.tables.restaurants.find((r: any) => r.id === "house-1")?.chain_id,
    ).toBe("chain-a");
  });

  it("still moves a house to a chain of its own organisation", async () => {
    const db = world();
    await service(db).updateLocation(P, "house-1", { chainId: "chain-b" });
    expect(
      db.tables.restaurants.find((r: any) => r.id === "house-1")?.chain_id,
    ).toBe("chain-b");
  });
});

describe("F-912: moving a branch between chains is for an organisation owner", () => {
  const asManager = () =>
    world({
      organization_members: [
        { organization_id: ORG, user_id: P, role: "manager" },
      ],
      user_restaurant_access: [
        {
          user_id: P,
          restaurant_id: "house-1",
          role: "manager",
          is_active: true,
        },
      ],
    });
  const chainOf = (db: StubDb) =>
    db.tables.restaurants.find((r: any) => r.id === "house-1")?.chain_id;

  it("refuses a manager who takes a branch out of its chain, and changes nothing", async () => {
    const db = asManager();
    const err = await settle(
      service(db).updateLocation(P, "house-1", { chainId: null }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "NOT_ORGANISATION_OWNER",
    });
    expect(chainOf(db)).toBe("chain-a");
  });

  it("refuses a manager who moves a branch to another chain, and changes nothing", async () => {
    const db = asManager();
    const err = await settle(
      service(db).updateLocation(P, "house-1", {
        name: "Quay",
        chainId: "chain-b",
      }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(chainOf(db)).toBe("chain-a");
    expect(
      db.tables.restaurants.find((r: any) => r.id === "house-1")?.name,
    ).toBeUndefined();
  });

  it("lets a manager rename a branch while resending its own chain", async () => {
    const db = asManager();
    await service(db).updateLocation(P, "house-1", {
      name: "Quay",
      chainId: "chain-a",
    });
    expect(chainOf(db)).toBe("chain-a");
    expect(
      db.tables.restaurants.find((r: any) => r.id === "house-1")?.name,
    ).toBe("Quay");
  });
});

describe("F-658: the chain register refuses on a failed read and never writes", () => {
  it("answers 503 when the organisation rows cannot be read", async () => {
    const db = world();
    db.errors["organization_members:select"] = { message: "connection reset" };
    await expect(service(db).getChainsForUser(P)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("answers 503 when the chains cannot be read", async () => {
    const db = world();
    db.errors["restaurant_chains:select"] = { message: "connection reset" };
    await expect(service(db).getChainsForUser(P)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("does not write an organisation row for a legacy person on a GET", async () => {
    const db = world({
      organization_members: [],
      users: [{ user_id: P, restaurant_id: "house-1" }],
    });
    await service(db).getChainsForUser(P);
    expect(db.tables.organization_members).toHaveLength(0);
    expect(db.ops.some((o: any) => o.op === "upsert")).toBe(false);
  });
});

describe("F-659: what the chain register shows, and to whom", () => {
  it("gives an owner every chain with the houses it really holds", async () => {
    const chains = await service(world()).getChainsForUser(P);
    expect(chains.map((c) => [c.id, c.location_count]).sort()).toEqual([
      ["chain-a", 2],
      ["chain-b", 1],
    ]);
  });

  it("shows a manager only the chains their own houses are in, with no count", async () => {
    const db = world({
      organization_members: [
        { organization_id: ORG, user_id: P, role: "manager" },
      ],
    });
    const chains = await service(db).getChainsForUser(P);
    expect(chains.map((c) => [c.id, c.location_count])).toEqual([
      ["chain-a", null],
    ]);
  });
});

describe("F-660: a chain is created in the session house's organisation", () => {
  const twoOrgs = () =>
    world({
      organization_members: [
        { organization_id: ORG, user_id: P, role: "owner" },
        { organization_id: ORG2, user_id: P, role: "owner" },
      ],
      organizations: [
        { id: ORG, owner_id: P },
        { id: ORG2, owner_id: P },
      ],
    });

  it("lets an owner of two organisations create a chain from the house they are in", async () => {
    const db = twoOrgs();
    const chain = await service(db).createChain(
      P,
      { name: "North" },
      "house-9",
    );
    expect(
      db.tables.restaurant_chains.find((c: any) => c.id === chain.id),
    ).toMatchObject({ organization_id: ORG2, name: "North" });
  });

  it("asks for a house when an owner of two organisations has none in the session", async () => {
    const db = twoOrgs();
    await expect(
      service(db).createChain(P, { name: "North" }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.restaurant_chains).toHaveLength(3);
  });

  it("refuses a house in an organisation the caller does not own", async () => {
    const db = world();
    await expect(
      service(db).createChain(P, { name: "North" }, "house-9"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.restaurant_chains).toHaveLength(3);
  });
});
