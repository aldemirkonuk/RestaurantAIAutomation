/**
 * Which model answers which kind of question, and how the answer is metered.
 *
 * THE DECISION THIS FILE RECORDS (ADR 0120, Proposed)
 * ---------------------------------------------------
 * The founder, 2026-09-04: *"Sonnet 5 for asks, all tiers, metered"* — and,
 * asked whether a quick lookup should really pay Sonnet's rate, he agreed that a
 * lookup or a help-bot turn should use Haiku. So the rule is by TASK CLASS, not
 * by surface and not by tier:
 *
 *   lookup   → Haiku 4.5   — find the thing, name the thing
 *   help     → Haiku 4.5   — answer a question about how this product works
 *   compose  → Sonnet 5    — write a cutting spec, or a configuration proposal
 *
 * "all tiers" is the load-bearing half of the first sentence: a `core` house on
 * a $5 depleting credit gets the same model as a `pro` house
 * (`spend-tiers.ts`). The tier bounds SPEND, never QUALITY. Nothing in this file
 * reads a tier, and that is deliberate rather than incidental.
 *
 * WHAT IS NOT ROUTED HERE, AND WHY NOT
 * ------------------------------------
 * `ConsultantsService` runs Opus (`ANALYTICS_CONSULTANT_MODEL`, default
 * `claude-opus-4-8`, consultants.service.ts:166-168) over an evidence pack with
 * adaptive thinking and a 300-second budget. That is a fourth class — deep
 * analysis — and the founder's decision does not cover it. Routing it would be
 * a model change nobody asked for, made silently, on the most expensive call in
 * the gateway. It stays where it is; the question is filed for the founder.
 *
 * The seven extraction and vision sites (scan-parser, document-extractor,
 * photo-count, vendor-page-extractor, inbound-responder, ux-optimizer) are
 * likewise untouched: each is in a module outside this change's scope, and each
 * has its own latency budget that a model swap would move.
 *
 * PRECEDENCE, AND WHY THE SITE VARIABLE STILL WINS
 * ------------------------------------------------
 *   1. the site's own env var (`GOAL_CUTTING_MODEL`, `ASK_AI_MODEL`)
 *   2. the class env var (`MODEL_FOR_COMPOSE`, …)
 *   3. the class default above
 *
 * An operator who has already set `ASK_AI_MODEL` on a running gateway set it to
 * mean something. A new layer that silently outranked it would change a live
 * deployment's behaviour on deploy, with nothing in the logs saying why — so the
 * narrower instruction wins, and `routedBy` records which rule bit.
 *
 * METERING: THE LEDGER ALREADY EXISTS
 * -----------------------------------
 * Measured before writing anything (2026-09-04): `neural_footprint_event`
 * (migration `20260824141116`) already records, per call, one row
 * (`count`), `input_tokens`, `output_tokens`, `cost_usd`, `restaurant_id`, and
 * `context.model` — five of the six things the founder asked to meter, written
 * by `ModelClientService.persistNfEvent` for every one of the gateway's nine
 * model sites. So there is NO new table and NO migration: a second ledger would
 * be a second answer to "what did this cost", and the two would drift.
 *
 * The two things it did not record are added here as explicit `context` keys:
 *
 *   `task_class`  — lookup | help | compose. Distinct from the existing
 *                   `task_type`, which is the SITE's task ("goal_cutting_spec").
 *                   One is the routing rule, the other is the job.
 *   `asked_by`    — the user id that caused the call, or `null`.
 *
 * They are written as literal keys in `routingContext()` below rather than
 * assembled from variables, so a guard reading this source can see exactly which
 * keys reach the row.
 *
 * `asked_by: null` is written EXPLICITLY when no user is known, rather than
 * omitted. An absent key means "this row predates the field"; a null means "we
 * recorded that we could not name who asked". Those are different facts, and
 * conflating them is the shape ADR 0020 exists to stop.
 *
 * COST CONSEQUENCE, STATED RATHER THAN DISCOVERED
 * -----------------------------------------------
 * Sonnet 5 is $2.00/$10.00 per MTok against Haiku 4.5's $1.00/$5.00 — the two
 * `compose` sites become twice as expensive per token. Both are small calls
 * (400 and 1024 max output tokens), so the absolute figure is cents, but a
 * `core` house is on a $5 credit that does not reset, and the ceiling is
 * enforced by summing `cost_usd`. That is why `claude-sonnet-5` had to be added
 * to `MODEL_PRICING_USD_PER_MTOK` in the same change: an unpriced model writes
 * `cost_usd = NULL`, NULL sums as nothing, and the spend ceiling would have
 * stopped seeing the calls it exists to bound — a routing decision quietly
 * disabling a safety valve.
 */

import type { ConfigService } from "@nestjs/config";

