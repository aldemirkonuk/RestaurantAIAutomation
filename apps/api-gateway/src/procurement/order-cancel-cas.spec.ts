import { ProcurementService } from "./procurement.service";
import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * F-350 — a cancel is written only over the state it was decided from.
 *
 * cancelOrder reads the order's state, checks the move, redeems the seal and
 * only then writes CANCELLED. The write had no status filter, so an approval
 * landing in between was overwritten — and the shadow-stock release, decided
 * from the state read before the approval, was skipped. The write is now
 * compared-and-set on that state; a write that matches no row is re-read and
 * refused with a 409 naming where the order now stands.
 *
 * The seal, the role and the category are stubbed at their boundary: each
 * has its own spec (order-cancel-seal, cancel-reason). This file is about the
 * write.
 */
type Row = Record<string, any>;

const HOUSE = "house-1";
const ORDER = "11111111-1111-4111-8111-111111111111";
const USER = "user-1";

function harness(opts: { approvedMeanwhile: boolean }) {
  const stored: Row = {
    id: ORDER,
    status: "PENDING",
    inventory_id: "inv-1",
    quantity: 6,
  };
  const writes: Array<{ payload: Row; filters: Row }> = [];

  const supabase: any = {
    from(table: string) {
      let payload: Row | null = null;
      const filters: Row = {};
      const settle = () => {
        if (table !== "procurement_orders") return { data: null, error: null };
        if (!payload) return { data: { ...stored }, error: null };
        writes.push({ payload, filters: { ...filters } });
        if (filters.status !== undefined && filters.status !== stored.status)
          return { data: null, error: { code: "PGRST116", message: "0 rows" } };
        Object.assign(stored, payload);
        return { data: { ...stored }, error: null };
      };
      const q: any = {
        select: () => q,
        update: (p: Row) => {
          payload = Object.fromEntries(
            Object.entries(p).filter(([, v]) => v !== undefined),
          );
          return q;
        },
        eq: (col: string, value: any) => {
          filters[col] = value;
          return q;
        },
        in: () => q,
        single: async () => settle(),
        maybeSingle: async () => settle(),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: [], error: null }).then(res, rej),
      };
      return q;
    },
  };

  const svc = new ProcurementService(
    { supabase, getClient: () => supabase } as any,
    { createEvent: jest.fn() } as any,
    { recordTransaction: jest.fn() } as any,
  ) as any;
  for (const level of ["log", "warn", "error"])
    jest.spyOn(svc.logger, level).mockImplementation(() => {});
  jest.spyOn(svc, "assertMayCancelOrder").mockResolvedValue(undefined);
  jest.spyOn(svc, "readHouseZoneForCancel").mockResolvedValue(null);
  jest.spyOn(svc, "recordOrderCancelled").mockResolvedValue(undefined);
  jest.spyOn(svc, "emitOrderChangeEvent").mockResolvedValue(undefined);
  const release = jest
    .spyOn(svc, "releaseOrderShadowStock")
    .mockResolvedValue(undefined);
  // The seal is redeemed after the state was read and before the write: the
  // window an approval lands in.
  jest.spyOn(svc, "redeemOrderCancelSeal").mockImplementation(async () => {
    if (opts.approvedMeanwhile) stored.status = ProcurementOrderStatus.APPROVED;
  });

  return { svc: svc as ProcurementService, stored, writes, release };
}

describe("cancelOrder — compare-and-set on the state it read (F-350)", () => {
  it("refuses with a 409 naming the new state when an approval landed meanwhile, and the approval stands", async () => {
    const h = harness({ approvedMeanwhile: true });
    const err = await h.svc
      .cancelOrder(
        HOUSE,
        ORDER,
        USER,
        "changed our mind",
        "seal",
        "house_decision",
      )
      .catch((e) => e);
    expect(err.getStatus?.()).toBe(409);
    expect(err.getResponse().message).toMatch(
      /became approved while it was being cancelled, so it was not cancelled/,
    );
    expect(h.stored.status).toBe(ProcurementOrderStatus.APPROVED);
    expect(h.release).not.toHaveBeenCalled();
  });

  it("writes the cancel filtered on the state it read", async () => {
    const h = harness({ approvedMeanwhile: false });
    await h.svc.cancelOrder(
      HOUSE,
      ORDER,
      USER,
      "changed our mind",
      "seal",
      "house_decision",
    );
    expect(h.stored.status).toBe(ProcurementOrderStatus.CANCELLED);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].filters.status).toBe("PENDING");
  });
});
