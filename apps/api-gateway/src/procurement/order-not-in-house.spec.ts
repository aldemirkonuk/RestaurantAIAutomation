import { HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * `GET /procurement/orders/:id` says "not in this house" as a 404 (F-711).
 *
 * It used to answer every failed read — a missing row included — with a 500,
 * so the door screen could not tell "this order is another house's, removed,
 * or mistyped" from "the network dropped", let the porter photograph and count
 * the delivery, and refused only at the seal. And it now sends when the
 * three-way match was checked (F-710), so the inventory deep link can say
 * "already checked on <date>" instead of opening nothing.
 */

function db(result: { data: unknown; error: unknown }) {
  const from = () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      gte: () => q,
      lte: () => q,
      order: () => q,
      single: () => q,
      maybeSingle: () => q,
      then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return q;
  };
  return { supabase: { from } } as unknown as DatabaseService;
}

function service(d: DatabaseService) {
  return new ProcurementService(
    d,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
}

describe("GET /procurement/orders/:id — an order that is not in this house", () => {
  it.each([
    ["no row in this house (PGRST116)", "PGRST116"],
    ["an id that is not an id (22P02)", "22P02"],
  ])("[REVERT-FAILS] %s is a NotFoundException", async (_label, code) => {
    const s = service(db({ data: null, error: { code, message: "x" } }));
    await expect(s.getOrder("rest-1", "ord-x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("any other failed read is still a failure, not a not-found", async () => {
    const s = service(
      db({ data: null, error: { code: "08006", message: "connection lost" } }),
    );
    await expect(s.getOrder("rest-1", "ord-x")).rejects.not.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("[REVERT-FAILS] the controller keeps the 404 instead of turning it into a 500", async () => {
    const controller = new ProcurementController({
      getOrder: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException("This order is not in this house."),
        ),
    } as any);
    const call = controller.getOrder("ord-x", {
      userId: "u",
      restaurantId: "rest-1",
    });
    await expect(call).rejects.toBeInstanceOf(HttpException);
    await call.catch((e: HttpException) =>
      expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND),
    );
  });
});

describe("the order says when its delivery was checked", () => {
  const row = {
    id: "ord-1",
    order_number: "ORD-2026-00042",
    restaurant_id: "rest-1",
    inventory_id: null,
    provider_id: "prov-1",
    quantity: 5,
    status: "COMPLETED",
    completed_at: null,
    procurement_order_items: [],
  };

  it("[REVERT-FAILS] carries match_verified_at as matchVerifiedAt", async () => {
    const s = service(
      db({
        data: { ...row, match_verified_at: "2026-10-08T10:00:00.000Z" },
        error: null,
      }),
    );
    const order: any = await s.getOrder("rest-1", "ord-1");
    expect(order.matchVerifiedAt).toBe("2026-10-08T10:00:00.000Z");
  });

  it("null is 'not checked', never the key left off", async () => {
    const s = service(
      db({ data: { ...row, match_verified_at: null }, error: null }),
    );
    const order: any = await s.getOrder("rest-1", "ord-1");
    expect("matchVerifiedAt" in order).toBe(true);
    expect(order.matchVerifiedAt).toBeNull();
  });
});