/** The three classes the founder's decision covers. Nothing else is routed. */
export const TASK_CLASSES = ["lookup", "help", "compose"] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

/**
 * The founder's model strings.
 *
 * **Haiku is the undated `claude-haiku-4-5` — founder decision, 2026-09-04.**
 * The first draft carried the dated pin `claude-haiku-4-5-20251001`, which is
 * what `GOAL_CUTTING_MODEL` shipped as its default; `ASK_AI_MODEL` already
 * defaulted to the undated alias, so the gateway named the same model two ways.
 * Asked which to standardise on, the founder chose the alias. Two reasons it is
 * the right way round: the alias is the canonical id in Anthropic's own model
 * table, and a dated snapshot silently stops being the current model without
 * anything in the repo saying so.
 *
 * `resolvePricing` matches the alias exactly and a dated pin by prefix, so
 * either form is priced — this change is about which model is CALLED, not about
 * whether the ledger can cost it.
 *
 * TWO PLACES STILL NAME THE DATED PIN, AND ARE NOT THIS FILE'S TO CHANGE:
 * `ux-optimizer/ux-optimizer.service.ts:259`, and 53 pin sites across
 * `services/agent-orchestrator`. Both are tracked as the model-pin census
 * (`.planning/01-org/applied-ai/ai-orchestration/teams/model-routing-inference-economics/`)
 * under OD-04, which is open precisely because *"no place in the repo says
 * which model does which job"*. Rewriting them from here would be answering
 * that open decision as a side effect of a naming fix.
 */
export const MODEL_FOR_CLASS: Readonly<Record<TaskClass, string>> =
  Object.freeze({
    lookup: "claude-haiku-4-5",
    help: "claude-haiku-4-5",
    compose: "claude-sonnet-5",
  });

/** One env var per class, so a class can be moved without a deploy. */
export const CLASS_ENV_VAR: Readonly<Record<TaskClass, string>> = Object.freeze({
  lookup: "MODEL_FOR_LOOKUP",
  help: "MODEL_FOR_HELP",
  compose: "MODEL_FOR_COMPOSE",
});

/** Why a model was chosen — recorded so an override is visible in the ledger. */
export type RoutedBy = "class-default" | "class-env" | "site-env";

export interface Routing {
  readonly taskClass: TaskClass;
  readonly model: string;
  readonly routedBy: RoutedBy;
  /** The env var that decided it, when one did. */
  readonly envVar: string | null;
}

/**
 * Resolve the model for one call.
 *
 * A blank or whitespace-only env value is treated as UNSET rather than as a
 * model name. `ConfigService.get` returns `""` for an env var exported empty,
 * and `"" || default` would already fall through — but an env var set to a
 * single space would not, and would be sent to the API as a model id. Trimming
 * and testing for emptiness closes that without inventing a fallback.
 */
export function resolveModel(opts: {
  config: Pick<ConfigService, "get">;
  taskClass: TaskClass;
  /** The site's own long-standing variable, if it has one. */
  siteEnvVar?: string;
}): Routing {
  const { config, taskClass, siteEnvVar } = opts;

  const read = (name: string): string | null => {
    const raw = config.get<string>(name);
    const value = typeof raw === "string" ? raw.trim() : "";
    return value === "" ? null : value;
  };

  if (siteEnvVar) {
    const site = read(siteEnvVar);
    if (site !== null)
      return { taskClass, model: site, routedBy: "site-env", envVar: siteEnvVar };
  }

  const classVar = CLASS_ENV_VAR[taskClass];
  const byClass = read(classVar);
  if (byClass !== null)
    return { taskClass, model: byClass, routedBy: "class-env", envVar: classVar };

  return {
    taskClass,
    model: MODEL_FOR_CLASS[taskClass],
    routedBy: "class-default",
    envVar: null,
  };
}

/**
 * The metering keys this call adds to `NfMeta.context`.
 *
 * Written as three literal keys, never spread from a variable, so the write is
 * readable from the source: `task_class`, `model_routed_by`, `asked_by`.
 * `restaurant_id`, the token counts, the model and the cost are already written
 * by `ModelClientService.persistNfEvent` and are deliberately NOT repeated here
 * — a second copy of a figure is a second figure to keep true.
 *
 * @param askedBy the user id that caused the call. `null` — never a placeholder
 *   string — when the call site genuinely does not know who asked.
 */
export function routingContext(
  routing: Routing,
  askedBy: string | null,
): {
  task_class: TaskClass;
  model_routed_by: RoutedBy;
  asked_by: string | null;
} {
  return {
    task_class: routing.taskClass,
    model_routed_by: routing.routedBy,
    asked_by: typeof askedBy === "string" && askedBy.trim() !== "" ? askedBy : null,
  };
}
