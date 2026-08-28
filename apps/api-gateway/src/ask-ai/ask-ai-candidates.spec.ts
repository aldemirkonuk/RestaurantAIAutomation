import { AskAiService } from "./ask-ai.service";
import { DatabaseService } from "../database/database.service";

/**
 * `GET /ask-ai/candidates` — the picker's source of truth.
 *
 * What these lock in is not "the endpoint returns rows". It is the properties
 * that make a picker built from it SAFE:
 *
 *  1. Every id offered is in the grounding set. If those two ever diverge, the
 *     picker becomes a machine for producing rejected confirms — a worse
 *     control than the read-only uuid it replaced.
 *  2. A failed query THROWS. An empty list reads as "this restaurant has no
 *     inventory", and a picker rendering "no items" over a broken select is
 *     the `catch { return [] }` shape this repo keeps deleting.
 *  3. Labels survive null names. A picker whose options are blank is not a
 *     picker; `(unnamed)` is uglier and more honest.
 *  4. A list AT its cap says so. "Not in the list" and "beyond what Ask AI can
 *     reach at all" are different facts, and only the second is true at a cap.
 */

type Row = Record<string, any>;

/**
 * A Supabase-ish client that records the ORDER and LIMIT clauses it was given,
 * because determinism of the capped window is a tested property here: the same
 * query runs once for the picker and again to ground the confirm, and an
 * unordered `.limit()` lets Postgres hand back a different subset each time.
 */
function makeFakeClient(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const orders: Record<string, string[]> = {};
  const limits: Record<string, number> = {};
  const client = {
    from(table: string) {
      const api: any = {
        select: () => api,
        eq: () => api,
        not: () => api,
        order(col: string) {
          (orders[table] ||= []).push(col);
          return api;
        },
        limit(n: number) {
          limits[table] = n;
          return api;
        },
        then(resolve: any) {
          if (errors[table]) {
            resolve({ data: null, error: { message: errors[table] } });
            return;
          }
          resolve({ data: tables[table] ?? [], error: null });
        },
      };
      return api;
    },
  };
  return { client, orders, limits };
}

function makeService(fake: ReturnType<typeof makeFakeClient>): AskAiService {
  return new AskAiService(
    { getClient: () => fake.client } as unknown as DatabaseService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const INV = "11111111-1111-4111-8111-111111111111";
const PROV = "22222222-2222-4222-8222-222222222222";
const ORD = "33333333-3333-4333-8333-333333333333";

function fullTables(overrides: Record<string, Row[]> = {}) {
  return {
    restaurant_inventory: [{ id: INV, wine_name: "Barolo 2019" }],
    providers: [{ id: PROV, name: "Acme Wines", is_active: true }],
    procurement_orders: [{ id: ORD, provider_id: PROV, status: "sent" }],
    ...overrides,
  };
}

describe("AskAiService.listCandidates", () => {
  it("returns ids with labels, not bare uuids", async () => {
    const fake = makeFakeClient(fullTables());
    const lists = await makeService(fake).listCandidates("r1");

    expect(lists.inventory).toEqual([{ id: INV, label: "Barolo 2019" }]);
    expect(lists.providers).toEqual([{ id: PROV, label: "Acme Wines" }]);
    expect(lists.orders).toEqual([
      {
        id: ORD,
        label: "Acme Wines · sent",
        providerId: PROV,
        providerName: "Acme Wines",
        status: "sent",
      },
    ]);
  });

  it("labels a nameless row rather than rendering a blank option", async () => {
    const fake = makeFakeClient(
      fullTables({
        restaurant_inventory: [{ id: INV, wine_name: null }],
        providers: [{ id: PROV, name: "" }],
      }),
    );
    const lists = await makeService(fake).listCandidates("r1");

    expect(lists.inventory[0].label).toBe("(unnamed)");
    expect(lists.providers[0].label).toBe("(unnamed)");
  });

  it("names an order whose provider is not in the candidate set", async () => {
    // The provider went inactive; the order it left behind is still open, and
    // is still something an operator may want to reply on.
    const fake = makeFakeClient(fullTables({ providers: [] }));
    const lists = await makeService(fake).listCandidates("r1");

    expect(lists.orders[0].providerName).toBeNull();
    expect(lists.orders[0].label).toBe("Unknown vendor · sent");
  });

  it("reports the caps it applied, and whether a list hit one", async () => {
    const atCap = Array.from({ length: 30 }, (_, i) => ({
      id: `p-${i}`,
      name: `Vendor ${i}`,
    }));
    const fake = makeFakeClient(fullTables({ providers: atCap }));
    const lists = await makeService(fake).listCandidates("r1");

    expect(lists.limits).toEqual({ inventory: 60, providers: 30, orders: 20 });
    expect(lists.capped).toEqual({
      inventory: false,
      providers: true,
      orders: false,
    });
    // The caps reported are the caps actually sent to the database.
    expect(fake.limits).toEqual({
      restaurant_inventory: 60,
      providers: 30,
      procurement_orders: 20,
    });
  });

  it("orders every capped list, so the window is the same on the next call", async () => {
    // Without this, "the 60 items the picker offered" and "the 60 ids the
    // confirm grounds against" are two different arbitrary subsets.
    const fake = makeFakeClient(fullTables());
    await makeService(fake).listCandidates("r1");

    expect(fake.orders.restaurant_inventory).toEqual(["wine_name", "id"]);
    expect(fake.orders.providers).toEqual(["name", "id"]);
    expect(fake.orders.procurement_orders).toEqual(["created_at", "id"]);
  });

  it.each([["restaurant_inventory"], ["providers"], ["procurement_orders"]])(
    "throws when the %s query fails, never an empty list",
    async (table) => {
      const fake = makeFakeClient(fullTables(), { [table]: "boom" });

      await expect(makeService(fake).listCandidates("r1")).rejects.toThrow(
        "Ask AI is temporarily unavailable.",
      );
    },
  );
});
