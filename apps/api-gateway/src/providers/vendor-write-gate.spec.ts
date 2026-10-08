import { HttpException } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { VendorTermsController } from "../vendor-terms/vendor-terms.controller";

/**
 * VEN-W30 (founder, 2026-10-08, "Staff read only"): staff read the vendor
 * book; every write to it is a manager's or an owner's act, refused by the
 * server before anything is touched.
 *
 * Every dependency below is a Proxy that records any call, so "nothing was
 * changed" is asserted as "no service and no database was reached", not as
 * the absence of a particular method.
 */
const HOUSE = "house-1";
const user = { userId: "person-1", restaurantId: HOUSE };

function recorder() {
  const calls: string[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => (...args: unknown[]) => {
        calls.push(String(prop));
        void args;
        return Promise.resolve({});
      },
    },
  );
  return { calls, proxy };
}

function rig(role: string | null) {
  const service = recorder();
  const db = recorder();
  const organizations = {
    resolveRestaurantRole: jest.fn().mockResolvedValue(role),
  };
  const providers = new ProvidersController(
    service.proxy as never,
    organizations as never,
  );
  const intelligence = new ProviderIntelligenceController(
    service.proxy as never,
    { supabase: db.proxy } as never,
    organizations as never,
  );
  const terms = new VendorTermsController(
    service.proxy as never,
    organizations as never,
  );
  return { providers, intelligence, terms, service, db, organizations };
}

type Rig = ReturnType<typeof rig>;
const WRITES: Array<[string, (r: Rig) => Promise<unknown>]> = [
  ["POST /providers/bulk-import", (r) => r.providers.bulkImport({ providers: [] } as never, user as never)],
  ["POST /providers/import", (r) => r.providers.importProviders({ providers: [] } as never, user as never)],
  ["POST /providers", (r) => r.providers.createProvider({ name: "x" } as never, user as never)],
  ["PATCH /providers/:id", (r) => r.providers.updateProvider("p1", { name: "x" } as never, user as never)],
  ["DELETE /providers/:id", (r) => r.providers.deleteProvider("p1", user as never)],
  ["POST /providers/:id/rate", (r) => r.providers.rateProvider("p1", { rating: 5 } as never, user as never)],
  ["POST /providers/:id/contacts", (r) => r.providers.addProviderContact("p1", { name: "x" } as never, user as never)],
  ["PATCH /providers/:id/contacts/:contactId", (r) => r.providers.updateProviderContact("p1", "c1", { name: "x" } as never, user as never)],
  ["DELETE /providers/:id/contacts/:contactId", (r) => r.providers.deleteProviderContact("p1", "c1", user as never)],
  ["PATCH /providers/:id/contact-date", (r) => r.providers.updateContactDate("p1", { lastContactDate: "2026-10-08" } as never, user as never)],
  ["PATCH /providers/:id/intelligence", (r) => r.providers.updateIntelligence("p1", {} as never, user as never)],
  ["POST /providers/:id/locations", (r) => r.providers.createProviderLocation("p1", { name: "x" } as never, user as never)],
  ["PATCH /providers/:id/locations/:locationId", (r) => r.providers.updateProviderLocation("p1", "l1", { name: "x" } as never, user as never)],
  ["DELETE /providers/:id/locations/:locationId", (r) => r.providers.deleteProviderLocation("p1", "l1", user as never)],
  ["POST /providers/:id/outreach", (r) => r.intelligence.triggerOutreach("p1", {}, user as never)],
  ["POST /providers/:id/onboard", (r) => r.intelligence.triggerOnboarding("p1", user as never)],
  ["PUT /vendor-terms/:providerId", (r) => r.terms.write(HOUSE, "p1", {} as never, { user })],
];

describe("VEN-W30: only a manager or an owner changes the vendor book", () => {
  it.each(WRITES)("%s refuses staff with a 403 in words and touches nothing", async (_route, call) => {
    const r = rig("staff");
    const err = await call(r).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect((err as HttpException).message).toMatch(
      /manager's or an owner's act.*You are signed in as staff at this house, so nothing was changed/,
    );
    expect(r.service.calls).toEqual([]);
    expect(r.db.calls).toEqual([]);
    expect(r.organizations.resolveRestaurantRole).toHaveBeenCalledWith("person-1", HOUSE);
  });

  it.each(WRITES)("%s refuses a session with no proven role", async (_route, call) => {
    const r = rig(null);
    const err = await call(r).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as HttpException).getStatus()).toBe(403);
    expect((err as HttpException).message).toMatch(/could not be shown to hold any role/);
    expect(r.service.calls).toEqual([]);
    expect(r.db.calls).toEqual([]);
  });

  it.each(WRITES)("%s lets a manager through to the service", async (_route, call) => {
    const r = rig("manager");
    await call(r).catch(() => undefined);
    expect(r.service.calls.length + r.db.calls.length).toBeGreaterThan(0);
  });

  it("lets an owner through too", async () => {
    const r = rig("owner");
    await r.providers.createProvider({ name: "x" } as never, user as never).catch(() => undefined);
    expect(r.service.calls).toContain("createProvider");
  });
});
