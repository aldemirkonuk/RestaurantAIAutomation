import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { WineSubmissionsService } from "./wine-submissions.service";

/**
 * r31 walk w1, F1: a menu of 120 or more new wines could not be imported.
 *
 * The read-back of the rows the import just created put every signature hash
 * in one GET URL (`.in("signature_hash", …)`), and the gateway in front of
 * PostgREST answered "URI too long" from about 120 hashes. The import failed
 * whole. This fake refuses any `.in()` longer than 60 values, the way the
 * gateway refused the long URL, and records every call.
 */

type Row = Record<string, any>;

function fakeClient(rows: Row[], inCalls: number[]) {
  return {
    rpc: async () => ({ data: [], error: null }),
    from: (_table: string) => ({
      select: () => ({
        in: async (col: string, vals: any[]) => {
          inCalls.push(vals.length);
          if (vals.length > 60) return { data: null, error: { message: "URI too long" } };
          return { data: rows.filter((r) => vals.includes(r[col])), error: null };
        },
      }),
      upsert: (payload: Row[]) => {
        payload.forEach((r, i) => rows.push({ ...r, id: `mw-${rows.length + i}` }));
        return { then: (resolve: (v: any) => void) => resolve({ error: null }) };
      },
    }),
  };
}

async function service(rows: Row[], inCalls: number[]) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      WineSubmissionsService,
      { provide: DatabaseService, useValue: { supabase: fakeClient(rows, inCalls) } },
    ],
  }).compile();
  return moduleRef.get(WineSubmissionsService);
}

const wines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Walk Wine ${i}`, producer: `Producer ${i}`, vintage: 2020 }));

describe("a long menu's new wines are read back in chunks (r31 w1 F1)", () => {
  it("120 new wines: more than one read, none over 50, every line linked", async () => {
    const rows: Row[] = [];
    const inCalls: number[] = [];
    const svc = await service(rows, inCalls);
    const out = await svc.resolveLibraryWinesBatch(wines(120), "rest-1");
    expect(inCalls.length).toBeGreaterThan(1);
    expect(Math.max(...inCalls)).toBeLessThanOrEqual(WineSubmissionsService.READ_BACK_CHUNK);
    expect(inCalls.reduce((a, b) => a + b, 0)).toBe(120);
    expect(out).toHaveLength(120);
    expect(out.every((r) => r?.masterWineId)).toBe(true);
    // Each line keeps its own wine, in the menu's order.
    expect(new Set(out.map((r) => r?.masterWineId)).size).toBe(120);
  });

  it("430 new wines, as walked: imported whole", async () => {
    const rows: Row[] = [];
    const inCalls: number[] = [];
    const svc = await service(rows, inCalls);
    const out = await svc.resolveLibraryWinesBatch(wines(430), "rest-1");
    expect(out.filter((r) => r?.masterWineId)).toHaveLength(430);
    expect(inCalls).toHaveLength(Math.ceil(430 / WineSubmissionsService.READ_BACK_CHUNK));
  });

  it("a failed read of any chunk still fails the import, by name", async () => {
    const rows: Row[] = [];
    const inCalls: number[] = [];
    const svc = await service(rows, inCalls);
    const client = (svc as unknown as { dbService: { supabase: any } }).dbService.supabase;
    const from = client.from;
    let n = 0;
    client.from = (t: string) => {
      const q = from(t);
      return {
        ...q,
        select: () => ({
          in: async (col: string, vals: any[]) =>
            ++n === 2 ? { data: null, error: { message: "boom" } } : q.select().in(col, vals),
        }),
      };
    };
    await expect(svc.resolveLibraryWinesBatch(wines(120), "rest-1")).rejects.toThrow(
      "Failed to read back provisional library wines: boom",
    );
  });
});
