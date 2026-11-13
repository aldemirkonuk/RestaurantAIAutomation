import { HttpException } from "@nestjs/common";
import { WholeReadError } from "../common/read-whole-window";
import {
  OPEN_ORDER_STATUSES,
  readOpenOrdersByVendor,
} from "./open-orders-by-vendor";
import { ProcurementController } from "./procurement.controller";

/**
 * /vendors counts open orders per vendor over the WHOLE book (r21, 2026-11-13).
 *
 * Before this the card counted the rows of `GET /procurement/orders`, the
 * newest 50. The double below answers like PostgREST: every response stops at
 * `cap` rows whatever was asked, and `count: "exact"` is the size of the
 * filtered set past the cursor.
 */

type Row = { id: string; restaurant_id: string; provider_id: string | null; status: string };

function fakeClient(rows: Row[], opts: { cap?: number; failOnPage?: number } = {}) {
  const cap = opts.cap ?? 1000;
  let page = 0;
  const calls: { select: string; eq: [string, string][]; in: [string, readonly string[]][] }[] = [];
  return {
    calls,
    from(table: string) {
      expect(table).toBe("procurement_orders");
      const q = { select: "", eq: [] as [string, string][], in: [] as [string, readonly string[]][], gt: null as string | null, limit: Infinity };
      calls.push(q);
      const b: any = {
        select(cols: string, o: { count: string }) {
          q.select = cols;
          expect(o).toEqual({ count: "exact" });
          return b;
        },
        eq(c: string, v: string) {
          q.eq.push([c, v]);
          return b;
        },
        in(c: string, v: readonly string[]) {
          q.in.push([c, v]);
          return b;
        },
        order(c: string) {
          expect(c).toBe("id");
          return b;
        },
        gt(c: string, v: string) {
          q.gt = v;
          return b;
        },
        limit(n: number) {
          q.limit = n;
          return b;
        },
        then(resolve: (v: unknown) => unknown) {
          page += 1;
          if (opts.failOnPage === page)
            return Promise.resolve({ data: null, error: { message: "boom", code: "57014" }, count: null }).then(resolve);
          const hit = rows
            .filter((r) => q.eq.every(([c, v]) => String((r as any)[c]) === v))
            .filter((r) => q.in.every(([c, vs]) => vs.includes((r as any)[c])))
            .filter((r) => q.gt === null || r.id > q.gt)
            .sort((a, z) => (a.id < z.id ? -1 : 1));
          return Promise.resolve({
            data: hit.slice(0, Math.min(q.limit, cap)),
            error: null,
            count: hit.length,
          }).then(resolve);
        },
      };
      return b;
    },
  };
}

const id = (n: number) => `o-${String(n).padStart(6, "0")}`;

/** 1,250 open orders in house r1: 1,247 to vendor busy, the 3 OLDEST to vendor quiet. */
function busyBook(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 3; i++) rows.push({ id: id(i), restaurant_id: "r1", provider_id: "quiet", status: "APPROVED" });
  for (let i = 3; i < 1250; i++) rows.push({ id: id(i), restaurant_id: "r1", provider_id: "busy", status: "PENDING" });
  return rows;
}

describe("readOpenOrdersByVendor", () => {
  it("counts past the newest fifty and past PostgREST's 1,000-row cap", async () => {
    const out = await readOpenOrdersByVendor(fakeClient(busyBook()), "r1");
    // The old card read the newest 50 (all `busy`): quiet showed 0.
    expect(out.byVendor.quiet).toBe(3);
    expect(out.byVendor.busy).toBe(1247);
    expect(out.total).toBe(1250);
  });

  it("counts only open states; delivered and closed orders are not open", async () => {
    const statuses = [
      "PENDING", "APPROVAL_NEEDED", "NEGOTIATING", "APPROVED", "CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED",
      "DELIVERED", "COMPLETED", "CANCELLED", "REJECTED", "FAILED",
    ];
    const rows = statuses.map((status, i) => ({ id: id(i), restaurant_id: "r1", provider_id: "v", status }));
    const out = await readOpenOrdersByVendor(fakeClient(rows), "r1");
    expect(out.byVendor.v).toBe(7);
    expect([...OPEN_ORDER_STATUSES].sort()).toEqual(statuses.slice(0, 7).sort());
  });

  it("reads only the asking house", async () => {
    const rows: Row[] = [
      { id: id(1), restaurant_id: "r1", provider_id: "v", status: "APPROVED" },
      { id: id(2), restaurant_id: "r2", provider_id: "v", status: "APPROVED" },
      { id: id(3), restaurant_id: "r2", provider_id: "w", status: "PENDING" },
    ];
    const client = fakeClient(rows);
    const out = await readOpenOrdersByVendor(client, "r1");
    expect(out).toEqual({ byVendor: { v: 1 }, total: 1 });
    expect(client.calls[0].eq).toEqual([["restaurant_id", "r1"]]);
    expect(client.calls[0].select).toBe("id, provider_id");
  });

  it("an order with no vendor counts in the house total, on no card", async () => {
    const rows: Row[] = [
      { id: id(1), restaurant_id: "r1", provider_id: null, status: "PENDING" },
      { id: id(2), restaurant_id: "r1", provider_id: "v", status: "PENDING" },
    ];
    expect(await readOpenOrdersByVendor(fakeClient(rows), "r1")).toEqual({ byVendor: { v: 1 }, total: 2 });
  });

  it("refuses when a page fails, never answering from the pages in hand", async () => {
    await expect(readOpenOrdersByVendor(fakeClient(busyBook(), { failOnPage: 2 }), "r1")).rejects.toBeInstanceOf(
      WholeReadError,
    );
  });
});

describe("GET /procurement/orders/open/by-vendor", () => {
  const user = { userId: "u", restaurantId: "r1" };

  it("answers the service's count for the caller's house", async () => {
    const svc = { countOpenOrdersByVendor: jest.fn(async () => ({ byVendor: { v: 2 }, total: 2 })) };
    const out = await ProcurementController.prototype.countOpenOrdersByVendor.call(
      { procurementService: svc } as never,
      user,
    );
    expect(out).toEqual({ byVendor: { v: 2 }, total: 2 });
    expect(svc.countOpenOrdersByVendor).toHaveBeenCalledWith("r1");
  });

  it("a book that cannot be read whole stays a 503, never a zero", async () => {
    const svc = {
      countOpenOrdersByVendor: jest.fn(async () => {
        throw new WholeReadError("The house's open orders", "read_failed", 1000, 1250, "page 2: boom");
      }),
    };
    const call = ProcurementController.prototype.countOpenOrdersByVendor.call({ procurementService: svc } as never, user);
    await expect(call).rejects.toBeInstanceOf(HttpException);
    await expect(call).rejects.toMatchObject({ status: 503 });
  });
});
