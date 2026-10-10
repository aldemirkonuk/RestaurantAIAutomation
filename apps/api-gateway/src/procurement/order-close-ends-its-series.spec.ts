import { ProcurementService } from "./procurement.service";
import { ProcurementOrderStatus } from "./dto/procurement.dto";
import { RECURRENCE_ACTS } from "./order-recurrence";
import { ORDER_ENDS_ITS_SERIES_STATUSES } from "./order-transitions";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * F-302. A standing order whose own order is cancelled or rejected stops in
 * the same act. Before this, cancel and reject never touched `recurrence_*`,
 * so the generator kept raising PENDING orders for an agreement the house had
 * just ended — and each child skipped the dedup merge, so they piled up.
 */

type Row = Record<string, any>;

const USER = "11111111-1111-4111-8111-111111111111";

function makeDb(stored: Row) {
  const orderUpdates: Row[] = [];
  const auditInserts: Row[] = [];
  const from = (table: string) => {
    let payload: Row | null = null;
    const q: any = {
      select: () => q,
      eq: () => q,
      update(body: Row) {
        payload = body;
        if (table === "procurement_orders") orderUpdates.push(body);
        return q;
      },
      insert(body: Row) {
        if (table === "system_audit_log") auditInserts.push(body);
        return q;
      },
      single: async () => ({ data: { ...stored, ...(payload ?? {}) }, error: null }),
      maybeSingle: async () => ({ data: { id: stored.id }, error: null }),
      then: (resolve: any) => resolve({ data: null, error: null }),
    };
    return q;
  };
  const db = { supabase: { from } } as unknown as DatabaseService;
  return { db, orderUpdates, auditInserts };
}

function service(db: DatabaseService) {
  const svc = new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
  // A status write needs a manager or an owner (F-300); this file asks only
  // what the close does to the series, so the role gate lets the actor by.
  (svc as any).organizations = {
    resolveRestaurantRole: async () => "manager",
    assertCanManageRestaurant: async () => undefined,
  };
  return svc;
}

const PARENT: Row = {
  id: "ord-1",
  order_number: "ORD-2026-00042",
  restaurant_id: "rest-1",
  status: "APPROVED",
  recurrence_frequency: "weekly",
  recurrence_status: "active",
  inventory: { wine_name: "Barolo Riserva" },
};

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe("closing the order a series repeats ends the series (F-302)", () => {
  it("a rejected parent's series is ended in the same act, with who and a paper trail", async () => {
    const { db, orderUpdates, auditInserts } = makeDb(PARENT);
    await service(db).updateOrder(
      "rest-1",
      "ord-1",
      { status: ProcurementOrderStatus.REJECTED } as any,
      { statusTransitionAlreadyChecked: true, actorUserId: USER },
    );

    expect(orderUpdates).toHaveLength(2);
    expect(orderUpdates[1]).toMatchObject({
      recurrence_status: "ended",
      recurrence_status_by: USER,
    });
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      action: RECURRENCE_ACTS.ENDED,
      actor_id: USER,
      entity_id: "ord-1",
      changes: { from: "active", to: "ended" },
    });
  });

  it("a paused series is ended too", async () => {
    const { db, orderUpdates } = makeDb({ ...PARENT, recurrence_status: "paused" });
    await service(db).updateOrder(
      "rest-1",
      "ord-1",
      { status: ProcurementOrderStatus.REJECTED } as any,
      { statusTransitionAlreadyChecked: true, actorUserId: USER },
    );
    expect(orderUpdates[1]?.recurrence_status).toBe("ended");
  });

  it("a delivered parent keeps its rule — that is how most standing orders begin", async () => {
    // Delivered is not a closing status, so it never ends a series. It is also
    // no longer set by editing the status (booked in at the door instead), so
    // the edit is refused and nothing at all is written.
    expect(ORDER_ENDS_ITS_SERIES_STATUSES).not.toContain(ProcurementOrderStatus.DELIVERED);
    const { db, orderUpdates, auditInserts } = makeDb(PARENT);
    await expect(
      service(db).updateOrder(
        "rest-1",
        "ord-1",
        { status: ProcurementOrderStatus.DELIVERED } as any,
        { statusTransitionAlreadyChecked: true, actorUserId: USER },
      ),
    ).rejects.toMatchObject({ response: { reason: "status_through_its_own_act" } });
    expect(orderUpdates).toHaveLength(0);
    expect(auditInserts).toHaveLength(0);
  });

  it("an order with no rule writes nothing more", async () => {
    const { db, orderUpdates, auditInserts } = makeDb({
      ...PARENT,
      recurrence_frequency: null,
      recurrence_status: null,
    });
    await service(db).updateOrder(
      "rest-1",
      "ord-1",
      { status: ProcurementOrderStatus.REJECTED } as any,
      { statusTransitionAlreadyChecked: true, actorUserId: USER },
    );
    expect(orderUpdates).toHaveLength(1);
    expect(auditInserts).toHaveLength(0);
  });
});
