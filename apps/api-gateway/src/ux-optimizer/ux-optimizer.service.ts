import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import {
  ModelClientService,
  NfEventRef,
} from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import {
  GROUNDING_BASIS,
  filterProposals,
  uxProposalVerdict,
} from "./ux-proposal-grounding";

/** Most signals read into one friction summary. See summarize() for why it is ordered. */
const SIGNAL_SAMPLE_CAP = 5000;

/**
 * UxOptimizerService — the in-product, self-learning UX agent.
 *
 * Loop:  observe → propose → (human approves) → serve gated override → measure
 *        → learn.  The agent watches real friction telemetry (rage/dead clicks,
 *        abandons, slow time-to-interactive, task failures), reasons over it
 *        against a SOTA usability rubric, and PROPOSES concrete interface
 *        improvements. It never edits the live site on its own.
 *
 * GUARDRAILS (mirroring the procurement "never auto-send" ethos):
 *   • reviewProposal() is the ONLY code path that can put a change in front of a
 *     user, it is reachable only through an authenticated route, and it stamps
 *     the JWT's user id as the reviewer. There is no code path — flagged,
 *     configured, or otherwise — by which the agent approves its own proposal.
 *     (This replaces a former `AUTO_APPLY = false` constant that was referenced
 *     in no conditional and therefore guarded nothing. A guardrail that is not
 *     on the path it claims to guard is worse than none: it gets believed.)
 *   • Approved changes ship behind a rollout percentage + a global kill switch
 *     (UX_OPTIMIZER_ENABLED). Nothing reaches 100% of users implicitly.
 *   • Every override is reversible; every outcome is written to ux_learnings.
 *   • Every read and write is scoped to the caller's restaurant_id, taken from
 *     the token rather than the request.
 *   • The agent may only target `target_key`s the web already knows how to
 *     render — it proposes copy/defaults/surfacing, not arbitrary DOM edits.
 */
@Injectable()
export class UxOptimizerService {
  private readonly logger = new Logger(UxOptimizerService.name);

  /**
   * SOTA usability rubric the agent reasons against. Kept explicit so proposals
   * are auditable and grounded, not vibes.
   */
  private static readonly SOTA_RUBRIC = `SOTA UX rubric (score every proposal against these):
- Hick's law: fewer, clearer choices at each decision point; progressive disclosure over walls of options.
- Fitts's law: primary actions large, close to where the eye already is, hard to miss.
- Recognition over recall: label affordances; never rely on the user remembering hidden shortcuts.
- Feedback & latency budgets: <100ms feels instant, <1s keeps flow, >1s needs a skeleton/optimistic state.
- Doherty threshold: keep interaction under 400ms; if not, show progress and let the user keep moving.
- Error prevention & reversibility: confirm or offer undo on anything destructive; never a dead button.
- Consistency: reuse the product's existing patterns/tokens; no novel chrome for its own sake.
- Accessibility (WCAG 2.2): focus rings, aria-labels, contrast, keyboard parity, reduced-motion respect.
- Content: plain, specific microcopy; one primary CTA per view; empty states that teach the next action.`;

  constructor(
    private readonly dbService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly modelClient: ModelClientService,
    private readonly nfVerdicts: NfVerdictService,
  ) {}

  private enabled(): boolean {
    // Kill switch. Default OFF so the feature ships dark and is opted into.
    return (
      (this.configService.get<string>("UX_OPTIMIZER_ENABLED") || "false") ===
      "true"
    );
  }

  private defaultRollout(): number {
    const v = parseInt(
      this.configService.get<string>("UX_OPTIMIZER_DEFAULT_ROLLOUT") || "10",
      10,
    );
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 10;
  }

