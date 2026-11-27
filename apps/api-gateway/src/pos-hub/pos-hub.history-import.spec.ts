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
    const upserts: { fn: string; restaurantId: string; rows: any[] }[] = [];
    const tables: string[] = [];
    // The day-locked import (DD-r110-19): saves every row of a day it does not refuse.
    const heldByChecks = new Set<string>();
    const rpc = jest.fn(async (fn: string, args: any) => {
      upserts.push({ fn, restaurantId: args.p_restaurant_id, rows: args.p_rows });
      const refused = [...new Set<string>(args.p_rows.map((r: any) => r.sale_date))].filter((d) => heldByChecks.has(d)).sort();
      return { data: { saved: args.p_rows.filter((r: any) => !heldByChecks.has(r.sale_date)).length, refused_days: refused }, error: null };
    });
    const client = {
      rpc,
      from: jest.fn((table: string) => {
        tables.push(table);
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: house, error: null }) }) }),
          upsert: async () => {
            throw new Error("history is written through import_pos_sales_history, never a bare upsert");
          },
        };
      }),
    };
    const organizations = { assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined) };
    const svc = new PosHistoryImportService({ getClient: () => client } as any, organizations as any);
    return { svc, client, rpc, upserts, tables, organizations, heldByChecks };
  }

  it("saves sales through the day-locked import and never touches checks or stock", async () => {
    const { svc, rpc, upserts, tables } = build();
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30\n2026-11-21,Meze,1,10", NOW);
    expect(out).toMatchObject({ daysRead: 2, salesSaved: 2, stockMoved: false, fileRefused: null, errors: [] });
    expect(out).toMatchObject({ daysHeldByChecks: [], daysHeldByChecksCount: 0, daysHeldByChecksSaid: null });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["import_pos_sales_history"]);
    expect(tables).toEqual(["restaurants"]);
    expect(upserts[0].restaurantId).toBe("h1");
    expect(upserts[0].rows[0]).toMatchObject({
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
    expect(upserts.every((u) => u.fn === "import_pos_sales_history")).toBe(true);
    expect(out.salesSaved).toBe(1201);
  });

  it("a day split across a failed chunk is not counted as read, and is named", async () => {
    const { client, svc } = build({ timezone: "UTC", currency: "TRY" });
    let call = 0;
    (client.rpc as jest.Mock).mockImplementation(async (_fn: string, args: any) =>
      ++call === 2 ? { data: null, error: { message: "boom" } } : { data: { saved: args.p_rows.length, refused_days: [] }, error: null },
    );
    // 600 items on 2026-11-20 (chunk 1 holds 500, chunk 2 holds 100 and fails) plus one on 2026-11-21.
    const rows = ["Date,Item,Qty", ...Array.from({ length: 600 }, (_, i) => `2026-11-20,I${i},1`), "2026-11-21,Z,1"];
    // Chunk 2 = I500..I599 + Z: 101 rows. Chunk 1 = 500 rows of the 20th only.
    const out = await svc.importHistory("u1", "h1", rows.join("\n"), NOW);
    expect(out.salesSaved).toBe(500);
    expect(out.daysRead).toBe(0);
    expect(out.errors.join(" ")).toContain("2026-11-20");
    expect(out.errors.join(" ")).toContain("2026-11-21");
  });

  it("passes the house's currency to the reader and reports money written in another one", async () => {
    const { svc, upserts } = build({ timezone: "UTC", currency: "EUR" });
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,$30.00", NOW);
    expect(out.netForeignCount).toBe(1);
    expect(out.netForeign[0]).toContain("$");
    expect(upserts[0].rows[0]).toMatchObject({ qty: 3, net: null, currency: null });
  });

  it("refuses a day the till already holds, saves the others, and says so (DD-r110-19)", async () => {
    const { svc, heldByChecks } = build();
    heldByChecks.add("2026-11-21");
    const out = await svc.importHistory(
      "u1",
      "h1",
      "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30\n2026-11-21,Meze,1,10\n2026-11-21,Raki,2,40",
      NOW,
    );
    expect(out.daysRead).toBe(1);
    expect(out.salesSaved).toBe(1);
    expect(out.daysHeldByChecks).toEqual(["2026-11-21"]);
    expect(out.daysHeldByChecksCount).toBe(1);
    expect(out.daysHeldByChecksSaid).toBe(
      "1 day already holds the till's own checks, so its history was not brought in and the checks stand: 2026-11-21.",
    );
    expect(out.errors).toEqual([]);
  });

  it("a day held by checks in one chunk is not counted read, even if another chunk of it saved", async () => {
    const { client, svc } = build({ timezone: "UTC", currency: "TRY" });
    let call = 0;
    // Chunk 1 saves 500 items of the 20th; a check lands; chunk 2 finds the 20th held.
    (client.rpc as jest.Mock).mockImplementation(async (_fn: string, args: any) =>
      ++call === 1
        ? { data: { saved: args.p_rows.length, refused_days: [] }, error: null }
        : { data: { saved: 1, refused_days: ["2026-11-20"] }, error: null },
    );
    const rows = ["Date,Item,Qty", ...Array.from({ length: 600 }, (_, i) => `2026-11-20,I${i},1`), "2026-11-21,Z,1"];
    const out = await svc.importHistory("u1", "h1", rows.join("\n"), NOW);
    expect(out.daysHeldByChecks).toEqual(["2026-11-20"]);
    expect(out.daysRead).toBe(1);
  });
});
