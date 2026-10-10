import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * F-800: `GET /procurement/orders/:id` states the agreement line's currency.
 *
 * `verifyReceipt` compares a bill against `line.currency ?? header.currency`.
 * The phone's receiving screen reads this route, so it must be told the line's
 * money too, or a legacy order whose header and line disagree is compared on
 * one side and held on the other. Three states, asserted with `in`.
 */
type Line = Record<string, unknown> | null | { error: string };

function makeDb(line: Line) {
  const from = (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      gte: () => q,
      lte: () => q,
      order: () => q,
      single: () => q,
      maybeSingle: () => q,
      then: (resolve: (v: any) => void) => {
        if (table === "procurement_orders") {
          return resolve({
            data: {
              id: "ord-1",
              order_number: "ORD-1",
              restaurant_id: "rest-1",
              inventory_id: "inv-1",
              provider_id: "prov-1",
              quantity: 6,
              status: "DELIVERED",
              currency: "TRY",
              inventory: { wine_name: "Barolo" },
              provider: { name: "Vinifera" },
            },
            error: null,
          });
        }
        if (table === "procurement_order_items") {
          if (line && "error" in line) {
            return resolve({ data: null, error: { message: line.error } });
          }
          return resolve({ data: line, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { supabase: { from } } as unknown as DatabaseService;
}

function getOrder(line: Line) {
  return new ProcurementService(
    makeDb(line),
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  ).getOrder("rest-1", "ord-1");
}

describe("order detail names the agreement line's money (F-800)", () => {
  it("sends the line's currency beside the header's when they differ", async () => {
    const res = await getOrder({ id: "line-1", currency: "EUR" });
    expect(res.currency).toBe("TRY");
    expect(res.agreedCurrency).toBe("EUR");
  });

  it("sends null when the line names no currency, or there is no line", async () => {
    const unstated = await getOrder({ id: "line-1", currency: null });
    expect("agreedCurrency" in unstated).toBe(true);
    expect(unstated.agreedCurrency).toBeNull();

    const noLine = await getOrder(null);
    expect("agreedCurrency" in noLine).toBe(true);
    expect(noLine.agreedCurrency).toBeNull();
  });

  it("sends nothing when the line could not be read, never a guessed money", async () => {
    const res = await getOrder({ error: "connection reset" });
    expect(res.agreedCurrency).toBeUndefined();
    expect(JSON.parse(JSON.stringify(res))).not.toHaveProperty(
      "agreedCurrency",
    );
  });
});
