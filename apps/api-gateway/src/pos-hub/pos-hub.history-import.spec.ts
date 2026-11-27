/**
 * r109 onboarding g3: the till's last 90 days of item sales, on day one,
 * without moving stock. The reader is pinned in history-import.spec.ts.
 */
import { ForbiddenException } from "@nestjs/common";
import {
  HISTORY_CHUNK,
  PosHistoryImportService,
  houseDay,
} from "./pos-history-import.service";

describe("houseDay", () => {
  it("is the house's own day, and null with no zone or an unknown one", () => {
    const at = new Date("2026-11-27T22:30:00Z");
    expect(houseDay("UTC", at)).toBe("2026-11-27");
    expect(houseDay("Europe/Istanbul", at)).toBe("2026-11-28");
    expect(houseDay("America/Los_Angeles", at)).toBe("2026-11-27");
    expect(houseDay(null, at)).toBeNull();
    expect(houseDay("Not/AZone", at)).toBeNull();
  });
});

describe("PosHistoryImportService", () => {
  const NOW = new Date("2026-11-27T12:00:00Z");
  function build(house: { timezone: string | null; currency: string | null } | null = { timezone: "Europe/Istanbul", currency: "TRY" }) {
    const upserts: { table: string; rows: any[]; opts: any }[] = [];
    const tables: string[] = [];
    const rpc = jest.fn();
    const client = {
      rpc,
      from: jest.fn((table: string) => {
        tables.push(table);
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: house, error: null }) }) }),
          upsert: async (rows: any[], opts: any) => {
            upserts.push({ table, rows, opts });
            return { error: null };
          },
        };
      }),
    };
    const organizations = { assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined) };
    const svc = new PosHistoryImportService({ getClient: () => client } as any, organizations as any);
    return { svc, client, rpc, upserts, tables, organizations };
  }

  it("saves sales to pos_sales_history and never touches checks or stock", async () => {
    const { svc, rpc, upserts, tables } = build();
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30\n2026-11-21,Meze,1,10", NOW);
    expect(out).toMatchObject({ daysRead: 2, salesSaved: 2, stockMoved: false, fileRefused: null, errors: [] });
    expect(rpc).not.toHaveBeenCalled();
    expect(new Set(tables)).toEqual(new Set(["restaurants", "pos_sales_history"]));
    expect(upserts[0].opts).toEqual({ onConflict: "restaurant_id,sale_date,item_key" });
    expect(upserts[0].rows[0]).toMatchObject({
      restaurant_id: "h1",
      sale_date: "2026-11-20",
      item_name: "Meze",
      qty: 3,
      net: 30,
      currency: "TRY",
      imported_by: "u1",
    });
  });

  it("a re-upload writes the same keys (an upsert, not a second row)", async () => {
    const { svc, upserts } = build();
    await svc.importHistory("u1", "h1", "Date,Item,Qty\n2026-11-20,Meze,3", NOW);
    await svc.importHistory("u1", "h1", "Date,Item,Qty\n2026-11-20,Meze,4", NOW);
    expect(upserts[0].rows[0].item_key).toBe(upserts[1].rows[0].item_key);
  });

  it("a staff member is refused before anything is read or written", async () => {
    const { svc, organizations, tables } = build();
    organizations.assertCanManageRestaurant.mockRejectedValue(new ForbiddenException("owner or manager"));
    await expect(svc.importHistory("staff", "h1", "Date,Item,Qty\n2026-11-20,Meze,3", NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith("staff", "h1", expect.any(String));
    expect(tables).toEqual([]);
  });

  it("with the house's money unset, keeps quantities and writes no money", async () => {
    const { svc, upserts } = build({ timezone: "UTC", currency: null });
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30", NOW);
    expect(out.netDropped).toBe(true);
    expect(upserts[0].rows[0]).toMatchObject({ qty: 3, net: null, currency: null });
  });

  it("with no house clock, reads nothing and says why", async () => {
    const { svc, upserts } = build({ timezone: null, currency: "TRY" });
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty\n2026-11-20,Meze,3", NOW);
    expect(out.fileRefused).toContain("clock is not set");
    expect(upserts).toHaveLength(0);
  });

  it("upserts in chunks of 500", async () => {
    const { svc, upserts } = build();
    const rows = ["Date,Item,Qty", ...Array.from({ length: 1201 }, (_, i) => `2026-11-20,I${i},1`)];
    const out = await svc.importHistory("u1", "h1", rows.join("\n"), NOW);
    expect(upserts.map((u) => u.rows.length)).toEqual([HISTORY_CHUNK, HISTORY_CHUNK, 201]);
    expect(out.salesSaved).toBe(1201);
  });
});
