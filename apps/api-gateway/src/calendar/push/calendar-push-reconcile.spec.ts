/**
 * The reconcile sweep — ADR 0111 direction 1's answer to "one write per
 * mutation, and no sync token".
 *
 * The thing being specified here is not that it re-pushes. It is that it
 * REPORTS, and that every report it can produce distinguishes the three states
 * a naive count collapses into one:
 *
 *   nothing owed        — a real, checked, empty result
 *   nothing known       — the read failed and the counts are NULL, not zero
 *   nothing connected   — an empty POPULATION, which is not an empty result
 *
 * "0 of N pushed" is a sentence this job prints. "In sync" is not a sentence it
 * can produce.
 */

import {
  CalendarPushReconcileService,
  PAUSE_BETWEEN_WRITES_MS,
} from "./calendar-push-reconcile.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

interface Stub {
  armed: boolean;
  houses: string[] | null;
  owed: Record<string, string[] | null>;
  removals: Record<string, string[] | null>;
  backoff: Record<string, number>;
  status: Record<string, any>;
  pushed: Array<{ house: string; entry: string; verb: string }>;
  pushResult: (entry: string) => { outcome: string };
}

function stub(overrides: Partial<Stub> = {}) {
  const s: Stub = {
    armed: true,
    houses: [HOUSE],
    owed: { [HOUSE]: [] },
    removals: { [HOUSE]: [] },
    backoff: {},
    status: {
      [HOUSE]: {
        entries: 0,
        pushed: 0,
        unpushed: 0,
        sentence: "This house has no entries, so there is nothing to push.",
      },
    },
    pushed: [],
    pushResult: () => ({ outcome: "delivered" }),
    ...overrides,
  };

  const push = {
    get armed() {
      return s.armed;
    },
    housesWithAGrant: async () => s.houses,
    // `?? []` would coerce a NULL — the failed-read signal — into an empty
    // list, which is the exact fault these specs exist to catch, inside the
    // double meant to catch it.
    entriesOwedACopy: async (house: string) =>
      house in s.owed ? s.owed[house] : [],
    copiesAwaitingRemoval: async (house: string) =>
      house in s.removals ? s.removals[house] : [],
    persistedBackoffSeconds: async (house: string) => s.backoff[house] ?? 0,
    status: async (house: string) => s.status[house],
    push: async (house: string, entry: string, verb: string) => {
      s.pushed.push({ house, entry, verb });
      return { ...s.pushResult(entry), detail: "", providerEventId: null, restored: false };
    },
  };

  return { s, service: new CalendarPushReconcileService(push as any) };
}

// Real pauses would make this suite take seconds for nothing.
jest.useFakeTimers({ doNotFake: ["nextTick"] });
const run = async <T>(p: Promise<T>): Promise<T> => {
  const settled = p;
  await jest.runAllTimersAsync();
  return settled;
};

describe("the reconcile sweep's population", () => {
  it("serves only houses that have connected a Google account", async () => {
    const { service, s } = stub({
      houses: [HOUSE, OTHER],
      owed: { [HOUSE]: ["e1"], [OTHER]: ["e2"] },
      status: {
        [HOUSE]: { entries: 1, pushed: 1, unpushed: 0, sentence: "1 of 1 entry pushed." },
        [OTHER]: { entries: 1, pushed: 1, unpushed: 0, sentence: "1 of 1 entry pushed." },
      },
    });
    const summary = await run(service.sweep());
    expect(summary.houses).toBe(2);
    expect(s.pushed.map((p) => p.house).sort()).toEqual([HOUSE, OTHER]);
  });

  it("reports an unreadable grant register as an ERROR, never as an empty run", async () => {
    const { service } = stub({ houses: null });
    const summary = await run(service.sweep());
    expect(summary.error).toMatch(/could not be read/i);
    expect(summary.houses).toBe(0);
    expect(summary.attempted).toBe(0);
    // The distinction the whole file exists for: an error run and a clean run
    // are not the same object.
    expect(summary.error).not.toBeNull();
  });

  it("reports nobody-connected as an empty POPULATION, with no error", async () => {
    const { service } = stub({ houses: [] });
    const summary = await run(service.sweep());
    expect(summary.houses).toBe(0);
    expect(summary.error).toBeNull();
  });

  it("does nothing at all when the push is switched off, and says so", async () => {
    const { service, s } = stub({ armed: false, owed: { [HOUSE]: ["e1"] } });
    const summary = await run(service.sweep());
    expect(s.pushed).toHaveLength(0);
    expect(summary.houses).toBe(0);
    expect(service.status().armed).toBe(false);
  });
});

