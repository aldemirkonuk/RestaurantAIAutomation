import {
  InsightGeneratorService,
  InsightRecord,
  keyOnFiring,
} from "./insight-generator.service";
import { stateBookFrom } from "./item-state";

/**
 * F-796: a subject-less insight card is keyed by the week it fired in, and
 * that week is the house's (as F-384 made it for the recommendations feed).
 * Keyed on UTC, a card put away on a Los Angeles Sunday evening was already
 * in next week's key, so a one-card dismiss did not hold even for the night.
 *
 * The instant below is Monday 03:00 UTC (ISO week 42) and Sunday 20:00 in
 * Los Angeles (ISO week 41): the boundary where the two weeks differ.
 */
const SUNDAY_EVENING_LA = new Date("2026-10-12T03:00:00.000Z");
const LA = "America/Los_Angeles";
const TYPE = "overall.revenue.goal_pace";
const RULE = `insight:${TYPE}`;

function bare(over: Partial<InsightRecord> = {}): InsightRecord {
  return {
    candidateKey: TYPE,
    category: "goals",
    sentence: "You are behind pace on your goal.",
    score: 1,
    effectPct: null,
    z: null,
    entityKey: null,
    entityLabel: null,
    evidence: {} as any,
    subject: null,
    periodKey: null,
    suppression: {
      key: RULE,
      scope: "rule" as any,
      keys: { rule: RULE } as any,
    },
    periodStart: null,
    periodEnd: null,
    ...over,
  } as InsightRecord;
}

describe("keyOnFiring (F-796)", () => {
  it("keys a subject-less card on the house's week, not UTC's", () => {
    const r = keyOnFiring(bare(), SUNDAY_EVENING_LA, LA);
    expect(r.periodKey).toBe("fire:week:2026-W41");
    expect(r.suppression.key).toBe(`${RULE}#*#fire:week:2026-W41`);
  });

  it("with no zone, keys on UTC as before", () => {
    expect(keyOnFiring(bare(), SUNDAY_EVENING_LA, null).periodKey).toBe(
      "fire:week:2026-W42",
    );
  });

  it("leaves a card that names a subject exactly as it was", () => {
    const named = { ...bare(), subject: "Wednesday" };
    expect(keyOnFiring(named, SUNDAY_EVENING_LA, LA)).toBe(named);
  });
});

/** A Supabase stub: every read answers its table's rows. */
function makeClient(rowsByTable: Record<string, any[]>) {
  return {
    from: (table: string) => {
      const rows = rowsByTable[table] ?? [];
      const builder: any = {};
      for (const m of [
        "select",
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "is",
        "or",
        "not",
        "order",
        "limit",
        "range",
      ])
        builder[m] = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.single = builder.maybeSingle;
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    },
  };
}

async function liveKey(restaurants: any[]) {
  const client = makeClient({ restaurants });
  const svc = new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({ dates: new Set(), readable: true, problem: null }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom([]),
        readable: true,
        problem: null,
      }),
    } as any,
  );
  // One subject-less, period-less finding through the real `record()`.
  jest
    .spyOn(svc as any, "computeGoalsFamily")
    .mockImplementation((_bundle: any, push: any) =>
      push(
        (svc as any).record(
          TYPE,
          "goals",
          "goal",
          {
            measureLabel: "revenue",
            unit: "ratio",
            goalName: "October revenue",
            goalProgressPct: 0.4,
            goalDaysLeft: 10,
            goalOnTrack: false,
          },
          { effectPct: -0.6, n: 14 },
        ),
      ),
    );
  const out = await svc.generate("r1", { persist: false });
  const card = out.insights.find((i) => i.candidateKey === TYPE);
  expect(card).toBeDefined();
  return card!.suppression.key;
}

describe("generate() keys firings on the house's week (F-796)", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: SUNDAY_EVENING_LA,
      doNotFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "nextTick",
        "queueMicrotask",
      ],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("a Los Angeles house's Sunday-evening card is in this week's key", async () => {
    expect(await liveKey([{ timezone: LA }])).toBe(
      `${RULE}#*#fire:week:2026-W41`,
    );
  });

  it("a house with no zone keys on UTC, as before", async () => {
    expect(await liveKey([])).toBe(`${RULE}#*#fire:week:2026-W42`);
  });
});
