/**
 * The seam between a model and a chart.
 *
 * The founder asked for AI to "create the analytics" for a goal. What is built
 * is the only version of that which does not break ADR 0020: the model
 * CONFIGURES the deterministic engine — it names one of the analyses this page
 * already computes, one drawing that is true of that analysis's data, and one
 * window the page offers — and every one of those three values is checked here
 * before it can reach a cutting.
 *
 * These cases are written against the failure that already happened once in
 * this codebase: `ux-optimizer.service.ts` accepted any string as a proposal
 * `kind`, and an invented kind was written into `ux_proposals.kind` as though
 * it were real. The equivalent here would be an invented `analysisId` rendering
 * as a blank square the reader reads as "there is nothing to show".
 */

import {
  CUTTING_CATALOGUE,
  CUTTING_IDS,
  CUTTING_WINDOWS,
  catalogueForPrompt,
  checkCuttingSpec,
} from "./report-cuttings";
import { GoalsService, stripFence } from "./goals.service";

/**
 * The verdict recorder, captured (OD-59 / ADR 0029 P3.0).
 *
 * `goal_cutting_spec` used to emit a footprint row carrying `call_level_v0`
 * alone — "the HTTP request returned 200" — which is silent about whether the
 * assistant named an analysis this sheet carries. These rows are what
 * `check_task_types_are_graded.py` demands and what a reader of
 * `nf_a.doneability_verdict_coverage` will actually see.
 */
const graded: Array<{ basis: string; outcome: unknown; evidence: any }> = [];
const verdicts = {
  record: (_ref: unknown, basis: string, v: any) =>
    graded.push({ basis, outcome: v.outcome, evidence: v.evidence }),
  recordForEvent: () => {},
} as any;


describe("checkCuttingSpec — nothing outside the catalogue is honoured", () => {
  const good = {
    analysisId: "pacing",
    graph: "bars",
    days: null,
    why: "Purchasing spend is the goal's own measure, and pacing compares this month's spend with last month's.",
  };

  it("accepts a spec whose three values are all in the catalogue", () => {
    const check = checkCuttingSpec(good);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.spec).toEqual({
      analysisId: "pacing",
      graph: "bars",
      days: null,
      why: good.why,
    });
  });

  it("refuses an analysis id the sheet does not carry", () => {
    const check = checkCuttingSpec({ ...good, analysisId: "wine_sales_deep_dive" });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("unknown-analysis");
    expect(check.detail).toContain("wine_sales_deep_dive");
  });

  it("refuses a drawing that is not TRUE of that analysis, and does not quietly substitute one", () => {
    // `pacing` offers bars | table | figure. A heat map of two numbers is not
    // a heat map. The refusal names what IS offered.
    const check = checkCuttingSpec({ ...good, graph: "heatmap" });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("graph-not-true-of-that-analysis");
    expect(check.detail).toContain("bars, table, figure");
  });

  it("refuses a window on an analysis whose window the server fixes", () => {
    const check = checkCuttingSpec({ ...good, days: 30 });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("window-on-an-analysis-that-takes-none");
  });

  it("refuses a window the page does not offer, on the one analysis that takes one", () => {
    const ok = checkCuttingSpec({
      analysisId: "till",
      graph: "area",
      days: 90,
      why: "The till is where wine revenue is booked.",
    });
    expect(ok.ok).toBe(true);

    const bad = checkCuttingSpec({
      analysisId: "till",
      graph: "area",
      days: 45,
      why: "The till is where wine revenue is booked.",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason).toBe("window-not-offered");
    expect(bad.detail).toContain("7, 30, 90");
  });

  it("refuses a proposal with no reason — an unexplained pick is not a proposal", () => {
    for (const why of ["", "   ", undefined, 7]) {
      const check = checkCuttingSpec({ ...good, why });
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.reason).toBe("no-reason-given");
    }
  });

  it("refuses anything that is not an object at all", () => {
    for (const raw of [null, undefined, "pacing", 3, true]) {
      const check = checkCuttingSpec(raw);
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.reason).toBe("not-an-object");
    }
  });

  it("caps the model's one free-text field", () => {
    const check = checkCuttingSpec({ ...good, why: "x".repeat(5000) });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.spec.why.length).toBe(400);
  });

  it("cannot be fooled by a prototype key", () => {
    // `constructor` and `toString` are on every object; a lookup that used
    // `CUTTING_CATALOGUE[id]` without an own-property check would resolve them.
    for (const analysisId of ["constructor", "toString", "__proto__"]) {
      const check = checkCuttingSpec({ ...good, analysisId });
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.reason).toBe("unknown-analysis");
    }
  });
});

