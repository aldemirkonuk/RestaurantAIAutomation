import { PriceIndexFetchService } from "./price-index-fetch.service";
import { DatabaseService } from "../database/database.service";

/**
 * The scheduled fetch, exercised through its OFFLINE path (parse the recorded
 * fixture, no network). Proves: it is OFF by default; when it does run it upserts
 * on the dedup key and records the source's own defects; and it never claims a
 * write it did not make.
 */
function makeDb(): { db: DatabaseService; upserts: unknown[][] } {
  const upserts: unknown[][] = [];
  const client = {
    from() {
      return {
        upsert(rows: unknown[]) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db: { client } as unknown as DatabaseService, upserts };
}

describe("PriceIndexFetchService", () => {
  afterEach(() => {
    delete process.env.PRICE_INDEX_FETCH_ENABLED;
  });

  it("is OFF by default — scheduledSweep writes nothing without the flag", async () => {
    const { db, upserts } = makeDb();
    const svc = new PriceIndexFetchService(db);
    await svc.scheduledSweep();
    expect(upserts).toHaveLength(0);
    expect(svc.allLastRuns()).toHaveLength(0);
  });

  it("parses the Iowa fixture and upserts survivors on the dedup key", async () => {
    const { db, upserts } = makeDb();
    const svc = new PriceIndexFetchService(db);
    const outcome = await svc.fetchOne("iowa-liquor-products", { offline: true, today: new Date("2026-09-04T00:00:00Z") });
    expect(outcome.rowsRead).toBe(24);
    expect(outcome.written).toBe(20);
    // The source's own defects, surfaced not hidden.
    expect(outcome.refusalsByReason.case_price_inconsistent).toBe(3);
    expect(outcome.refusalsByReason.duplicate_item_no).toBe(1);
    expect(outcome.silentBecause).toBeNull();
    expect(upserts[0]).toHaveLength(20);
    // Every written row carries a 64-hex content hash and its issuer's date.
    const first = (upserts[0] as Array<Record<string, unknown>>)[0];
    expect(String(first.content_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(first.issued_at).toBe("2026-09-01");
    expect(first.state).toBe("US-IA");
  });

  it("records the run for the status endpoint", async () => {
    const { db } = makeDb();
    const svc = new PriceIndexFetchService(db);
    await svc.fetchOne("oregon-olcc-monthly-pricing", { offline: true, today: new Date("2026-09-04T00:00:00Z") });
    const run = svc.lastRunFor("oregon-olcc-monthly-pricing");
    expect(run?.written).toBe(12);
    expect(run?.issuedAt).toBe("2026-09-01");
  });

  it("refuses to fetch a withheld source", async () => {
    const { db } = makeDb();
    const svc = new PriceIndexFetchService(db);
    await expect(
      svc.fetchOne("michigan-lcc-spirits-price-book", { offline: true, today: new Date("2026-09-04T00:00:00Z") }),
    ).rejects.toThrow();
  });
});
