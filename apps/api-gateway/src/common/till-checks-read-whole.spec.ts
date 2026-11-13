import { DevTruthService } from "../analytics/dev-truth.service";
import { PosHubService } from "../pos-hub/pos-hub.service";
import { SaleRecordProducer } from "../notifications/producers/sale-record.producer";
import { emptyTally } from "../notifications/producers/producer-ledger.service";
import { cappedPostgrest } from "./testing/capped-postgrest";

/**
 * Readers lane r4: the till's checks are read past PostgREST's 1,000 rows,
 * or the reader refuses. Each reader here was an unranged select, so a house
 * past a thousand checks in the window was counted on its first thousand and
 * nothing said so. `cappedPostgrest` answers as PostgREST does: never more than
 * 1,000 rows a response.
 */

const HOUSE = "house-1";
const pad = (i: number) => String(i).padStart(5, "0");

function check(i: number, openedAt: string, over: Record<string, any> = {}) {
  return {
    id: `chk-${pad(i)}`,
    restaurant_id: HOUSE,
    source: "square",
    voided: false,
    opened_at: openedAt,
    closed_at: openedAt,
    covers: 2,
    total: 10,
    items: null,
    ...over,
  };
}

describe("dev truth's as-of cut reads each side whole", () => {
  const rows = [
    ...Array.from({ length: 1500 }, (_, i) => check(i, "2026-08-15T19:00:00Z")),
    ...Array.from({ length: 1200 }, (_, i) => check(5000 + i, "2026-09-15T19:00:00Z")),
  ];
  const svc = (failOn?: (t: string, n: number) => boolean) =>
    new DevTruthService({ getClient: () => cappedPostgrest({ pos_checks: rows }, failOn) } as any);

  it("counts 1,500 before the cut and 1,200 after, not 1,000 a side", async () => {
    const out: any = await svc().asOf(HOUSE, "2026-09-01T00:00:00Z");
    expect(out.error).toBeNull();
    expect(out.known.checks).toBe(1500);
    expect(out.known.revenue).toBe(15000);
    expect(out.happened.checks).toBe(1200);
  });

  it("states no figure when a later page fails", async () => {
    const out: any = await svc((t, n) => t === "pos_checks" && n === 3).asOf(HOUSE, "2026-09-01T00:00:00Z");
    expect(out.error).toMatch(/could not be read whole/);
    expect(out.known).toBeNull();
    expect(out.happened).toBeNull();
  });
});

describe("Settings → POS: the month's checks are counted whole", () => {
  const recent = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
  // 1,400 Square checks, then 300 Toast checks whose ids sort past the
  // thousandth row: an unranged read never saw Toast at all.
  const rows = [
    ...Array.from({ length: 1400 }, (_, i) => check(i, recent(1 + (i % 500)))),
    ...Array.from({ length: 300 }, (_, i) => check(2000 + i, recent(2 + i), { source: "toast" })),
  ];
  const status = (failOn?: (t: string, n: number) => boolean) =>
    (PosHubService.prototype.getStatus as any).call(
      {
        dbService: { getClient: () => cappedPostgrest({ pos_checks: rows }, failOn) },
        logger: { error: () => {} },
      },
      HOUSE,
    );

  it("counts 1,700 checks and names both sources", async () => {
    const out = await status();
    expect(out.unavailable).toBe(false);
    expect(out.totalChecks).toBe(1700);
    const by = Object.fromEntries(out.sources.map((s: any) => [s.source, s.checks]));
    expect(by).toEqual({ square: 1400, toast: 300 });
  });

  it("reads as unavailable, never as a count, when a later page fails", async () => {
    const out = await status((t, n) => t === "pos_checks" && n === 2);
    expect(out.unavailable).toBe(true);
    expect(out.totalChecks).toBeNull();
  });
});

describe("the sale-record producer sums the whole day", () => {
  const ZONE = "America/New_York";
  const DAY = "2026-09-02";
  // 20:30 on 2 September in New York.
  const at = "2026-09-03T00:30:00Z";
  const totals = (rows: any[]) =>
    (
      new SaleRecordProducer(
        { getClient: () => cappedPostgrest({ pos_checks: rows }) } as any,
        {} as any,
      ) as any
    ).dayTotals(HOUSE, ZONE, DAY, emptyTally());

  it("a day of 1,500 checks is 1,500 checks, not its first thousand", async () => {
    const out = await totals(Array.from({ length: 1500 }, (_, i) => check(i, at)));
    expect(out.checks).toBe(1500);
    expect(out.revenue).toBe(15000);
  });

  it("a day past the cap refuses rather than writing part of it", async () => {
    const many = Array.from({ length: SaleRecordProducer.CHECK_CAP + 1 }, (_, i) => check(i, at));
    await expect(totals(many)).rejects.toThrow(/could not read pos_checks/);
  });
});