describe("the catalogue itself", () => {
  it("carries no analysis without a drawing that is true of it", () => {
    for (const id of CUTTING_IDS) {
      expect(CUTTING_CATALOGUE[id].graphs.length).toBeGreaterThan(0);
      expect(CUTTING_CATALOGUE[id].answers.length).toBeGreaterThan(10);
    }
  });

  it("offers a window on exactly one analysis — the only endpoint that takes one", () => {
    const windowed = CUTTING_IDS.filter((id) => CUTTING_CATALOGUE[id].takesWindow);
    expect(windowed).toEqual(["till"]);
    expect(CUTTING_WINDOWS).toEqual([7, 30, 90]);
  });

  it("excludes the writing desk and the goals desk from what a model may propose", () => {
    // The writing desk has no register behind it (OD-81) and the goals desk is
    // where the reader already is. Neither is an answer to "show me this goal".
    expect(CUTTING_IDS).not.toContain("writing");
    expect(CUTTING_IDS).not.toContain("goals");
  });

  it("is frozen, so nothing can widen it at runtime", () => {
    expect(Object.isFrozen(CUTTING_CATALOGUE)).toBe(true);
    try {
      (CUTTING_CATALOGUE as Record<string, unknown>).anything = {};
    } catch {
      /* strict mode throws; sloppy mode is silent. Either way it must not land. */
    }
    expect(checkCuttingSpec({ analysisId: "anything", graph: "bars", why: "x" }).ok).toBe(
      false,
    );
  });

  it("gives the model the whole vocabulary and nothing else", () => {
    const prompt = catalogueForPrompt();
    for (const id of CUTTING_IDS) expect(prompt).toContain(`- ${id}:`);
    expect(prompt).toContain("Takes days: 7 | 30 | 90");
  });
});

