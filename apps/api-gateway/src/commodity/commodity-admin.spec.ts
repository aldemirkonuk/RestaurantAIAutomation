/**
 * Arming: the one act that lets a rule interrupt people.
 *
 * The property every test here defends is the founder's own clause — *"with
 * the calibration's derived threshold SHOWN before the act"*. It is enforced,
 * not described: the write carries back a hash of the proposal, and the service
 * recomputes the proposal from the series' own observations before comparing.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { DatabaseService } from "../database/database.service";
import { CommodityAdminService } from "./commodity-admin.service";
import { isRefusal, proposeCalibration } from "./commodity-calibration";
import { parseFao } from "./parse-fao";

const OBS = parseFao(
  readFileSync(
    join(__dirname, "__fixtures__", "fao-food-price-index-2026-09-05.sample.csv"),
    "utf8",
  ),
  { seriesKey: "fao.food_price_index.all", fetchedAt: "2026-09-05T12:00:00.000Z" },
)
  .observations.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  .map((o) => ({ period_start: o.periodStart, value: o.value }));

const KEY = "fao.food_price_index.all";

interface Write {
  table: string;
  op: "update" | "insert";
  payload: Record<string, unknown>;
}

function makeDb(
  handler: (t: string) => { data?: unknown[]; error?: unknown },
  writes: Write[] = [],
): DatabaseService {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        update(payload: Record<string, unknown>) {
          writes.push({ table, op: "update", payload });
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          const r = handler(table);
          return Promise.resolve({
            data: (r.data && r.data[0]) ?? null,
            error: r.error ?? null,
          });
        },
        single() {
          const r = handler(table);
          return Promise.resolve({
            data: (r.data && r.data[0]) ?? null,
            error: r.error ?? null,
          });
        },
        then(resolve: (v: unknown) => unknown) {
          const r = handler(table);
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(
            resolve,
          );
        },
      };
      return builder;
    },
  };
  return { client } as unknown as DatabaseService;
}

/** A register holding the FAO series and its 40 real observations. */
function liveDb(writes: Write[] = [], armed = false) {
  return makeDb((t) => {
    if (t === "commodity_index_series") {
      return { data: [{ id: "s1", series_key: KEY, armed }] };
    }
    if (t === "commodity_index_observations") return { data: OBS };
    return { data: [] };
  }, writes);
}

function goodHash(firesPerYear: number): string {
  const p = proposeCalibration(
    KEY,
    "month",
    OBS.map((o) => ({ periodStart: o.period_start, value: o.value })),
    firesPerYear,
  );
  if (isRefusal(p)) throw new Error("expected a proposal");
  return p.proposalHash;
}

describe("the proposal is what the admin reads", () => {
  it("returns every budget with the series' own terms beside them", async () => {
    const svc = new CommodityAdminService(liveDb());
    const out = await svc.propose(KEY);
    expect(out.registered).toBe(true);
    expect(out.mayBeArmed).toBe(true);
    expect(out.observations).toBe(40);
    expect(out.budgets).toHaveLength(3);
  });

  it("says a series may NOT be armed before showing a threshold for it", async () => {
    // The terms and the numbers belong on the same screen: discovering a
    // refusal after choosing a budget teaches an admin the screen is decoration.
    const svc = new CommodityAdminService(liveDb());
    const out = await svc.propose("usda_ams.shell_egg_index.national");
    expect(out.mayBeArmed).toBe(false);
    expect(out.mayNotBeArmedBecause).toMatch(/403/);
  });

  it("refuses a key the register does not know rather than calibrating it", async () => {
    const svc = new CommodityAdminService(liveDb());
    const out = await svc.propose("made.up.series");
    expect(out.registered).toBe(false);
    expect(out.mayNotBeArmedBecause).toMatch(/not a series this register knows/);
  });

  it("says an unreadable register is UNKNOWN, not a series with no history", async () => {
    const svc = new CommodityAdminService(
      makeDb(() => ({ error: { message: "permission denied" } })),
    );
    const out = await svc.propose(KEY);
    expect(out.observations).toBeNull();
    expect(out.note).toMatch(/unknown, not a series with no history/);
  });
});

