import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import {
  ModelClientError,
  ModelClientService,
  NfEventRef,
} from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import {
  resolveModel,
  routingContext,
} from "../common/model-client/model-routing";
import {
  GROUNDING_BASIS,
  checkGrounding,
  consultantVerdict,
} from "./consultant-grounding";
import { AnalyticsService } from "./analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";

/**
 * ConsultantsService — the optional LLM analytics layer on TOP of the math.
 *
 * The deterministic engine produces the numbers and the template insights;
 * consultants are a SEPARATE, toggle-gated service (default OFF) where an LLM
 * persona (finance / economics / statistics / physics-operations) reads the
 * full quantitative evidence pack and extracts ADDITIONAL weighted claims and
 * simple resolutions beyond the template set. Every claim must cite the
 * evidence it rests on — the prompt forbids inventing numbers.
 *
 * Toggle storage: analytics_insight_prefs row (category = 'consultants').
 * Absent row ⇒ disabled. Enable via PUT /analytics/consultants/:id/toggle.
 *
 * Model: the `consult` task class (ADR 0120 Q2, founder 2026-09-05) — default
 * claude-opus-4-8, unchanged, because deep multi-signal reasoning over an
 * evidence pack is intelligence-sensitive. Precedence is site env
 * (`ANALYTICS_CONSULTANT_MODEL`) → class env (`MODEL_FOR_CONSULT`) → the class
 * default, resolved by `common/model-client/model-routing.ts`, and the NF row
 * carries `task_class: "consult"` so the ledger separates this call's spend
 * from `compose`'s. Calls follow this codebase's existing raw-fetch Messages
 * API convention (see inbound-responder.service.ts).
 */
@Injectable()
export class ConsultantsService {
  private readonly logger = new Logger(ConsultantsService.name);
  private static readonly TOGGLE_CATEGORY = "consultants";

  static readonly PERSONAS: Record<string, string> = {
    finance:
      "a senior corporate-finance operator (ex-PE). You think in unit economics, margins, working capital, capital efficiency (GMROI, turnover, cash conversion), and concentration risk.",
    economics:
      "an applied microeconomist. You think in elasticities, optimal pricing (Lerner), market structure (HHI), incentives, and marginal analysis.",
    statistics:
      "a rigorous statistician. You think in effect sizes, significance, sample sizes, confounders, regression adjustment, and you flag when data is too thin to support a claim.",
    physics:
      "a physicist turned operations scientist. You think in flows, queues, bottlenecks, rates of change, and spatial relationships (distances, layout geometry) — the floor as a physical system.",
  };

  constructor(
    private readonly dbService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly modelClient: ModelClientService,
    private readonly analyticsService: AnalyticsService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly nfVerdicts: NfVerdictService,
  ) {}

  // ==========================================================================
  // Toggle (default OFF)
  // ==========================================================================

  async isEnabled(restaurantId: string): Promise<boolean> {
    const { data } = await this.dbService
      .getClient()
      .from("analytics_insight_prefs")
      .select("enabled")
      .eq("restaurant_id", restaurantId)
      .eq("category", ConsultantsService.TOGGLE_CATEGORY)
      .maybeSingle();
    return data?.enabled === true;
  }

