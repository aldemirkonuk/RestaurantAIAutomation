import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

/**
 * Provider sub-resources were keyed by provider id alone (ADR 0147). GET
 * :id/orders, :id/performance and :id/contacts, and the contact writes, took
 * no restaurant from the token, and the service filtered only on
 * `provider_id`, so any signed-in user of any house who held a provider uuid
 * could read another house's order history, performance row and contacts, or
 * write contacts onto it.
 *
 * GET :id already 404s a foreign provider (`getProvider` filters
 * restaurant_id). These routes now call that first; a foreign id is the same
 * 404 as a missing one, and the sub-table is not queried.
 */

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROV_A = "11111111-1111-4111-8111-111111111111";
const PROV_B = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `provider-subresources-are-house-scoped.spec: ${name}.${String(prop)} was called`,
        );
      },
    },
  ) as never;

function makeSupabase(seed: {
  providers: Row[];
  procurement_orders: Row[];
  provider_performance_metrics: Row[];
  provider_contacts: Row[];
}) {
  const tables: Record<string, Row[]> = {
    providers: seed.providers.map((r) => ({ ...r })),
    procurement_orders: seed.procurement_orders.map((r) => ({ ...r })),
    provider_performance_metrics: seed.provider_performance_metrics.map(
      (r) => ({ ...r }),
    ),
    provider_contacts: seed.provider_contacts.map((r) => ({ ...r })),
  };
  const queried: string[] = [];

  const from = (table: string) => {
    queried.push(table);
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return q;
    };
    q.is = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] == val);
      return q;
    };
    q.order = self;
    q.limit = self;
    q.maybeSingle = () =>
      Promise.resolve({ data: rows[0] ?? null, error: null });
    q.single = () =>
      Promise.resolve(
        rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "none" } },
      );
    q.insert = (payload: Row) => {
      const row = { id: "new-contact", ...payload };
      tables[table].push(row);
      rows = [row];
      return q;
    };
    q.update = () => q;
    q.delete = () => q;
    (q as { then: typeof Promise.prototype.then }).then = (
      onFulfilled,
      onRejected,
    ) =>
      Promise.resolve({ data: rows, error: null }).then(
        onFulfilled,
        onRejected,
      );
    return q;
  };

  return { from, queried };
}

function controllerFor(supabase: { from: (t: string) => unknown }) {
  return new ProvidersController(
    new ProvidersService(
      { supabase } as never,
      { track: async () => undefined } as never,
      forbidden("ProcurementService"),
    ),
    forbidden("OrganizationsService"),
  );
}

const seed = () => ({
  providers: [
    { id: PROV_A, name: "House A vendor", restaurant_id: HOUSE_A },
    { id: PROV_B, name: "House B vendor", restaurant_id: HOUSE_B },
  ],
  procurement_orders: [
    { id: "ord-a", provider_id: PROV_A, restaurant_id: HOUSE_A, total: 12 },
    { id: "ord-b", provider_id: PROV_B, restaurant_id: HOUSE_B, total: 99 },
  ],
  provider_performance_metrics: [
    { id: "perf-a", provider_id: PROV_A, on_time: 1 },
    { id: "perf-b", provider_id: PROV_B, on_time: 0 },
  ],
  provider_contacts: [
    { id: "c-a", provider_id: PROV_A, name: "A sales", is_primary: true },
    { id: "c-b", provider_id: PROV_B, name: "B sales", is_primary: true },
  ],
});

const userA = { restaurantId: HOUSE_A };
const userB = { restaurantId: HOUSE_B };

describe("provider sub-resources belong to the caller's house", () => {
  it("GET orders for another house's provider is 404 and does not read orders", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderOrders(PROV_A, userB),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).toEqual(["providers"]);
    expect(supabase.queried).not.toContain("procurement_orders");
  });

  it("GET orders for this house's provider returns only that house's rows", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    const rows = await controller.getProviderOrders(PROV_A, userA);
    expect(rows).toEqual([
      { id: "ord-a", provider_id: PROV_A, restaurant_id: HOUSE_A, total: 12 },
    ]);
    expect(supabase.queried).toContain("procurement_orders");
  });

  it("GET performance for another house's provider is 404 and does not read metrics", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderPerformance(PROV_A, userB),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).not.toContain("provider_performance_metrics");
  });

  it("GET contacts for another house's provider is 404 and does not read contacts", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderContacts(PROV_A, userB),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).not.toContain("provider_contacts");
  });

  it("GET contacts for this house's provider returns that vendor's people", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    const rows = await controller.getProviderContacts(PROV_A, userA);
    expect(rows).toEqual([
      {
        id: "c-a",
        providerId: PROV_A,
        name: "A sales",
        email: undefined,
        phone: undefined,
        role: undefined,
        isPrimary: true,
      },
    ]);
  });

  it("POST a contact onto another house's provider is 404 and inserts nothing", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.addProviderContact(
        PROV_A,
        { name: "intruder" } as never,
        userB,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).not.toContain("provider_contacts");
  });

  it("a session that names no house is 403, not an unscoped read", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderOrders(PROV_A, { restaurantId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(supabase.queried).toEqual([]);
  });
});
