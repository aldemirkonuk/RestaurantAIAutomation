import { ForbiddenException } from "@nestjs/common";
import { BeveragesController } from "./beverages.controller";
import { BeveragesService } from "./beverages.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * F-270 (coordinator's call for the founder, 2026-10-08): a cocktail's price
 * and taking it off the list are an owner's or a manager's, the same people
 * who price a line on /menu. The recipe and the other fields stay open.
 *
 * The real OrganizationsService decides; only its access-row read is stubbed.
 */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

const RID = "550e8400-e29b-41d4-a716-446655440000";
const CID = "7f1c1a2e-0000-4000-8000-000000000001";
const USER = { userId: "u-1" };

/** A service whose cocktails row holds `price`, recording what was written. */
function service(price: number | null) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    getClient: () => ({
      from: () => {
        const self: Record<string, unknown> = {};
        let patch: Record<string, unknown> | null = null;
        for (const m of ["select", "eq", "is"]) self[m] = jest.fn(() => self);
        self.update = jest.fn((p: Record<string, unknown>) => {
          patch = p;
          return self;
        });
        self.insert = jest.fn((row: Record<string, unknown>) => {
          writes.push(row);
          return self;
        });
        self.single = jest.fn(() => Promise.resolve({ data: { id: CID }, error: null }));
        self.maybeSingle = jest.fn(() => {
          if (patch) writes.push(patch);
          return Promise.resolve({ data: patch ? { id: CID } : { price }, error: null });
        });
        return self;
      },
    }),
  };
  return { svc: new BeveragesService(db as never), writes };
}

describe("cocktail price and retire — owner or manager only (F-270)", () => {
  it.each(["staff", null])("%s is refused a NEW price, and nothing is written", async (role) => {
    const { svc, writes } = service(14);
    const c = new BeveragesController(svc, orgs(role as string | null));
    await expect(c.updateCocktail(RID, CID, { price: 18 }, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(writes).toHaveLength(0);
  });

  it("staff may amend the method when the page sends the price unchanged", async () => {
    const { svc, writes } = service(14);
    const c = new BeveragesController(svc, orgs("staff"));
    await c.updateCocktail(RID, CID, { method: "Stirred", price: 14 }, USER);
    expect(writes[0]).toMatchObject({ method: "Stirred" });
    expect(writes[0]).not.toHaveProperty("price");
  });

  it.each(["owner", "manager"])("a %s may change the price", async (role) => {
    const { svc, writes } = service(14);
    const c = new BeveragesController(svc, orgs(role));
    await c.updateCocktail(RID, CID, { price: 18 }, USER);
    expect(writes[0]).toMatchObject({ price: 18 });
  });

  it.each(["staff", null])("%s may not take a cocktail off the list", async (role) => {
    const { svc, writes } = service(14);
    const c = new BeveragesController(svc, orgs(role as string | null));
    await expect(c.deleteCocktail(RID, CID, USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);
  });

  it("a manager may take a cocktail off the list", async () => {
    const { svc } = service(14);
    const c = new BeveragesController(svc, orgs("manager"));
    await expect(c.deleteCocktail(RID, CID, USER)).resolves.toEqual({ id: CID, retired: true });
  });

  it("staff may record an unpriced cocktail but not a priced one", async () => {
    const { svc, writes } = service(null);
    const c = new BeveragesController(svc, orgs("staff"));
    await expect(
      c.createCocktail(RID, { name: "Negroni", price: 16 }, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);
    await c.createCocktail(RID, { name: "Negroni" }, USER);
    expect(writes[0]).toMatchObject({ name: "Negroni", price: null });
  });

  it("a session naming no one is refused before anything is written", async () => {
    const { svc, writes } = service(14);
    const c = new BeveragesController(svc, orgs("owner"));
    await expect(c.deleteCocktail(RID, CID, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);
  });
});