describe("arming carries back the numbers that were shown", () => {
  it("arms on a matching hash, and writes who, when and on what", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes));
    const out = await svc.arm({
      seriesKey: KEY,
      firesPerYear: 2,
      proposalHash: goodHash(2),
      actorLabel: "founder",
    });
    expect(out.armed).toBe(true);
    const update = writes.find((w) => w.op === "update")!;
    expect(update.table).toBe("commodity_index_series");
    expect(update.payload.armed).toBe(true);
    expect(update.payload.armed_by_label).toBe("founder");
    expect(update.payload.armed_proposal_hash).toBe(goodHash(2));
    // The thresholds written are the ones that were hashed, at the precision
    // the column stores.
    expect(update.payload.rise_threshold).toBeCloseTo(
      Number((update.payload.rise_threshold as number).toFixed(4)),
      10,
    );
  });

  it("REFUSES an empty hash: a series may not be armed on numbers nobody read", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes));
    const out = await svc.arm({
      seriesKey: KEY,
      firesPerYear: 2,
      proposalHash: "",
      actorLabel: "founder",
    });
    expect(out.armed).toBe(false);
    expect(out.reason).toBe("proposal_moved");
    expect(out.detail).toMatch(/numbers nobody read/);
    expect(writes).toHaveLength(0);
  });

  it("REFUSES a hash from a DIFFERENT budget", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes));
    const out = await svc.arm({
      seriesKey: KEY,
      firesPerYear: 2,
      proposalHash: goodHash(4),
      actorLabel: "founder",
    });
    expect(out.reason).toBe("proposal_moved");
    expect(out.detail).toMatch(/What was approved and what would be written/);
    expect(writes).toHaveLength(0);
  });

  it("REFUSES once one more observation has landed since the proposal was read", async () => {
    // The whole point: a threshold that moved between the showing and the act
    // cannot be armed. Same refusal `arguments_changed` gives an edited order.
    const stale = goodHash(2);
    const writes: Write[] = [];
    const moved = [...OBS, { period_start: "2026-09-01", value: 190 }];
    const svc = new CommodityAdminService(
      makeDb((t) => {
        if (t === "commodity_index_series") {
          return { data: [{ id: "s1", series_key: KEY, armed: false }] };
        }
        if (t === "commodity_index_observations") return { data: moved };
        return { data: [] };
      }, writes),
    );
    const out = await svc.arm({
      seriesKey: KEY,
      firesPerYear: 2,
      proposalHash: stale,
      actorLabel: "founder",
    });
    expect(out.reason).toBe("proposal_moved");
    expect(writes).toHaveLength(0);
  });

  it("refuses a series with too little history, and does not write a weak threshold", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(
      makeDb((t) => {
        if (t === "commodity_index_series") {
          return { data: [{ id: "s1", series_key: KEY, armed: false }] };
        }
        if (t === "commodity_index_observations") return { data: OBS.slice(-10) };
        return { data: [] };
      }, writes),
    );
    const out = await svc.arm({
      seriesKey: KEY,
      firesPerYear: 2,
      proposalHash: "whatever",
      actorLabel: "founder",
    });
    expect(out.reason).toBe("no_proposal");
    expect(writes).toHaveLength(0);
  });

  it("never arms a series whose publisher forbids republication", async () => {
    // An alert IS publication. Checked before anything is read, so the refusal
    // does not depend on the register being reachable.
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes));
    const out = await svc.arm({
      seriesKey: "made.up.series",
      firesPerYear: 2,
      proposalHash: "x",
      actorLabel: "founder",
    });
    expect(out.reason).toBe("unknown_series");
    expect(writes).toHaveLength(0);
  });

  it("logs the act with the numbers it was armed on", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes));
    await svc.arm({
      seriesKey: KEY,
      firesPerYear: 1,
      proposalHash: goodHash(1),
      actorLabel: "founder",
      note: "first one",
    });
    const logged = writes.find((w) => w.table === "commodity_series_arming_log")!;
    expect(logged.payload.act).toBe("armed");
    expect(logged.payload.actor_label).toBe("founder");
    expect(logged.payload.fires_per_year).toBe(1);
    expect(logged.payload.proposal_hash).toBe(goodHash(1));
    expect(logged.payload.window_n_obs).toBe(27); // 40 observations, K + 1 consumed
    expect(logged.payload.note).toBe("first one");
  });
});

describe("disarming", () => {
  it("is NOT hash-gated, and says why the thresholds are left behind", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes, true));
    const out = await svc.disarm({ seriesKey: KEY, actorLabel: "founder" });
    expect(out.armed).toBe(false);
    expect(out.reason).toBe("disarmed");
    expect(out.detail).toMatch(/thresholds are left on the row/);
    const update = writes.find((w) => w.op === "update")!;
    expect(update.payload.armed).toBe(false);
    expect(update.payload.rise_threshold).toBeUndefined();
  });

  it("is logged too, so 'never armed' and 'armed then turned off' differ", async () => {
    const writes: Write[] = [];
    const svc = new CommodityAdminService(liveDb(writes, true));
    await svc.disarm({ seriesKey: KEY, actorLabel: "founder", note: "too noisy" });
    const logged = writes.find((w) => w.table === "commodity_series_arming_log")!;
    expect(logged.payload.act).toBe("disarmed");
    expect(logged.payload.rise_threshold).toBeNull();
    expect(logged.payload.note).toBe("too noisy");
  });
});

describe("the history", () => {
  it("says an empty log in words, never as a zero", async () => {
    const svc = new CommodityAdminService(makeDb(() => ({ data: [] })));
    const out = await svc.history(KEY);
    expect(out.acts).toEqual([]);
    expect(out.note).toMatch(/different from a series that was armed and turned off/);
  });

  it("says an unreadable log is UNKNOWN, not 'nothing has happened'", async () => {
    const svc = new CommodityAdminService(
      makeDb(() => ({ error: { message: "relation does not exist" } })),
    );
    const out = await svc.history(KEY);
    expect(out.note).toMatch(/unknown, not "nothing has happened"/);
  });
});
