/**
 * The dark contract.
 *
 * These tests are not about the arithmetic — `commodity-alert.spec.ts` is. They
 * are about the ONE property the founder's *"the alert behind a flag"* rests
 * on: **nothing in this service can reach a person**, and every legitimate
 * no-op says why.
 */

import { DatabaseService } from "../database/database.service";
import {
  COMMODITY_ALERT_DARK_FLAG,
  CommodityAlertService,
  commodityAlertDark,
} from "./commodity-alert.service";
import { CommodityModule } from "./commodity.module";
import { UNEVALUATED_CONDITIONS } from "./commodity-alert";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFao } from "./parse-fao";

interface Insert {
  table: string;
  row: Record<string, unknown>;
}

function makeDb(
  handler: (ctx: { table: string; eqs: Array<[string, unknown]> }) => {
    data?: unknown[];
    count?: number;
    error?: unknown;
  },
  inserts: Insert[] = [],
): DatabaseService {
  const client = {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return builder;
        },
        is: () => builder,
        order: () => builder,
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          const r = handler({ table, eqs });
          return Promise.resolve({
            data: r.data ?? null,
            count: r.count ?? null,
            error: r.error ?? null,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client } as unknown as DatabaseService;
}

const FAO_VALUES = parseFao(
  readFileSync(
    join(__dirname, "__fixtures__", "fao-food-price-index-2026-09-05.sample.csv"),
    "utf8",
  ),
  { seriesKey: "fao.food_price_index.all", fetchedAt: "2026-09-05T12:00:00.000Z" },
)
  .observations.sort((a, b) => a.periodStart.localeCompare(b.periodStart));

describe("the module cannot reach a person, structurally", () => {
  it("imports no NotificationsModule, so there is no service to notify with", () => {
    // The guarantee lives in the injector rather than in a conditional. Making
    // the alert real means adding an import here, in front of a reviewer.
    const imports: unknown[] = Reflect.getMetadata("imports", CommodityModule) ?? [];
    const names = imports.map((m) => (m as { name?: string })?.name ?? String(m));
    expect(names).not.toContain("NotificationsModule");
    expect(names).toEqual(
      expect.arrayContaining(["DatabaseModule", "ConfigModule", "AuthModule"]),
    );
  });

  it("imports nothing from the notifications tree and writes to no notifications table", () => {
    // Checked on the IMPORT lines rather than on any mention of the word, so
    // the file stays free to explain in prose exactly what it is not allowed to
    // do -- which is the part a later reader most needs.
    const src = readFileSync(join(__dirname, "commodity-alert.service.ts"), "utf8");
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n");
    expect(imports).not.toMatch(/notifications/i);
    expect(src).not.toMatch(/\.from\("notifications"\)/);
    expect(src).not.toMatch(/persistForRestaurant\(/);
  });
});

describe("the flag", () => {
  it("is an allow-list and is off in this process", () => {
    expect(commodityAlertDark(process.env[COMMODITY_ALERT_DARK_FLAG])).toBe(false);
    expect(commodityAlertDark("true")).toBe(true);
    expect(commodityAlertDark("yes")).toBe(false);
  });

  it("evaluates nothing while it is off, and says so rather than reporting zero", async () => {
    const svc = new CommodityAlertService(makeDb(() => ({ data: [] })));
    const t = await svc.runDark("rest-1");
    expect(t.armed).toBe(false);
    expect(t.evaluated).toBe(0);
    expect(t.withheldReason).toMatch(/not armed/);
    expect(svc.reportLine(t)).toMatch(/nothing is claimed either way/);
  });
});

describe("armed, and every legitimate no-op carries its reason", () => {
  const withFlag = async (fn: () => Promise<void>) => {
    process.env[COMMODITY_ALERT_DARK_FLAG] = "true";
    try {
      await fn();
    } finally {
      delete process.env[COMMODITY_ALERT_DARK_FLAG];
    }
  };

  it("tells 'no series is armed' apart from 'the register could not be read'", async () => {
    await withFlag(async () => {
      const empty = new CommodityAlertService(makeDb(() => ({ data: [] })));
      const a = await empty.runDark("rest-1");
      expect(a.withheldReason).toMatch(/No series in the register is armed/);

      const broken = new CommodityAlertService(
        makeDb(() => ({ error: { message: "relation does not exist" } })),
      );
      const b = await broken.runDark("rest-1");
      expect(b.withheldReason).toMatch(/unknown, not "no series is armed"/);
      expect(b.failed).toBe(1);
    });
  });

  it("records a verdict in the FOOTPRINT ledger and never anywhere else", async () => {
    await withFlag(async () => {
      const inserts: Insert[] = [];
      const svc = new CommodityAlertService(
        makeDb((ctx) => {
          if (ctx.table === "commodity_index_series") {
            return {
              data: [
                {
                  id: "s1",
                  series_key: "fao.food_price_index.all",
                  redistribution: "unstated",
                  // Low enough that the fixture's real August rise clears it.
                  rise_threshold: 0.02,
                  step_guard: 0.5,
                  armed: true,
                  max_age_days: 70,
                },
              ],
            };
          }
          if (ctx.table === "commodity_index_observations") {
            return {
              data: FAO_VALUES.map((o) => ({
                period_start: o.periodStart,
                value: o.value,
              })),
            };
          }
          return { count: 1 }; // one live exposure
        }, inserts),
      );
      const t = await svc.runDark("rest-1");
      expect(t.evaluated).toBe(1);
      expect(t.recorded).toBe(1);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].table).toBe("neural_footprint_event");

      const row = inserts[0].row;
      expect(row.subject_type).toBe("agent");
      expect(row.subject_id).toBe("commodity_exposure_rising");
      // NULL means UNKNOWN in that table. Whether a fire was RIGHT needs a
      // numerator of confirmed invoice rises, and there are none.
      expect(row.outcome).toBeNull();
      const context = row.context as Record<string, unknown>;
      expect(context.dark).toBe(true);
      expect(context.reached_a_person).toBe(false);
      const state = row.internal_state as Record<string, unknown>;
      expect(state.unevaluated).toEqual(UNEVALUATED_CONDITIONS);
      expect(state.move).not.toBeNull();
    });
  });

  it("records a REFUSAL too, so a run that said nothing is distinguishable from one that never ran", async () => {
    await withFlag(async () => {
      const inserts: Insert[] = [];
      const svc = new CommodityAlertService(
        makeDb((ctx) => {
          if (ctx.table === "commodity_index_series") {
            return {
              data: [
                {
                  id: "s1",
                  series_key: "fao.food_price_index.all",
                  redistribution: "unstated",
                  rise_threshold: 0.02,
                  step_guard: 0.5,
                  armed: true,
                  max_age_days: 70,
                },
              ],
            };
          }
          if (ctx.table === "commodity_index_observations") {
            return {
              data: FAO_VALUES.map((o) => ({
                period_start: o.periodStart,
                value: o.value,
              })),
            };
          }
          return { count: 0 }; // NO exposure mapped
        }, inserts),
      );
      const t = await svc.runDark("rest-1");
      expect(t.wouldHaveNotified).toBe(0);
      expect(t.byVerdict.no_exposure_mapped).toBe(1);
      expect(inserts[0].row.choice).toBe("no_exposure_mapped");
    });
  });

  it("writes NO verdict when the exposure count could not be read", async () => {
    // Zero here would produce `no_exposure_mapped`, which reads as a fact about
    // the house. An unreadable count is not that fact.
    await withFlag(async () => {
      const inserts: Insert[] = [];
      const svc = new CommodityAlertService(
        makeDb((ctx) => {
          if (ctx.table === "commodity_index_series") {
            return {
              data: [
                {
                  id: "s1",
                  series_key: "fao.food_price_index.all",
                  redistribution: "unstated",
                  rise_threshold: 0.02,
                  step_guard: 0.5,
                  armed: true,
                  max_age_days: 70,
                },
              ],
            };
          }
          if (ctx.table === "commodity_index_observations") {
            return { data: [] };
          }
          return { error: { message: "permission denied" } };
        }, inserts),
      );
      const t = await svc.runDark("rest-1");
      expect(inserts).toHaveLength(0);
      expect(t.evaluated).toBe(0);
      expect(t.failed).toBe(1);
    });
  });

  it("the STATUS note never describes a run that did not happen", () => {
    // `reportLine` over a zeroed tally would read "0 series evaluated, 0 would
    // have interrupted this house" -- a sentence about a run nobody made, on
    // the one route somebody reads to find out whether this is on.
    const svc = new CommodityAlertService(makeDb(() => ({ data: [] })));
    const note = svc.standingNote();
    expect(note).not.toMatch(/series evaluated/);
    expect(note).toMatch(/not armed/);
    expect(note).toMatch(/reaches nobody/);
  });

  it("names the unevaluated conditions in the report line, every time", async () => {
    const svc = new CommodityAlertService(makeDb(() => ({ data: [] })));
    const line = svc.reportLine({
      armed: true,
      withheldReason: null,
      evaluated: 3,
      wouldHaveNotified: 1,
      byVerdict: { would_notify: 1, below_floor: 2 },
      recorded: 3,
      failed: 0,
    });
    expect(line).toMatch(/none sent to anybody/);
    expect(line).toMatch(/1 of the rule's nine conditions was NOT evaluated/);
    expect(line).toMatch(/days of inventory/);
    expect(line).toMatch(/not knowable yet and is not claimed/);
  });
});