describe("GoalsService.updateGoal — an edit writes only what was sent", () => {
  /** The last patch handed to Supabase, and the chain that captures it. */
  function stubDb() {
    const seen: { patch: Record<string, unknown> | null } = { patch: null };
    const chain: any = {
      update(patch: Record<string, unknown>) {
        seen.patch = patch;
        return chain;
      },
      eq: () => chain,
      select: () => chain,
      maybeSingle: async () => ({ data: { id: "g1", ...seen.patch }, error: null }),
    };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: () => undefined } as any,
      {} as any,
      verdicts,
    );
    return { service, seen };
  }

  it("writes only the fields the caller sent, plus updated_at", async () => {
    const { service, seen } = stubDb();
    await service.updateGoal("r1", "g1", { name: "  Winter wine push  " });
    expect(Object.keys(seen.patch ?? {}).sort()).toEqual(["name", "updated_at"]);
    expect(seen.patch?.name).toBe("Winter wine push");
  });

  it("clears a deadline when the caller sends null, and refuses a malformed one", async () => {
    const { service, seen } = stubDb();
    await service.updateGoal("r1", "g1", { deadline: null });
    expect(seen.patch?.deadline).toBeNull();
    await expect(
      service.updateGoal("r1", "g1", { deadline: "next Friday" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("refuses a target that is not a positive number, an unknown direction and an unknown period", async () => {
    const { service } = stubDb();
    await expect(service.updateGoal("r1", "g1", { targetValue: 0 })).rejects.toThrow(
      /targetValue/,
    );
    await expect(
      service.updateGoal("r1", "g1", { targetValue: -5 }),
    ).rejects.toThrow(/targetValue/);
    await expect(
      service.updateGoal("r1", "g1", { direction: "roughly" as any }),
    ).rejects.toThrow(/at_least/);
    await expect(
      service.updateGoal("r1", "g1", { period: "fortnight" }),
    ).rejects.toThrow(/period must be/);
  });

  it("refuses to change the metric a goal was baselined against", async () => {
    const { service } = stubDb();
    await expect(
      service.updateGoal("r1", "g1", { metricKey: "checks" } as any),
    ).rejects.toThrow(/baseline was measured against the old one/);
  });

  it("refuses an empty name rather than writing 'Untitled goal' over one", async () => {
    const { service } = stubDb();
    await expect(service.updateGoal("r1", "g1", { name: "   " })).rejects.toThrow(
      /needs a name/,
    );
  });
});

describe("GoalsService.proposeCuttingSpec — a provider that is not configured does nothing", () => {
  it("answers available:false with the reason, and proposes nothing", async () => {
    const goal = {
      id: "g1",
      name: "Lift wine revenue",
      metric_key: "wine_revenue",
      target_value: 9000,
      direction: "at_least",
      deadline: "2026-12-31",
      period: "custom",
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: goal, error: null }),
    };
    const called = { model: 0 };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: () => undefined } as any, // no ANTHROPIC_API_KEY
      {
        call: async () => {
          called.model++;
          return {};
        },
      } as any,
      verdicts,
    );

    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(called.model).toBe(0);
    expect(out.available).toBe(false);
    expect(out.spec).toBeNull();
    expect(out.reason).toContain("ANTHROPIC_API_KEY");
    expect(out.goal).toEqual({
      id: "g1",
      name: "Lift wine revenue",
      metricKey: "wine_revenue",
    });
  });

  it("reports a model answer that fails validation instead of repairing it", async () => {
    const goal = {
      id: "g1",
      name: "Lift wine revenue",
      metric_key: "wine_revenue",
      target_value: 9000,
      direction: "at_least",
      deadline: null,
      period: "month",
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: goal, error: null }),
    };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined) } as any,
      {
        call: async () => ({
          content: [
            {
              type: "text",
              text: '```json\n{"analysisId":"wine_deep_dive","graph":"bars","days":null,"why":"it fits"}\n```',
            },
          ],
        }),
      } as any,
      verdicts,
    );

    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.available).toBe(true);
    expect(out.spec).toBeNull();
    expect(out.rejected?.reason).toBe("unknown-analysis");
  });

  it("returns the validated spec when the model stays inside the catalogue", async () => {
    const goal = {
      id: "g1",
      name: "Hold purchasing",
      metric_key: "purchase_spend",
      target_value: 4000,
      direction: "at_most",
      deadline: null,
      period: "month",
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: goal, error: null }),
    };
    const seen: { nf: any } = { nf: null };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined) } as any,
      {
        call: async (opts: any) => {
          seen.nf = opts.nf;
          return {
            content: [
              {
                type: "text",
                text: '{"analysisId":"pacing","graph":"bars","days":null,"why":"Pacing is the same measure over the month before."}',
              },
            ],
          };
        },
      } as any,
      verdicts,
    );

    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.spec).toEqual({
      analysisId: "pacing",
      graph: "bars",
      days: null,
      why: "Pacing is the same measure over the month before.",
    });
    // NF-A: the call is attributed and separable in the spend ledger.
    expect(seen.nf.taskType).toBe("goal_cutting_spec");
    expect(seen.nf.restaurantId).toBe("r1");
    expect(seen.nf.choice({ content: out.spec ? [{ type: "text", text: '{"analysisId":"pacing"}' }] : [] })).toBe(
      "pacing",
    );
  });

  it("says the book could not be reached rather than throwing at the desk", async () => {
    const goal = {
      id: "g1",
      name: "Lift checks",
      metric_key: "checks",
      target_value: 400,
      direction: "at_least",
      deadline: null,
      period: "month",
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: goal, error: null }),
    };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined) } as any,
      {
        call: async () => {
          throw new Error("Anthropic 529: overloaded");
        },
      } as any,
      verdicts,
    );

    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.spec).toBeNull();
    expect(out.reason).toContain("could not be reached");
    expect(out.reason).toContain("529");
  });
});