  // ==========================================================================
  // 1. Observe — friction telemetry
  // ==========================================================================
  async ingestSignal(input: {
    restaurantId: string;
    page: string;
    event: string;
    targetKey?: string | null;
    value?: number | null;
    sessionId?: string | null;
    meta?: Record<string, unknown>;
  }): Promise<{ ok: boolean }> {
    if (!input?.page || !input?.event)
      throw new Error("page and event are required");
    const { error } = await this.dbService
      .getClient()
      .from("ux_signals")
      .insert({
        restaurant_id: input.restaurantId,
        page: input.page,
        event: input.event,
        target_key: input.targetKey ?? null,
        value: input.value ?? null,
        session_id: input.sessionId ?? null,
        meta: input.meta ?? {},
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  /** Aggregate friction for a page over a trailing window. */
  async summarize(
    page: string,
    restaurantId: string,
    sinceHours = 168,
  ): Promise<{
    page: string;
    windowHours: number;
    totalSignals: number;
    byEvent: Record<string, number>;
    hotspots: Array<{ targetKey: string; event: string; count: number }>;
    avgSlowTtiMs: number | null;
    /** True when the window held more signals than the cap — counts are a floor, not a total. */
    sampleTruncated: boolean;
  }> {
    const sinceIso = new Date(
      Date.now() - sinceHours * 3600 * 1000,
    ).toISOString();
    // .order() before .limit() is load-bearing, not tidiness. This summary is
    // handed to the LLM labelled "authoritative"; without an explicit sort the
    // 5000-row cap returns whatever Postgres happened to scan, so once the table
    // outgrows the cap the agent reasons over an arbitrary slice while believing
    // it has the window. Newest-first at least makes the sample recent and its
    // bias nameable.
    const { data, error } = await this.dbService
      .getClient()
      .from("ux_signals")
      .select("event, target_key, value")
      .eq("page", page)
      .eq("restaurant_id", restaurantId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(SIGNAL_SAMPLE_CAP);
    if (error) throw new Error(error.message);
    const rows = data || [];
    const sampleTruncated = rows.length >= SIGNAL_SAMPLE_CAP;

    const byEvent: Record<string, number> = {};
    const hotspotMap = new Map<string, number>();
    let ttiSum = 0;
    let ttiN = 0;
    for (const r of rows) {
      byEvent[r.event] = (byEvent[r.event] || 0) + 1;
      if (r.target_key) {
        const key = `${r.target_key}|${r.event}`;
        hotspotMap.set(key, (hotspotMap.get(key) || 0) + 1);
      }
      if (r.event === "slow_tti" && r.value != null) {
        ttiSum += Number(r.value);
        ttiN++;
      }
    }
    const hotspots = Array.from(hotspotMap.entries())
      .map(([k, count]) => {
        const [targetKey, event] = k.split("|");
        return { targetKey, event, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      page,
      windowHours: sinceHours,
      totalSignals: rows.length,
      byEvent,
      hotspots,
      avgSlowTtiMs: ttiN ? Math.round(ttiSum / ttiN) : null,
      sampleTruncated,
    };
  }

  // ==========================================================================
  // 2. Propose — grounded in the summary + SOTA rubric (NEVER auto-applied)
  // ==========================================================================
  async generateProposals(
    page: string,
    restaurantId: string,
  ): Promise<{
    enabled: boolean;
    source: "llm" | "heuristic";
    proposals: any[];
    summary: any;
  }> {
    const summary = await this.summarize(page, restaurantId);
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");

    let proposals: Array<{
      kind: string;
      targetKey: string;
      title: string;
      rationale: string;
      change: Record<string, unknown>;
      confidence: number;
    }> = [];
    let source: "llm" | "heuristic" = "heuristic";

    if (apiKey && summary.totalSignals > 0) {
      try {
        proposals = await this.llmProposals(summary, restaurantId);
        source = "llm";
      } catch (err: any) {
        this.logger.warn(`LLM proposals failed, falling back: ${err?.message}`);
        proposals = this.heuristicProposals(summary);
      }
    } else {
      proposals = this.heuristicProposals(summary);
    }

    // Persist as PROPOSED. No side effects on the live product.
    const persisted: any[] = [];
    for (const p of proposals) {
      const { data } = await this.dbService
        .getClient()
        .from("ux_proposals")
        .insert({
          restaurant_id: restaurantId,
          page,
          kind: p.kind,
          target_key: p.targetKey,
          title: p.title,
          rationale: p.rationale,
          change: p.change ?? {},
          evidence: summary,
          confidence: Math.min(1, Math.max(0, p.confidence ?? 0.5)),
          source,
          status: "proposed",
        })
        .select()
        .single();
      if (data) persisted.push(data);
    }

    return { enabled: this.enabled(), source, proposals: persisted, summary };
  }

  private async llmProposals(summary: any, restaurantId: string) {
    const model =
      this.configService.get<string>("UX_OPTIMIZER_MODEL") ||
      "claude-haiku-4-5-20251001";
    const system = `You are a principal product designer optimizing a restaurant wine-ops web app for state-of-the-art usability.

${UxOptimizerService.SOTA_RUBRIC}

ROLE BOUNDARY
- You PROPOSE improvements only. A human reviews and approves each one; you never ship changes yourself.
- You may only propose changes of kind: copy | default | surface | affordance | layout, targeting a stable target_key.
- Ground every proposal in the provided friction summary. Do not invent metrics.
- Prefer the smallest change that removes the most friction. One primary action per proposal.
- Never propose anything destructive, dark-pattern, or that removes undo/confirm.

OUTPUT — respond with ONLY valid JSON:
{"proposals":[{"kind":"copy","targetKey":"...","title":"...","rationale":"...","change":{},"confidence":0.0}]}
Return 2–5 proposals sorted by (confidence × expected friction removed) descending. Each rationale ≤ 2 sentences and must cite a number from the summary.`;

    // OD-59 / P3.0: this call grades itself on grounding. The caller catches
    // a throw here and falls back to heuristics — which is right for the
    // product and used to leave the footprint reading `success` for a call
    // that produced nothing.
    const eventRef = new NfEventRef();
    // P1 NF-A: routed through the model client (emission + timeout + transport
    // retry). Previously this fetch had no timeout at all; the client's 60s
    // default is the consolidation AR-3 asked for.
    const payload: any = await this.modelClient.call({
      body: {
        model,
        max_tokens: 2048,
        system,
        messages: [
          {
            role: "user",
            content: `Friction summary (authoritative; do not contradict):\n${JSON.stringify(summary)}\n\nPropose SOTA usability improvements for page "${summary.page}".`,
          },
        ],
      },
      nf: {
        subjectId: "UxOptimizer",
        taskType: "ux_proposals",
        stimulus: "friction_summary",
        choice: "proposals",
        restaurantId,
        context: { page: summary.page },
        eventRef,
      },
    });
    const textBlock = (payload.content || []).find(
      (b: any) => b.type === "text",
    );

    let arr: unknown[];
    try {
      const parsed = JSON.parse(
        (textBlock?.text || "{}").replace(/^```json\s*|\s*```$/g, ""),
      );
      arr = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    } catch (err) {
      // Record before rethrowing: the caller's catch falls back to heuristics,
      // and without this the footprint would still read `success`.
      this.nfVerdicts.record(
        eventRef,
        GROUNDING_BASIS,
        uxProposalVerdict({ parsed: false, filter: null, rawCount: 0 }),
      );
      throw err;
    }

    // The prompt allows five kinds and the parser used to accept any string, so
    // an invented kind was written straight into `ux_proposals.kind` as though
    // it were real. Dropping it is a behaviour change, and a deliberate one.
    const filter = filterProposals(arr);
    if (filter.droppedKinds.length > 0) {
      this.logger.warn(
        `UX optimizer proposed kind(s) outside the allowed enum ` +
          `[${filter.droppedKinds.join(", ")}] — dropped`,
      );
    }
    this.nfVerdicts.record(
      eventRef,
      GROUNDING_BASIS,
      uxProposalVerdict({ parsed: true, filter, rawCount: arr.length }),
    );

    return filter.kept.slice(0, 5).map((p: any) => ({
      kind: String(p.kind),
      targetKey: String(p.targetKey),
      title: String(p.title),
      rationale: String(p.rationale ?? ""),
      change: p.change && typeof p.change === "object" ? p.change : {},
      confidence: Number(p.confidence ?? 0.5),
    }));
  }

  /** Deterministic fallback so the loop works with zero LLM configuration. */
  private heuristicProposals(summary: any) {
    const out: Array<{
      kind: string;
      targetKey: string;
      title: string;
      rationale: string;
      change: Record<string, unknown>;
      confidence: number;
    }> = [];
    const be = summary.byEvent || {};

    if ((summary.avgSlowTtiMs ?? 0) > 1000) {
      out.push({
        kind: "layout",
        targetKey: `${summary.page}:first-paint`,
        title: "Add a skeleton state to beat the 1s latency budget",
        rationale: `Average time-to-interactive is ${summary.avgSlowTtiMs}ms — past the 1s flow budget; a skeleton keeps perceived performance high.`,
        change: { showSkeleton: true },
        confidence: 0.6,
      });
    }
    for (const h of (summary.hotspots || []).slice(0, 3)) {
      if (h.event === "dead_click") {
        out.push({
          kind: "affordance",
          targetKey: h.targetKey,
          title: `Make "${h.targetKey}" clearly interactive or non-interactive`,
          rationale: `${h.count} dead clicks landed on "${h.targetKey}" — users expect it to do something; clarify the affordance or wire it.`,
          change: { clarifyAffordance: true },
          confidence: 0.55,
        });
      } else if (h.event === "rage_click") {
        out.push({
          kind: "affordance",
          targetKey: h.targetKey,
          title: `Add immediate feedback on "${h.targetKey}"`,
          rationale: `${h.count} rage clicks on "${h.targetKey}" signal missing feedback; add an optimistic/pressed state within 100ms.`,
          change: { instantFeedback: true },
          confidence: 0.55,
        });
      }
    }
    if ((be.abandon ?? 0) > (be.task_success ?? 0)) {
      out.push({
        kind: "surface",
        targetKey: `${summary.page}:primary-cta`,
        title: "Surface the primary action higher / bigger (Fitts)",
        rationale: `Abandons (${be.abandon ?? 0}) exceed task successes (${be.task_success ?? 0}); making the primary CTA more prominent reduces drop-off.`,
        change: { emphasizePrimaryCta: true },
        confidence: 0.5,
      });
    }
    if (out.length === 0) {
      out.push({
        kind: "copy",
        targetKey: `${summary.page}:empty-state`,
        title: "Teach the next action in the empty state",
        rationale: `No strong friction signals yet (${summary.totalSignals} events); a teaching empty state raises first-task success as data accrues.`,
        change: { teachNextAction: true },
        confidence: 0.35,
      });
    }
    return out;
  }

  // ==========================================================================
  // 3. Human review — approve (gated rollout) / reject / rollback
  // ==========================================================================
  async listProposals(restaurantId: string, status?: string, page?: string) {
    let q = this.dbService
      .getClient()
      .from("ux_proposals")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) q = q.eq("status", status);
    if (page) q = q.eq("page", page);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  /**
   * The only path by which anything the agent wrote can reach a user's screen.
   * `reviewedBy` is the authenticated user id supplied by the controller, never
   * a caller-chosen string — an audit trail the caller writes about itself is
   * not an audit trail.
   */
  async reviewProposal(
    proposalId: string,
    decision: "approve" | "reject",
    reviewedBy: string,
    restaurantId: string,
    rolloutPct?: number,
  ) {
    const { data: proposal, error } = await this.dbService
      .getClient()
      .from("ux_proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) throw new NotFoundException("Proposal not found");
    this.assertOwned(proposal.restaurant_id, restaurantId);

    if (decision === "reject") {
      await this.dbService
        .getClient()
        .from("ux_proposals")
        .update({
          status: "rejected",
          reviewed_by: reviewedBy,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", proposalId);
      await this.appendLearning({
        restaurantId: proposal.restaurant_id,
        page: proposal.page,
        targetKey: proposal.target_key,
        proposalId,
        hypothesis: proposal.title,
        outcome: "inconclusive",
        verdict: "revert",
        note: "Rejected at review — not shipped.",
      });
      return { status: "rejected" };
    }

    // Approve → create/enable a gated override. This is the ONLY path that can
    // affect the live product, and it is human-initiated + rollout-limited.
    const rollout =
      rolloutPct != null
        ? Math.min(100, Math.max(0, rolloutPct))
        : this.defaultRollout();
    await this.dbService
      .getClient()
      .from("ux_overrides")
      .upsert(
        {
          restaurant_id: proposal.restaurant_id,
          page: proposal.page,
          target_key: proposal.target_key,
          kind: proposal.kind,
          patch: proposal.change ?? {},
          enabled: true,
          rollout_pct: rollout,
          proposal_id: proposalId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,page,target_key" },
      );
    await this.dbService
      .getClient()
      .from("ux_proposals")
      .update({
        status: "live",
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposalId);
    await this.appendLearning({
      restaurantId: proposal.restaurant_id,
      page: proposal.page,
      targetKey: proposal.target_key,
      proposalId,
      hypothesis: proposal.title,
      verdict: "keep",
      note: `Approved by human review at ${rollout}% rollout.`,
    });
    return { status: "live", rolloutPct: rollout };
  }

  async rollback(proposalId: string, restaurantId: string, reason?: string) {
    const { data: proposal } = await this.dbService
      .getClient()
      .from("ux_proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    if (!proposal) throw new NotFoundException("Proposal not found");
    this.assertOwned(proposal.restaurant_id, restaurantId);
    await this.dbService
      .getClient()
      .from("ux_overrides")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("proposal_id", proposalId);
    await this.dbService
      .getClient()
      .from("ux_proposals")
      .update({ status: "rolled_back", updated_at: new Date().toISOString() })
      .eq("id", proposalId);
    await this.appendLearning({
      restaurantId: proposal.restaurant_id,
      page: proposal.page,
      targetKey: proposal.target_key,
      proposalId,
      hypothesis: proposal.title,
      outcome: "regressed",
      verdict: "revert",
      note: reason || "Rolled back.",
    });
    return { status: "rolled_back" };
  }

  /**
   * Rows in these tables always carry a restaurant_id. A null one means the row
   * predates tenancy or was written by a bug — refuse it rather than treating
   * "belongs to nobody" as "belongs to everybody", which is exactly how the
   * previous override filter leaked across tenants.
   */
  private assertOwned(
    rowRestaurantId: string | null,
    callerRestaurantId: string,
  ) {
    if (!rowRestaurantId || rowRestaurantId !== callerRestaurantId)
      throw new ForbiddenException("Not yours");
  }

  // ==========================================================================
  // 4. Serve — gated runtime overrides the web applies
  // ==========================================================================
  async getActiveOverrides(
    page: string,
    restaurantId: string,
    userId: string,
  ): Promise<{ enabled: boolean; overrides: any[] }> {
    if (!this.enabled()) return { enabled: false, overrides: [] };
    // Tenancy is enforced in the query, not in a post-filter. The previous
    // version fetched every tenant's overrides and then filtered in JS with
    // `o.restaurant_id == null || !restaurantId || ...` — so an absent
    // restaurantId made the second clause true and returned all of them.
    const { data, error } = await this.dbService
      .getClient()
      .from("ux_overrides")
      .select("*")
      .eq("page", page)
      .eq("enabled", true)
      .eq("restaurant_id", restaurantId);
    if (error) throw new Error(error.message);
    const bucket = this.rolloutBucket(userId);
    const overrides = (data || [])
      .filter((o) => bucket < (o.rollout_pct ?? 0))
      .map((o) => ({
        targetKey: o.target_key,
        kind: o.kind,
        patch: o.patch,
        rolloutPct: o.rollout_pct,
      }));
    return { enabled: true, overrides };
  }

  /**
   * Stable 0..99 bucket, keyed on the USER rather than a browser session.
   * Session-keyed bucketing put the same human in different buckets in
   * different tabs — the UI would visibly disagree with itself, and any
   * measurement taken across those sessions would be comparing a person to
   * themselves. There is deliberately no random fallback: an unidentifiable
   * caller gets bucket 100, which is outside every rollout percentage, so the
   * failure mode is "sees the product as built" rather than "sees a coin flip".
   */
  private rolloutBucket(userId?: string): number {
    if (!userId) return 100;
    let h = 0;
    for (let i = 0; i < userId.length; i++)
      h = (h * 31 + userId.charCodeAt(i)) >>> 0;
    return h % 100;
  }

  // ==========================================================================
  // 5. Learn — append-only ledger the agent re-reads each cycle
  // ==========================================================================
  async appendLearning(input: {
    restaurantId?: string | null;
    page?: string;
    targetKey?: string;
    proposalId?: string;
    hypothesis: string;
    outcome?: string;
    metric?: string;
    baseline?: number;
    observed?: number;
    liftPct?: number;
    verdict?: string;
    note?: string;
  }) {
    const { error } = await this.dbService
      .getClient()
      .from("ux_learnings")
      .insert({
        restaurant_id: input.restaurantId ?? null,
        page: input.page ?? null,
        target_key: input.targetKey ?? null,
        proposal_id: input.proposalId ?? null,
        hypothesis: input.hypothesis,
        outcome: input.outcome ?? null,
        metric: input.metric ?? null,
        baseline: input.baseline ?? null,
        observed: input.observed ?? null,
        lift_pct: input.liftPct ?? null,
        verdict: input.verdict ?? null,
        note: input.note ?? null,
      });
    if (error) this.logger.warn(`appendLearning failed: ${error.message}`);
    return { ok: !error };
  }

  async listLearnings(restaurantId: string, page?: string, limit = 100) {
    let q = this.dbService
      .getClient()
      .from("ux_learnings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (page) q = q.eq("page", page);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  /**
   * Close the loop: compare friction on a target since an override went live vs
   * the prior window, write the verdict, and auto-rollback clear regressions.
   * Still human-gated for promotion; only regressions are auto-reverted (safe).
   */
  async evaluateOverride(overrideId: string, metric = "rage_click") {
    const { data: ov } = await this.dbService
      .getClient()
      .from("ux_overrides")
      .select("*")
      .eq("id", overrideId)
      .single();
    if (!ov) throw new Error("Override not found");
    const now = summarizeWindowBounds();
    const [before, after] = await Promise.all([
      this.countEvents(
        ov.restaurant_id,
        ov.page,
        ov.target_key,
        metric,
        now.prevStart,
        now.midpoint,
      ),
      this.countEvents(
        ov.restaurant_id,
        ov.page,
        ov.target_key,
        metric,
        now.midpoint,
        now.end,
      ),
    ]);

    // A zero baseline is not evidence of "no change" — it is absence of
    // evidence, and the two must not collapse to the same verdict. Previously
    // before === 0 scored 0% lift and read as "neutral" -> keep, so a change
    // that introduced brand-new friction where there had been none was recorded
    // as harmless. Say "unknown" and leave it alone instead.
    const measurable = before > 0 || after > 0;
    const liftPct = before === 0 ? null : ((after - before) / before) * 100;
    const outcome = !measurable
      ? "no_data"
      : liftPct == null
        ? "new_friction"
        : liftPct < -10
          ? "improved"
          : liftPct > 10
            ? "regressed"
            : "neutral";
    // Only revert on a measured regression. New friction is flagged for a human
    // rather than auto-reverted: at this sample size one noisy day would
    // otherwise be enough to pull a change nobody complained about.
    const verdict =
      outcome === "regressed"
        ? "revert"
        : outcome === "new_friction"
          ? "review"
          : "keep";
    if (verdict === "revert" && ov.proposal_id)
      await this.rollback(
        ov.proposal_id,
        ov.restaurant_id,
        `Auto-revert: ${metric} +${(liftPct ?? 0).toFixed(0)}%`,
      );
    await this.appendLearning({
      restaurantId: ov.restaurant_id,
      page: ov.page,
      targetKey: ov.target_key,
      proposalId: ov.proposal_id,
      hypothesis: `Override on ${ov.target_key} reduces ${metric}`,
      outcome,
      metric,
      baseline: before,
      observed: after,
      liftPct: liftPct ?? undefined,
      verdict,
    });
    return { outcome, liftPct, verdict };
  }

  /**
   * The caller evaluateOverride never had. Without this the measure-and-learn
   * half of the loop was unreachable code: overrides shipped and were never
   * scored, so ux_learnings only ever recorded that a human clicked approve.
   * Runs nightly, off-peak, and only when the feature is switched on.
   */
  @Cron("17 4 * * *", { name: "ux-optimizer-evaluate" })
  async evaluateLiveOverrides(): Promise<void> {
    if (!this.enabled()) return;
    const { data, error } = await this.dbService
      .getClient()
      .from("ux_overrides")
      .select("id")
      .eq("enabled", true);
    if (error) {
      this.logger.warn(
        `evaluate sweep failed to list overrides: ${error.message}`,
      );
      return;
    }
    for (const ov of data || []) {
      try {
        await this.evaluateOverride(ov.id);
      } catch (err: any) {
        this.logger.warn(`evaluateOverride(${ov.id}) failed: ${err?.message}`);
      }
    }
  }

  private async countEvents(
    restaurantId: string,
    page: string,
    targetKey: string,
    event: string,
    fromIso: string,
    toIso: string,
  ): Promise<number> {
    const { count } = await this.dbService
      .getClient()
      .from("ux_signals")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("page", page)
      .eq("target_key", targetKey)
      .eq("event", event)
      .gte("created_at", fromIso)
      .lt("created_at", toIso);
    return count ?? 0;
  }
}

function summarizeWindowBounds() {
  const end = Date.now();
  const midpoint = end - 7 * 24 * 3600 * 1000;
  const prevStart = end - 14 * 24 * 3600 * 1000;
  return {
    end: new Date(end).toISOString(),
    midpoint: new Date(midpoint).toISOString(),
    prevStart: new Date(prevStart).toISOString(),
  };
}
