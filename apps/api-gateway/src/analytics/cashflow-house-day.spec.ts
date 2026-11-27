import { HttpException } from "@nestjs/common";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsController } from "./analytics.controller";
import { WholeReadError } from "../common/read-whole-window";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * /reports spend, read whole or refused, and a refusal that keeps its 503
 * (audit G6, G11; ADR 0292).
 *
 * The stub pages like PostgREST: an unranged read stops at 1,000 rows, a
 * ranged read honours `order`/`gt("id")`/`limit`, and `count` is the rows
 * past the cursor. A permissive stub that returned every row would let the
 * 1,000-row cut pass unnoticed, which is how it survived.
 */

const RID = "55555555-5555-5555-5555-555555555555";
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function pagingClient(tables: Record<string, any[]>, failOn?: string) {
  const calls: Array<{ table: string; method: string; args: any[] }> = [];
  const client = {
    calls,
    from(table: string) {
      const all = tables[table] ?? [];
      let cursor: string | null = null;
      let lim: number | null = null;
      let counted = false;
      const b: any = {};
      for (const m of ["eq", "in", "gte", "or", "order"])
        b[m] = (...args: any[]) => {
          calls.push({ table, method: m, args });
          return b;
        };
      b.select = (_cols: string, opts?: { count?: string }) => {
        counted = opts?.count === "exact";
        return b;
      };
      b.gt = (col: string, v: unknown) => {
        if (col === "id") cursor = String(v);
        return b;
      };
      b.limit = (n: number) => {
        lim = n;
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: all[0] ?? null, error: null });
      b.then = (resolve: any, reject: any) => {
        if (failOn === table)
          return Promise.resolve({
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          }).then(resolve, reject);
        const sorted = [...all].sort((x, y) => String(x.id).localeCompare(String(y.id)));
        const past = cursor === null ? sorted : sorted.filter((r) => String(r.id) > (cursor as string));
        const page = past.slice(0, lim ?? 1000);
        return Promise.resolve({
          data: page,
          error: null,
          count: counted ? past.length : null,
        }).then(resolve, reject);
      };
      return b;
    },
  };
  return client;
}

const svcOver = (client: any) =>
  new AdvancedAnalyticsService({ getClient: () => client } as any, {} as any, {} as any, {} as any);

const delivered = (i: number, at: string, cost: number | null = 10) => ({
  id: `po-${String(i).padStart(5, "0")}`,
  provider_id: "p1",
  providers: { name: "Vendor" },
  total_cost: cost,
  final_price: cost,
  bottles_total: 1,
  quantity: 1,
  created_at: at,
  delivered_at: at,
  expected_delivery_date: null,
  status: ProcurementOrderStatus.DELIVERED,
});

const UTC_HOUSE = [{ id: RID, timezone: "UTC", country: null }];

describe("cashflow reads every purchase order (audit G6)", () => {
  it("sums 1,001 delivered orders, not the first 1,000", async () => {
    const orders = Array.from({ length: 1001 }, (_, i) => delivered(i, day(3)));
    const out: any = await svcOver(
      pagingClient({ procurement_orders: orders, restaurants: UTC_HOUSE }),
    ).getCashflow(RID);
    expect(out.spendLast30d).toBe(10010);
  });

  it("selects by delivery too, so an order placed long ago and delivered lately is spend", async () => {
    const client = pagingClient({ procurement_orders: [], restaurants: UTC_HOUSE });
    await svcOver(client).getCashflow(RID);
    const or = client.calls.find((c) => c.table === "procurement_orders" && c.method === "or");
    expect(or?.args[0]).toMatch(/created_at\.gte\..*,delivered_at\.gte\./);
  });

  it("a failed read refuses the lens; it never reads as a quiet month", async () => {
    const svc = svcOver(
      pagingClient({ procurement_orders: [], restaurants: UTC_HOUSE }, "procurement_orders"),
    );
    await expect(svc.getCashflow(RID)).rejects.toBeInstanceOf(WholeReadError);
  });

  it("the financial summary's delivered orders refuse the same way", async () => {
    const svc = new AnalyticsService({
      getClient: () => pagingClient({ procurement_orders: [] }, "procurement_orders"),
    } as any);
    await expect((svc as any).loadDeliveredOrders(RID, 365)).rejects.toBeInstanceOf(
      WholeReadError,
    );
  });
});

describe("a lens refusal keeps its 503 and its sentence (audit G11)", () => {
  it("the financial route passes a WholeReadError through instead of re-wrapping it as 500", async () => {
    const refusal = new WholeReadError(
      "The delivered purchase orders in this window",
      "read_failed",
      0,
      null,
      "page 1: 57014 timeout",
    );
    const ctl = new (AnalyticsController as any)(
      { getFinancialSummary: async () => Promise.reject(refusal) },
      ...Array.from({ length: 10 }, () => ({})),
    );
    const err: HttpException = await ctl.getFinancial(RID, undefined, { role: "owner" }).catch(
      (e: HttpException) => e,
    );
    expect(err.getStatus()).toBe(503);
    expect(err.message).toContain("could not be read whole");
  });

  it("anything else is still a 500", async () => {
    const ctl = new (AnalyticsController as any)(
      { getFinancialSummary: async () => Promise.reject(new Error("boom")) },
      ...Array.from({ length: 10 }, () => ({})),
    );
    const err: HttpException = await ctl.getFinancial(RID, undefined, { role: "owner" }).catch(
      (e: HttpException) => e,
    );
    expect(err.getStatus()).toBe(500);
  });
});