describe("stripFence — a fence is transport, not an answer", () => {
  it("unwraps a fenced object and leaves a bare one alone", () => {
    expect(JSON.parse(stripFence('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(JSON.parse(stripFence('```\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(JSON.parse(stripFence('{"a":1}'))).toEqual({ a: 1 });
  });

  it("does not turn unreadable output into a readable one", () => {
    expect(() => JSON.parse(stripFence("I think you should use pacing."))).toThrow();
  });
});

/**
 * The doneability verdict this call writes (OD-59 / ADR 0029 P3.0).
 *
 * Before this, `goal_cutting_spec` recorded `call_level_v0` and nothing else —
 * "the HTTP request returned 200 and was not truncated" — so a model that named
 * an analysis this sheet does not carry was indistinguishable, in the ledger,
 * from one that configured the sheet correctly. `check_task_types_are_graded.py`
 * refuses that.
 *
 * The three readings are asserted end to end through the service, not against
 * `cuttingSpecVerdict` alone: a pure function returning the right object proves
 * nothing if the service never calls it on one of its four exit paths.
 */
describe("goal_cutting_spec carries a real verdict, not just call_level_v0", () => {
  const GOAL = {
    id: "g1",
    name: "Hold purchasing spend",
    metric_key: "purchase_spend",
    target_value: 4000,
    direction: "at_most",
    deadline: null,
    period: "month",
  };

  /** A service whose model client answers with `text`, or throws `boom`. */
  function serviceThat(answer: { text?: string; throws?: string }) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: GOAL, error: null }),
    };
    return new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      {
        get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined),
      } as any,
      {
        call: async () => {
          if (answer.throws) throw new Error(answer.throws);
          return { content: [{ type: "text", text: answer.text }] };
        },
      } as any,
      verdicts,
    );
  }

  beforeEach(() => {
    graded.length = 0;
  });

  it("grades an accepted spec success, and names the model the routing chose", async () => {
    const service = serviceThat({
      text: JSON.stringify({
        analysisId: "pacing",
        graph: "bars",
        days: null,
        why: "Spend pacing is the goal's own measure.",
      }),
    });
    const out = await service.proposeCuttingSpec("r1", "g1", "user-7");
    expect(out.spec?.analysisId).toBe("pacing");

    expect(graded).toHaveLength(1);
    expect(graded[0].basis).toBe("schema_v1");
    expect(graded[0].outcome).toBe("success");
    expect(graded[0].evidence.status).toBe("accepted");
    expect(graded[0].evidence.analysis_id).toBe("pacing");
    expect(graded[0].evidence.graph).toBe("bars");
    // The routing that chose the model rides the verdict (ADR 0120), so a
    // reader can ask "did the cheaper model start failing this check?".
    expect(graded[0].evidence.model).toBe("claude-sonnet-5");
    expect(graded[0].evidence.task_class).toBe("compose");
    expect(graded[0].evidence.model_routed_by).toBe("class-default");
  });

  it("grades a refused spec FAILURE, carrying the check's own reason", async () => {
    const service = serviceThat({
      text: JSON.stringify({
        analysisId: "wine_deep_dive",
        graph: "bars",
        days: null,
        why: "made up",
      }),
    });
    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.spec).toBeNull();

    expect(graded).toHaveLength(1);
    expect(graded[0].outcome).toBe("failure");
    expect(graded[0].evidence.status).toBe("refused_by_check");
    expect(graded[0].evidence.rejection).toBe("unknown-analysis");
    expect(String(graded[0].evidence.detail)).toContain("wine_deep_dive");
    // No user pressed it in this case, and that is recorded as null rather
    // than as a placeholder string.
    expect(graded[0].evidence.model).toBe("claude-sonnet-5");
  });

  it("grades an unreachable book NULL — the grader ran, the case is untestable", async () => {
    const service = serviceThat({ throws: "socket hang up" });
    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.reason).toContain("could not be reached");

    expect(graded).toHaveLength(1);
    // NOT `failure`: a model that never answered cannot be judged on how it
    // configured the sheet, and grading it down would move the score with the
    // network rather than with the model.
    expect(graded[0].outcome).toBeNull();
    expect(graded[0].evidence.status).toBe("degraded");
    expect(graded[0].evidence.untestable).toBe("model_unreachable");
  });

  it("grades an unreadable answer NULL, with which failure it was", async () => {
    const service = serviceThat({ text: "not json at all" });
    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.rejected?.reason).toBe("not-an-object");

    expect(graded).toHaveLength(1);
    expect(graded[0].outcome).toBeNull();
    expect(graded[0].evidence.untestable).toBe("answer_not_json");
  });

  it("writes NO verdict when no model was asked — an orphan row grades nothing", async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: GOAL, error: null }),
    };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: () => undefined } as any, // no ANTHROPIC_API_KEY
      { call: async () => ({}) } as any,
      verdicts,
    );
    const out = await service.proposeCuttingSpec("r1", "g1");
    expect(out.available).toBe(false);
    // The method returns before the model client is called, so there is no
    // footprint row to grade. Coverage must not be inflated with rows that
    // grade nothing.
    expect(graded).toHaveLength(0);
  });
});
