/**
 * A goal records the recommendation it came from — and refuses a source it
 * cannot resolve.
 *
 * `analytics_goals.source_rule_key` (migration `20260903160000`) exists so
 * `/recommendations` can say "this entry is already being watched" instead of
 * the weaker true sentence it was limited to before ("you already hold a goal
 * on Wine revenue"). That only works if the stored string is a key the engine
 * actually evaluates: a typo, a renamed rule or a client that sends a
 * suppression key (`rule#subject#grain`) instead of a rule key would store a
 * value nothing can ever match, and the page would then quietly show NO
 * watched state — an absence read as "not watched", which is the exact fault
 * ADR 0051 names.
 *
 * So the load-bearing assertions here are the negative ones: an unknown source
 * is a 400 with words, BEFORE any row is written, and a goal with no source is
 * stored as NULL rather than as a guess.
 */

import { GoalsService } from "./goals.service";
import { DatabaseService } from "../database/database.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";

type Rows = Record<string, any[]>;

/**
 * Chainable Supabase stub with the write path included — `insert(...)`
 * `.select()` `.single()` — so a test can read the payload that was actually
 * sent rather than the payload the caller intended.
 */
function makeClient(rowsByTable: Rows) {
  const calls: Array<{ table: string; method: string; args: any[] }> = [];
  const passthrough = [
    "select",
    "insert",
    "update",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "in",
    "or",
    "not",
    "order",
    "limit",
  ];
  return {
    calls,
    from: jest.fn((table: string) => {
      const rows = rowsByTable[table] ?? [];
      const builder: any = {};
      for (const method of passthrough) {
        builder[method] = jest.fn((...args: any[]) => {
          calls.push({ table, method, args });
          return builder;
        });
      }
      builder.single = jest.fn(() =>
        Promise.resolve({ data: rows[0] ?? null, error: null }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    }),
  };
}

function makeGoals(rowsByTable: Rows) {
  const client = makeClient(rowsByTable);
  const db = { getClient: () => client } as unknown as DatabaseService;
  const service = new GoalsService(
    db,
    {} as InsightGeneratorService,
    { get: () => undefined } as never,
    {} as never,
  );
  return { service, client };
}

const body = {
  name: "Wine revenue back to baseline",
  metricKey: "wine_revenue",
  targetValue: 2500,
  period: "week",
  direction: "at_least" as const,
  deadline: "2026-09-10",
};

const insertPayload = (client: ReturnType<typeof makeClient>) =>
  client.calls.find(
    (c) => c.table === "analytics_goals" && c.method === "insert",
  )?.args[0];

describe("GoalsService.createGoal — sourceRuleKey", () => {
  it("stores the rule key a recommendation sent", async () => {
    const { service, client } = makeGoals({
      pos_checks: [],
      analytics_goals: [{ id: "g1", source_rule_key: "plowhorse_repricing" }],
    });

    await service.createGoal("r1", {
      ...body,
      sourceRuleKey: "plowhorse_repricing",
    });

    expect(insertPayload(client).source_rule_key).toBe("plowhorse_repricing");
  });

  it("accepts the goal_behind_<uuid> family the engine generates per goal", async () => {
    const { service, client } = makeGoals({
      pos_checks: [],
      analytics_goals: [{ id: "g2" }],
    });

    await service.createGoal("r1", {
      ...body,
      sourceRuleKey: "goal_behind_550e8400-e29b-41d4-a716-446655440000",
    });

    expect(insertPayload(client).source_rule_key).toBe(
      "goal_behind_550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("writes NULL — not a guess — when no recommendation sent the goal", async () => {
    const { service, client } = makeGoals({
      pos_checks: [],
      analytics_goals: [{ id: "g3" }],
    });

    await service.createGoal("r1", body);

    // NULL means "a person typed this". It must never be filled in with the
    // metric key, the goal name, or anything else that would read back as
    // provenance the goal does not have.
    expect(insertPayload(client).source_rule_key).toBeNull();
  });

  it("refuses a rule the engine does not evaluate, and writes nothing", async () => {
    const { service, client } = makeGoals({
      pos_checks: [],
      analytics_goals: [{ id: "g4" }],
    });

    await expect(
      service.createGoal("r1", { ...body, sourceRuleKey: "wine_sales_dive" }),
    ).rejects.toThrow(/Unknown recommendation rule 'wine_sales_dive'/);

    expect(insertPayload(client)).toBeUndefined();
  });

  it("refuses a SUPPRESSION key, which is the near-miss a client is most likely to send", async () => {
    const { service } = makeGoals({ pos_checks: [], analytics_goals: [] });

    // `rule#subject#grain` is what `/recommendations` dismissals post. It is a
    // different vocabulary and would never match a rule key on read-back.
    await expect(
      service.createGoal("r1", {
        ...body,
        sourceRuleKey: "sales_below_weekday_baseline#wednesday#d:2026-09-02",
      }),
    ).rejects.toThrow(/Unknown recommendation rule/);
  });

  it("names what IS accepted in the refusal, so the mistake is fixable", async () => {
    const { service } = makeGoals({ pos_checks: [], analytics_goals: [] });

    await expect(
      service.createGoal("r1", { ...body, sourceRuleKey: "nope" }),
    ).rejects.toThrow(/stockout_imminent/);
  });

  it("keeps the catalogue in step with the rules the engine actually fires", () => {
    // The list is duplicated in goals.service.ts to avoid a dependency cycle,
    // so this is the thing that notices when a rule is added or renamed:
    // recommendations.service.ts is read as text and every rule("…") key it
    // evaluates must be a key a goal may name.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require("path");
    const src = readFileSync(
      join(__dirname, "recommendations.service.ts"),
      "utf8",
    );
    const fired = [...src.matchAll(/\brule\(\s*"([a-z_]+)"/g)].map(
      (m: RegExpMatchArray) => m[1],
    );
    expect(fired.length).toBeGreaterThan(0);
    for (const key of fired)
      expect(GoalsService.isRecommendationRuleKey(key)).toBe(true);
  });
});