describe("what the sweep does per house", () => {
  it("re-pushes entries whose provider id is missing", async () => {
    const { service, s } = stub({
      owed: { [HOUSE]: ["e1", "e2", "e3"] },
      status: {
        [HOUSE]: { entries: 3, pushed: 3, unpushed: 0, sentence: "3 of 3 entries pushed." },
      },
    });
    const summary = await run(service.sweep());
    expect(s.pushed.map((p) => p.entry)).toEqual(["e1", "e2", "e3"]);
    expect(s.pushed.every((p) => p.verb === "create")).toBe(true);
    expect(summary.delivered).toBe(3);
    expect(summary.perHouse[0].mapped).toBe(3);
    expect(summary.perHouse[0].unmapped).toBe(0);
  });

  it("removes copies of deleted entries FIRST — those are actively wrong", async () => {
    const { service, s } = stub({
      owed: { [HOUSE]: ["new-1"] },
      removals: { [HOUSE]: ["gone-1"] },
      status: {
        [HOUSE]: { entries: 1, pushed: 1, unpushed: 0, sentence: "1 of 1 entry pushed." },
      },
    });
    await run(service.sweep());
    expect(s.pushed).toEqual([
      { house: HOUSE, entry: "gone-1", verb: "delete" },
      { house: HOUSE, entry: "new-1", verb: "create" },
    ]);
  });

  it("leaves a rate-limited house alone and says how long is left", async () => {
    const { service, s } = stub({
      backoff: { [HOUSE]: 42 },
      owed: { [HOUSE]: ["e1"] },
    });
    const summary = await run(service.sweep());
    expect(s.pushed).toHaveLength(0);
    expect(summary.perHouse[0].heldBackSeconds).toBe(42);
    expect(summary.perHouse[0].sentence).toMatch(/42 second\(s\)/);
    expect(summary.perHouse[0].sentence).toMatch(/nothing is lost/i);
  });

  it("stops on a rate limit mid-house without touching the next house", async () => {
    const { service, s } = stub({
      houses: [HOUSE, OTHER],
      owed: { [HOUSE]: ["e1", "e2", "e3"], [OTHER]: ["f1"] },
      status: {
        [HOUSE]: { entries: 3, pushed: 1, unpushed: 2, sentence: "1 of 3 entries pushed." },
        [OTHER]: { entries: 1, pushed: 1, unpushed: 0, sentence: "1 of 1 entry pushed." },
      },
      pushResult: (entry) =>
        entry === "e2" ? { outcome: "rate_limited" } : { outcome: "delivered" },
    });
    await run(service.sweep());
    // e3 is skipped; the OTHER house is still served.
    expect(s.pushed.map((p) => p.entry)).toEqual(["e1", "e2", "f1"]);
  });

  it("says the counts are NOT KNOWN when the register could not be read", async () => {
    const { service, s } = stub({ owed: { [HOUSE]: null } });
    const summary = await run(service.sweep());
    expect(s.pushed).toHaveLength(0);
    const report = summary.perHouse[0];
    expect(report.entries).toBeNull();
    expect(report.mapped).toBeNull();
    expect(report.unmapped).toBeNull();
    expect(report.sentence).toMatch(/NOT known/);
    expect(report.sentence).toMatch(/failed read, not a clean house/i);
  });

  it("prints '0 of N pushed' for a connected house with nothing delivered", async () => {
    const { service } = stub({
      owed: { [HOUSE]: ["e1"] },
      pushResult: () => ({ outcome: "refused" }),
      status: {
        [HOUSE]: {
          entries: 40,
          pushed: 0,
          unpushed: 40,
          sentence:
            '0 of 40 entries pushed into "Mudavym — Sim Meyhouse". Nothing has reached Google — read the last outcome below for why, and do not read this as being in sync.',
        },
      },
    });
    const summary = await run(service.sweep());
    expect(summary.perHouse[0].sentence).toContain("0 of 40 entries pushed");
    expect(summary.failed).toBe(1);
  });
});

describe("the sweep's own shape", () => {
  it("pauses between writes rather than bursting", () => {
    expect(PAUSE_BETWEEN_WRITES_MS).toBeGreaterThan(0);
  });

  it("reports its cron and its last run", async () => {
    const { service } = stub();
    expect(service.status().lastRun).toBeNull();
    await run(service.sweep());
    expect(service.status().cron).toBe("12 * * * *");
    expect(service.status().lastRun?.finishedAt).toBeTruthy();
  });
});
