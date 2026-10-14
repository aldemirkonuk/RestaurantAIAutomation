/**
 * A confirmed deal says again whether tax is inside its price — ADR 0341 F3
 * (founder 2026-10-12, S218: "Yes, stamp cost basis").
 *
 * `confirmDeal` writes the confirmed price onto the order line, and the
 * trigger `a_changed_cost_loses_its_unstated_tax_basis` clears the line's
 * `price_tax_basis` whenever a price changes in a write that leaves the basis
 * as it was. The confirm route took no basis, so every price edited at
 * confirmation lost the one the order was placed with, and margin advice then
 * refused the cost as "not stated". Ledger S238: owed by w109-cost-basis-ui.
 *
 * Restating the SAME basis inside the price's own write is cleared too (the
 * trigger compares NEW with OLD), so the stamp is a second write.
 */
import { ForbiddenException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import {
  A_MANAGER,
  A_SEAL,
  GATES_AFTER_LEDGER,
} from "./testing/passing-vendor-gates";

type Row = Record<string, any>;

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const LINE = "66666666-6666-4666-8666-666666666666";
const INVENTORY = "11111111-1111-4111-8111-111111111111";

function makeDb(houseTaxBasis: string | null) {
  const updates: Array<{ table: string; payload: Row; filters: Row }> = [];
  const reads: string[] = [];

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select";
      const filters: Row = {};
      let payload: Row = {};
      const settle = (shape: "one" | "many"): Row => {
        if (op === "update") {
          updates.push({ table, payload, filters: { ...filters } });
          return { data: shape === "many" ? [] : {}, error: null };
        }
        if (op === "select") reads.push(table);
        if (table === "procurement_orders")
          return {
            data: {
              id: ORDER,
              restaurant_id: REST,
              inventory_id: INVENTORY,
              provider_id: "prov-1",
              quantity: 12,
              bottles_total: 12,
              unit_type: "bottle",
              final_price: 40,
              status: "NEGOTIATING",
              providers: { name: "Kavaklidere", contact_email: null },
            },
            error: null,
          };
        if (table === "procurement_order_items")
          return {
            data: {
              id: LINE,
              unit_type: "bottle",
              bottles_per_unit: 1,
              price_uom: "bottle",
              price_pack_size: 1,
              final_unit_price: 40,
              currency: "TRY",
            },
            error: null,
          };
        if (table === "restaurants")
          return { data: { tax_basis: houseTaxBasis }, error: null };
        if (table === "restaurant_inventory")
          return {
            data: {
              id: INVENTORY,
              master_wine_id: null,
              wine_name: "Kalecik Karasi",
            },
            error: null,
          };
        return { data: shape === "many" ? [] : null, error: null };
      };
      const q: any = {
        select: () => q,
        eq(col: string, value: any) {
          filters[col] = value;
          return q;
        },
        neq: () => q,
        not: () => q,
        or: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        gte: () => q,
        lt: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert() {
          op = "insert";
          return q;
        },
        update(p: Row) {
          op = "update";
          payload = p;
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };
  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;
  return { db, updates, reads };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

async function confirm(houseTaxBasis: string | null, priceTaxBasis?: string) {
  const t = makeDb(houseTaxBasis);
  await new ProcurementService(
    t.db,
    events,
    ledger,
    ...GATES_AFTER_LEDGER,
  ).confirmDeal(
    REST,
    ORDER,
    A_MANAGER,
    {
      finalPrice: 36,
      sendConfirmation: false,
      ...(priceTaxBasis ? { priceTaxBasis } : {}),
    },
    A_SEAL,
  );
  const lineWrites = t.updates.filter(
    (u) => u.table === "procurement_order_items",
  );
  return { ...t, lineWrites };
}

describe("confirmDeal stamps whether tax is inside the confirmed price (ADR 0341 F3)", () => {
  it("stamps what the confirmer said, in a write after the price's own", async () => {
    const { lineWrites } = await confirm("prices_include_tax", "excludes_tax");

    expect(lineWrites).toHaveLength(2);
    expect(lineWrites[0].payload).toEqual({ final_unit_price: 36 });
    expect(lineWrites[1].payload).toEqual({ price_tax_basis: "excludes_tax" });
    expect(lineWrites[1].filters).toMatchObject({
      id: LINE,
      restaurant_id: REST,
    });
  });

  it("stamps nothing when nobody said, and reads nothing to decide it", async () => {
    const { lineWrites, reads } = await confirm("prices_include_tax");
    const said = await confirm("prices_include_tax", "excludes_tax");
    const houseReads = (r: string[]) =>
      r.filter((t) => t === "restaurants").length;

    expect(lineWrites).toHaveLength(1);
    expect(lineWrites[0].payload).toEqual({ final_unit_price: 36 });
    // The house's basis is read only to stamp a statement: one read fewer.
    expect(houseReads(reads)).toBe(houseReads(said.reads) - 1);
  });

  it.each([["unset"], ["prices_exclude_tax"], ["not_vat_registered"], [null]])(
    "is an exact no-op at a house whose basis is %s",
    async (house) => {
      const { lineWrites } = await confirm(house, "includes_tax");

      expect(lineWrites).toHaveLength(1);
      expect(lineWrites[0].payload).toEqual({ final_unit_price: 36 });
    },
  );

  it("refuses the statement from anyone who does not hold the house's money, before the service runs", async () => {
    const service = { confirmDeal: jest.fn() } as unknown as ProcurementService;
    const controller = new ProcurementController(service);

    await expect(
      controller.confirmDeal(
        ORDER,
        { finalPrice: 36, priceTaxBasis: "excludes_tax" } as any,
        { userId: "u-staff", restaurantId: REST, role: "staff" },
        "seal",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((service as any).confirmDeal).not.toHaveBeenCalled();
  });

  it("passes a manager's statement through to the service", async () => {
    const service = {
      confirmDeal: jest
        .fn()
        .mockResolvedValue({ confirmed: true, sentConfirmation: false }),
    } as unknown as ProcurementService;
    const controller = new ProcurementController(service);

    await controller.confirmDeal(
      ORDER,
      { finalPrice: 36, priceTaxBasis: "excludes_tax" } as any,
      { userId: "u-mgr", restaurantId: REST, role: "manager" },
      "seal",
    );
    expect((service as any).confirmDeal).toHaveBeenCalledWith(
      REST,
      ORDER,
      "u-mgr",
      expect.objectContaining({
        finalPrice: 36,
        priceTaxBasis: "excludes_tax",
      }),
      "seal",
    );
  });
});
