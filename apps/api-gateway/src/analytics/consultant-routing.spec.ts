/**
 * The consultant is its own task class, and the ledger says so.
 *
 *   *"Fourth class: consult."*          — the founder, 2026-09-05 (ADR 0120 Q2)
 *
 * `model-routing.spec.ts` pins the REGISTRY: that `consult` exists, that it
 * carries `claude-opus-4-8`, that its env var is its own. None of that proves
 * the consultant call actually goes through it — the service could still hold
 * its old hard-coded string and the registry would sit there being correct and
 * unused. So this file drives `ConsultantsService.consult()` with a captured
 * model client and asserts on what reached the wire and what reached the row:
 *
 *   • the model sent to the API,
 *   • `context.task_class`, which is what separates this call's spend from
 *     `compose`'s in `neural_footprint_event`,
 *   • `context.asked_by`, which must be the user id or a null and never a
 *     placeholder string that counts and groups like a user id,
 *   • that `ANALYTICS_CONSULTANT_MODEL` still wins, because a running gateway
 *     that set it meant it.
 *
 * The evidence pack, the grounding check and the verdict are NOT retested here
 * — `consultant-grounding.spec.ts` owns those. This file is about routing and
 * metering only.
 */

import { ConsultantsService } from "./consultants.service";

/** A supabase-js stand-in for the one read `isEnabled` makes. */
function db(enabled: boolean) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { enabled }, error: null }),
  };
  return { getClient: () => ({ from: () => chain }) } as any;
}

function config(vars: Record<string, string | undefined>) {
  return { get: (name: string) => vars[name] } as any;
}

/** Captures the one `call()` the consultant makes and answers it. */
function modelClient(captured: { body?: any; nf?: any }) {
  return {
    call: async (args: any) => {
      captured.body = args.body;
      captured.nf = args.nf;
      args.nf?.eventRef?.settle?.("nf-1");
      return {
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [
          {
            type: "text",
            text: JSON.stringify({
              claims: [
                {
                  claim: "Vendor concentration is high.",
                  why_it_matters: "One vendor failing stops the list.",
                  suggested_resolution: "Split the next order.",
                  confidence: 0.6,
                  evidence_refs: ["risk.vendorConcentration.hhi"],
                },
              ],
            }),
          },
        ],
      };
    },
  } as any;
}

const analytics = {
  getFinancialSummary: async () => ({ cogsRatio: 0.3 }),
  getRiskProfile: async () => ({ vendorConcentration: { hhi: 0.4 } }),
  getInventoryScience: async () => ({ params: {}, reorderList: [], skuCount: 1 }),
} as any;
const insights = { generate: async () => ({ insights: [] }) } as any;
const verdicts = { record: () => undefined } as any;

function service(vars: Record<string, string | undefined>, captured: any) {
  return new ConsultantsService(
    db(true),
    config({ ANTHROPIC_API_KEY: "test-key", ...vars }),
    modelClient(captured),
    analytics,
    insights,
    verdicts,
  );
}

describe("ConsultantsService — the consult class reaches the wire and the row", () => {
  it("calls the class default, which is the model it already ran", async () => {
    const captured: any = {};
    const out: any = await service({}, captured).consult("r-1", "finance", "u-1");
    // Unchanged by design: naming the class must not swap the model.
    expect(captured.body.model).toBe("claude-opus-4-8");
    expect(out.model).toBe("claude-opus-4-8");
  });

  it("writes task_class 'consult' on the ledger row, not 'compose'", async () => {
    const captured: any = {};
    await service({}, captured).consult("r-1", "finance", "u-1");
    expect(captured.nf.context.task_class).toBe("consult");
    expect(captured.nf.context.model_routed_by).toBe("class-default");
    // The site's own task stays what it was: `task_type` is the JOB, and
    // `task_class` is the routing rule. Neither replaces the other.
    expect(captured.nf.taskType).toBe("consultant_analysis");
    expect(captured.nf.context.persona).toBe("finance");
  });

  it("records who asked, and a null — never a placeholder — when it cannot", async () => {
    const withUser: any = {};
    await service({}, withUser).consult("r-1", "finance", "u-1");
    expect(withUser.nf.context.asked_by).toBe("u-1");

    for (const missing of [null, "", "   "] as Array<string | null>) {
      const anon: any = {};
      await service({}, anon).consult("r-1", "finance", missing);
      expect(anon.nf.context.asked_by).toBeNull();
    }

    // The default is the honest one too: a caller that passes nothing records
    // that nobody was named, rather than inheriting a previous asker.
    const omitted: any = {};
    await service({}, omitted).consult("r-1", "finance");
    expect(omitted.nf.context.asked_by).toBeNull();
  });

  it("keeps ANALYTICS_CONSULTANT_MODEL outranking the class", async () => {
    const captured: any = {};
    await service(
      { ANALYTICS_CONSULTANT_MODEL: "claude-sonnet-5" },
      captured,
    ).consult("r-1", "finance", "u-1");
    expect(captured.body.model).toBe("claude-sonnet-5");
    expect(captured.nf.context.model_routed_by).toBe("site-env");
    expect(captured.nf.context.task_class).toBe("consult");
  });

  it("does not move when MODEL_FOR_COMPOSE moves", async () => {
    // The rejected path (folding consult into compose) is what this refuses:
    // an incident override on the composing sites must not reach the most
    // expensive call in the gateway.
    const captured: any = {};
    await service({ MODEL_FOR_COMPOSE: "claude-haiku-4-5" }, captured).consult(
      "r-1",
      "finance",
      "u-1",
    );
    expect(captured.body.model).toBe("claude-opus-4-8");
  });

  it("moves when MODEL_FOR_CONSULT moves, and says the class chose it", async () => {
    const captured: any = {};
    await service({ MODEL_FOR_CONSULT: "claude-sonnet-5" }, captured).consult(
      "r-1",
      "finance",
      null,
    );
    expect(captured.body.model).toBe("claude-sonnet-5");
    expect(captured.nf.context.model_routed_by).toBe("class-env");
  });
});