  async setEnabled(restaurantId: string, enabled: boolean) {
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_insight_prefs")
      .upsert(
        {
          restaurant_id: restaurantId,
          category: ConsultantsService.TOGGLE_CATEGORY,
          cadence: "manual",
          enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,category" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { enabled: data.enabled === true };
  }

  // ==========================================================================
  // Consult — persona reads the evidence pack, returns weighted claims
  // ==========================================================================

  /**
   * @param askedBy the user id that caused the call, read from the token by
   *   the controller. `null` — never a placeholder string — when the caller is
   *   a machine or the token carried no user id.
   */
  async consult(
    restaurantId: string,
    persona: string,
    askedBy: string | null = null,
  ) {
    if (!(await this.isEnabled(restaurantId))) {
      return {
        enabled: false,
        message:
          "Consultant agents are disabled for this restaurant. Enable via PUT /analytics/consultants/:restaurantId/toggle.",
      };
    }
    const personaKey = ConsultantsService.PERSONAS[persona]
      ? persona
      : "finance";
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return { enabled: true, error: "ANTHROPIC_API_KEY not configured" };
    }

    // Evidence pack: deterministic outputs only — the consultant reasons over
    // computed numbers, it never touches raw tables.
    const [financial, risk, inventoryScience, generated] =
      await Promise.allSettled([
        this.analyticsService.getFinancialSummary(restaurantId),
        this.analyticsService.getRiskProfile(restaurantId),
        this.analyticsService.getInventoryScience(restaurantId),
        this.insightGenerator.generate(restaurantId, { maxPerCategory: 4 }),
      ]);
    const ok = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value : null;
    const inv = ok(inventoryScience);
    const evidence = {
      financial: ok(financial),
      risk: ok(risk),
      inventoryScience: inv
        ? {
            params: inv.params,
            reorderList: inv.reorderList,
            skuCount: inv.skuCount,
          }
        : null,
      templateInsights: ok(generated)?.insights ?? [],
    };

    // Full prompt spec: `.planning/LLM_INSTRUCTION_PROMPTS.md` §B
    const system = `You are ${ConsultantsService.PERSONAS[personaKey]}
You are consulting for a restaurant wine program. You reason ONLY over the provided analytics evidence pack (deterministic engine output + template insights). You do not have access to raw POS tables or the public internet.

ROLE BOUNDARY
- The engine already computed the numbers and template sentences. You add cross-signal interpretation, prioritization, and manager-ready resolutions.
- You never replace template insights with rewritten "better" metrics.
- You never invent SKUs, vendors, dates, dollars, percentages, ranks, or sample sizes.

HARD RULES
1. Use ONLY values present in the evidence JSON. No extrapolation, no "typical industry" filler numbers, no rounding that changes meaning.
2. Every claim MUST include evidence_refs as JSON paths into the evidence pack (e.g. "risk.vendorConcentration.hhi", "templateInsights[2].sentence").
3. confidence ∈ [0,1] = f(effect size, data sufficiency, consistency across signals). Thin n → low confidence or refuse.
4. suggested_resolution = one concrete action doable within 7 days (order, recount, price, staff prompt, vendor email) — not a strategy essay.
5. Prefer claims that change a decision. Drop interesting-but-inert observations.
6. If evidence is too thin for your discipline, return exactly one claim stating that, confidence ≤ 0.3, evidence_refs listing what was missing.
7. Do not mention being an AI. Do not use markdown fences. Do not apologize.

OUTPUT
Respond with ONLY valid JSON:
{"claims":[{"claim":"…","why_it_matters":"…","suggested_resolution":"…","confidence":0.0,"evidence_refs":["…"]}]}

Return 3–8 claims, sorted by (confidence × decision_importance) descending.
Each claim ≤ 2 sentences. each why_it_matters ≤ 2 sentences. each suggested_resolution ≤ 1 sentence.`;

    // The `consult` class (ADR 0120 Q2, founder 2026-09-05: *"Fourth class:
    // consult."*). The model is UNCHANGED — `MODEL_FOR_CLASS.consult` carries
    // the same `claude-opus-4-8` this line used to hard-code, and
    // `ANALYTICS_CONSULTANT_MODEL` still outranks it as the site variable, so
    // a gateway that already sets it keeps its instruction. What is new is that
    // the choice is declared in one registry and the ledger names this call
    // apart from `compose`.
    const routing = resolveModel({
      config: this.configService,
      taskClass: "consult",
      siteEnvVar: "ANALYTICS_CONSULTANT_MODEL",
    });
    const model = routing.model;
    const meter = routingContext(routing, askedBy);

    // OD-59 / P3.0: this call grades itself on GROUNDING — did the model cite
    // evidence it was actually given — not on whether HTTP returned 200.
    const eventRef = new NfEventRef();
    try {
      // P1 NF-A: routed through the model client. This fetch previously had
      // NO timeout on an Opus call with adaptive thinking — the slowest call
      // in the gateway. 300s is deliberate headroom for deep-thinking Opus
      // over a large evidence pack; before this it was unbounded.
      const payload: any = await this.modelClient.call({
        body: {
          model,
          max_tokens: 4096,
          thinking: { type: "adaptive" },
          system,
          messages: [
            {
              role: "user",
              content: `Evidence pack (authoritative; do not contradict):\n${JSON.stringify(evidence)}\n\nTask: Produce 3–8 weighted claims for the ${personaKey} lens.`,
            },
          ],
        },
        timeoutMs: 300_000,
        nf: {
          subjectId: "AnalyticsConsultant",
          taskType: "consultant_analysis",
          stimulus: "evidence_pack",
          choice: "weighted_claims",
          restaurantId,
          // Metering keys written literally, so the row's shape is readable
          // from this source rather than assembled out of a spread (ADR 0120).
          // `asked_by` is null — never a placeholder — when the caller could
          // not name who asked: an absent key means the row predates the field,
          // a null means we recorded that we do not know.
          context: {
            persona: personaKey,
            task_class: meter.task_class,
            model_routed_by: meter.model_routed_by,
            asked_by: meter.asked_by,
          },
          eventRef,
        },
      });
      if (payload.stop_reason === "refusal") {
        this.nfVerdicts.record(
          eventRef,
          GROUNDING_BASIS,
          consultantVerdict({ refused: true, parsed: false, grounding: null }),
        );
        return { enabled: true, error: "Model declined the request" };
      }
      const textBlock = (payload.content || []).find(
        (b: any) => b.type === "text",
      );
      let claims: any[] = [];
      let parsedOk = false;
      try {
        const parsed = JSON.parse(
          (textBlock?.text || "{}").replace(/^```json\s*|\s*```$/g, ""),
        );
        claims = Array.isArray(parsed.claims) ? parsed.claims : [];
        parsedOk = true;
      } catch {
        this.logger.warn("Consultant returned non-JSON output");
      }

      // HARD RULE 2 of the system prompt requires every claim to cite evidence
      // paths, and until now nothing checked them: a claim citing
      // `pos.tables.turnover` on a restaurant with no POS data reached the
      // owner looking exactly as authoritative as a grounded one. Ungrounded
      // claims are dropped, and the drop is recorded rather than silent.
      const evidenceCategories = Object.keys(evidence);
      const grounding = checkGrounding(claims, evidenceCategories);
      if (grounding.dropped.length > 0) {
        this.logger.warn(
          `Consultant (${personaKey}) cited ${grounding.unknownRoots.length} ` +
            `evidence categor(ies) that were never supplied ` +
            `[${grounding.unknownRoots.join(", ")}] — dropped ` +
            `${grounding.dropped.length} of ${claims.length} claim(s)`,
        );
      }
      this.nfVerdicts.record(
        eventRef,
        GROUNDING_BASIS,
        consultantVerdict({ refused: false, parsed: parsedOk, grounding }),
      );

      return {
        enabled: true,
        persona: personaKey,
        model,
        claims: grounding.claims,
        claimsDropped: grounding.dropped.length,
        evidenceCategories,
        disclaimer:
          "Consultant claims are LLM interpretations of deterministic analytics — verify against the cited evidence before acting.",
        generatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      // Preserve the pre-wrapper contract: an HTTP-status failure returns the
      // same `Model API error <status>` payload the old non-OK branch built.
      if (err instanceof ModelClientError && err.status != null) {
        this.logger.error(`Consultant API error ${err.status}: ${err.message}`);
        return { enabled: true, error: `Model API error ${err.status}` };
      }
      this.logger.error(`Consultant call failed: ${err?.message}`);
      return { enabled: true, error: err?.message || "Consultant call failed" };
    }
  }
}
