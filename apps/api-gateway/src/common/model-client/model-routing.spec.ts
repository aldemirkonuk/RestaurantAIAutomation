/**
 * Model routing by task class, and the metering that makes it auditable.
 *
 * Three things could go wrong quietly here, and each has a case:
 *
 *  1. **A live gateway's own setting stops being honoured.** `ASK_AI_MODEL` and
 *     `GOAL_CUTTING_MODEL` are set on running deployments. If the class layer
 *     outranked them, a deploy would change which model answers, with nothing
 *     saying so.
 *  2. **An override becomes invisible.** If the ledger recorded only the model
 *     and not WHICH rule chose it, "why is this house on Haiku" would need
 *     archaeology across env files.
 *  3. **"Who asked" degrades into a placeholder.** `asked_by: "unknown"` is a
 *     string that sorts, groups and counts like a user id. `null` is the only
 *     honest value for an unknown, and the trimming case pins it.
 */

import {
  CLASS_ENV_VAR,
  MODEL_FOR_CLASS,
  TASK_CLASSES,
  resolveModel,
  routingContext,
} from "./model-routing";
import { isModelPriced } from "./model-client.service";

/** A ConfigService stand-in: only `get` is used, and only for strings. */
function config(vars: Record<string, string | undefined>) {
  return { get: (name: string) => vars[name] } as unknown as Parameters<
    typeof resolveModel
  >[0]["config"];
}

describe("resolveModel — the founder's routing, 2026-09-04", () => {
  it("sends compose to Sonnet 5 and the two Haiku classes to Haiku 4.5", () => {
    expect(MODEL_FOR_CLASS.compose).toBe("claude-sonnet-5");
    expect(MODEL_FOR_CLASS.lookup).toBe("claude-haiku-4-5-20251001");
    expect(MODEL_FOR_CLASS.help).toBe("claude-haiku-4-5-20251001");
  });

  it("routes every declared class to a model", () => {
    for (const taskClass of TASK_CLASSES) {
      const r = resolveModel({ config: config({}), taskClass });
      expect(r.model).toBe(MODEL_FOR_CLASS[taskClass]);
      expect(r.routedBy).toBe("class-default");
      expect(r.envVar).toBeNull();
    }
  });

  it("routes to no model the cost ledger cannot price", () => {
    // An unpriced model writes cost_usd = NULL, NULL sums as nothing, and the
    // daily spend ceiling stops seeing the calls it exists to bound.
    for (const taskClass of TASK_CLASSES) {
      expect(isModelPriced(MODEL_FOR_CLASS[taskClass])).toBe(true);
    }
  });

  it("reads no tier and no restaurant — 'all tiers' means the same model", () => {
    // The strongest available assertion: the function's inputs contain no
    // tenant and no tier, so it cannot branch on either.
    const args = resolveModel({ config: config({}), taskClass: "compose" });
    expect(Object.keys(args)).toEqual([
      "taskClass",
      "model",
      "routedBy",
      "envVar",
    ]);
  });
});

describe("resolveModel — precedence", () => {
  it("lets the class env var override the default", () => {
    const r = resolveModel({
      config: config({ [CLASS_ENV_VAR.compose]: "claude-opus-4-8" }),
      taskClass: "compose",
    });
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.routedBy).toBe("class-env");
    expect(r.envVar).toBe("MODEL_FOR_COMPOSE");
  });

  it("lets the site's own variable outrank the class", () => {
    const r = resolveModel({
      config: config({
        MODEL_FOR_COMPOSE: "claude-opus-4-8",
        ASK_AI_MODEL: "claude-haiku-4-5",
      }),
      taskClass: "compose",
      siteEnvVar: "ASK_AI_MODEL",
    });
    expect(r.model).toBe("claude-haiku-4-5");
    expect(r.routedBy).toBe("site-env");
    expect(r.envVar).toBe("ASK_AI_MODEL");
  });

  it("falls through a site variable that is not set", () => {
    const r = resolveModel({
      config: config({}),
      taskClass: "compose",
      siteEnvVar: "GOAL_CUTTING_MODEL",
    });
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.routedBy).toBe("class-default");
  });

  it("treats a blank or whitespace-only value as unset, not as a model id", () => {
    for (const blank of ["", "   ", "\n"]) {
      const r = resolveModel({
        config: config({ ASK_AI_MODEL: blank }),
        taskClass: "compose",
        siteEnvVar: "ASK_AI_MODEL",
      });
      expect(r.model).toBe("claude-sonnet-5");
      expect(r.routedBy).toBe("class-default");
    }
  });

  it("trims a set value rather than sending the whitespace to the API", () => {
    const r = resolveModel({
      config: config({ ASK_AI_MODEL: "  claude-opus-4-8  " }),
      taskClass: "compose",
      siteEnvVar: "ASK_AI_MODEL",
    });
    expect(r.model).toBe("claude-opus-4-8");
  });
});

describe("routingContext — what reaches the ledger", () => {
  const routing = resolveModel({ config: config({}), taskClass: "compose" });

  it("writes exactly three keys, all explicit", () => {
    expect(Object.keys(routingContext(routing, "user-1")).sort()).toEqual([
      "asked_by",
      "model_routed_by",
      "task_class",
    ]);
  });

  it("records the class and the rule that chose the model", () => {
    const ctx = routingContext(routing, "user-1");
    expect(ctx.task_class).toBe("compose");
    expect(ctx.model_routed_by).toBe("class-default");
    expect(ctx.asked_by).toBe("user-1");
  });

  it("records an override as an override", () => {
    const overridden = resolveModel({
      config: config({ MODEL_FOR_COMPOSE: "claude-haiku-4-5" }),
      taskClass: "compose",
    });
    expect(routingContext(overridden, null).model_routed_by).toBe("class-env");
  });

  it("writes null — never a placeholder — for an unknown asker", () => {
    for (const missing of [null, "", "   "]) {
      expect(routingContext(routing, missing as string | null).asked_by).toBeNull();
    }
  });

  it("does not repeat the model, the tokens or the restaurant", () => {
    // Those five are already written by ModelClientService.persistNfEvent. A
    // second copy is a second figure to keep true.
    const keys = Object.keys(routingContext(routing, "user-1"));
    for (const dup of ["model", "input_tokens", "output_tokens", "cost_usd", "restaurant_id"]) {
      expect(keys).not.toContain(dup);
    }
  });
});
