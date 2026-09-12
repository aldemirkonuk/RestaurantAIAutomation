import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { allowanceForTier, windowStartIso } from "./spend-tiers";
import { DatabaseService } from "../../database/database.service";
import { getCorrelationId } from "./correlation";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Default per-call timeout. Every site with a load-bearing budget overrides it
 * (photo-count 30s interactive, scan-parser 180s truncation-signal, etc.). */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Transport retry: total attempts (1 initial + 2 retries), jittered backoff. */
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const RETRY_AFTER_CAP_MS = 30_000;

/**
 * model → $/MTok. Deliberately tiny: exactly the models the gateway calls
 * today. An unrecognized model writes cost_usd = NULL (never 0), so a model
 * swap cannot silently write free rows — tokens are still recorded either way.
 * Dated pins (claude-haiku-4-5-20251001) resolve via prefix match.
 */
const MODEL_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  // Added 2026-09-04 with `model-routing.ts`, and NOT optional: the founder's
  // routing decision sends the two `compose` sites to Sonnet 5, and an
  // unrecognised model writes `cost_usd = NULL`. The spend ceiling below sums
  // `cost_usd`, so an unpriced model would have made those calls invisible to
  // the valve that exists to bound them — a model swap silently disarming a
  // safety check. Rate from the Anthropic model table: $2.00 in / $10.00 out.
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
};

/**
 * Spend allowances now live in ./spend-tiers.ts, keyed by restaurants.subscription_tier:
 * core = a $5 CREDIT that depletes (menu upload + trial), plus = $5/day, pro = $10/day.
 * All PLACEHOLDERS — pricing is founder-deferred (OD-23) and no ADR records a price.
 *
 * The ceiling suppresses RETRY attempts by default, and first attempts ONLY where a call
 * site opts in with `gateFirstAttempt`. Gating every first call on a ledger read would add
 * a new failure mode to the seven production paths that predate this client, which the
 * migration contract ("preserve everything except retry/timeout/emission") forbids — so the
 * default is unchanged and those paths are untouched. A retry storm is how transport
 * flakiness turns into surprise spend, which is why the cap bit there first; a caller who
 * can trigger a first call at will is the other way it happens, which is what the opt-in
 * closes (added 2026-09-12 for Ask AI). MODEL_DAILY_SPEND_CEILING_USD still overrides the
 * NUMBER for incident response, never the mode.
 */
const SPEND_CACHE_TTL_MS = 60_000;
/** PostgREST's `max_rows` (supabase/config.toml:18). A response never holds more. */
const SPEND_PAGE_ROWS = 1000;
/** A ceiling on pages read per check, so a runaway ledger cannot stall a call. */
const SPEND_MAX_PAGES = 200;

/**
 * How long until the next 00:00 UTC, in words a person reads. Exported so the
 * refusal's promise is tested against a clock rather than trusted.
 */
export function untilUtcMidnight(now: Date = new Date()): string {
  const next = new Date(now.getTime());
  next.setUTCHours(24, 0, 0, 0);
  const minutes = Math.max(
    1,
    Math.ceil((next.getTime() - now.getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}
const TIER_CACHE_TTL_MS = 300_000;

/**
 * Thrown for transport/HTTP failures of the model call itself. `message` for
 * HTTP errors is `Anthropic <status>: <detail>` — the exact string
 * document-extractor and vendor-page-extractor produced before the migration,
 * so their callers' logs read the same. Emission failures NEVER surface here.
 */
/**
 * Thrown when a call site that opted into `gateFirstAttempt` is over its spend
 * allowance. A SEPARATE type from ModelClientError on purpose: this is not a
 * transport failure and must not be retried, logged as an outage, or reported
 * to an operator as "the model is down". Nothing reached the API, nothing was
 * charged, and the condition clears on its own.
 */
export class ModelSpendCeilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSpendCeilingError";
  }
}

export class ModelClientError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null for network/timeout failures. */
    readonly status: number | null = null,
    /** The API error body's message, when one was readable. */
    readonly apiMessage: string | null = null,
  ) {
    super(message);
    this.name = "ModelClientError";
  }
}

/**
 * A handle on the NF row a call is about to write, for callers that can grade
 * their own work AFTER the fact (OD-59).
 *
 * Why a promise and not a return value: emission is deliberately
 * fire-and-forget (see `emit`), so when `call()` resolves, the insert may not
 * have run yet. Returning the id would mean awaiting the insert on the user
 * path — exactly the coupling the emitter was built to avoid.
 *
 * `id` ALWAYS settles, including when the emit is dropped, in which case it
 * resolves `null`. A verdict writer awaiting a ref that never settled would
 * leak a pending promise per call.
 */
export class NfEventRef {
  private settleFn!: (id: string | null) => void;
  private settled = false;

  /** The row id once written, or null if the emit was dropped. Never rejects. */
  readonly id: Promise<string | null> = new Promise((resolve) => {
    this.settleFn = resolve;
  });

  /** @internal — only ModelClientService settles a ref. */
  settle(id: string | null): void {
    if (this.settled) return; // a second settle must not throw
    this.settled = true;
    this.settleFn(id);
  }
}

export interface NfMeta {
  /**
   * Agent identity in the existing decision_log `agent_name` style —
   * inbound-responder writes `agent_name: "InboundResponder"` and its NF rows
   * must match exactly so the two tables agree on who acted.
   */
  subjectId: string;
  /** context.task_type — the group-by column of the P1 §2 headline query. */
  taskType: string;
  /** What arrived (NOT NULL in the table): "inbound_email", "menu_pdf", ... */
  stimulus: string;
  /**
   * What the call produced (NOT NULL). A string, or a function of the raw
   * response payload for choices that honestly depend on it ("extracted:12").
   * On a failed call the row records "none" — the call produced nothing.
   */
  choice: string | ((payload: any) => string);
  restaurantId?: string | null;
  /** Explicit correlation id (RabbitMQ path). Defaults to the request's ALS id. */
  correlationId?: string | null;
  /** Extra keys merged into the context jsonb (persona, url, chunk index...). */
  context?: Record<string, unknown>;
  /**
   * The registry skill that fired for this call, when one did (ADR 0039 A4).
   * Optional passthrough: no call site sets it today, and a call that is not a
   * skill firing must leave it unset rather than invent a value — the column is
   * nullable forever and NULL there means "not a skill task", never "unknown".
   */
  skillId?: string | null;
  /**
   * Supply a ref to receive this call's NF row id, for sites that grade their
   * own output once it has been parsed (OD-59). Omit it and nothing changes.
   */
  eventRef?: NfEventRef;
}

export interface ModelCallOptions {
  /**
   * Verbatim Messages API body. The client has NO opinion about prompts,
   * models, temperature, thinking, or max_tokens — inbound-responder's
   * temperature and scan-parser's truncation semantics pass through untouched.
   */
  body: Record<string, unknown>;
  nf: NfMeta;
  /** Per-attempt timeout. Override wherever the budget is load-bearing. */
  timeoutMs?: number;
  /** Extra headers merged over the defaults (e.g. anthropic-beta for PDFs). */
  headers?: Record<string, string>;
  /** Transport retry on by default (founder decision); opt out per call. */
  retry?: boolean;
  /**
   * Refuse the FIRST attempt too when the restaurant is over its allowance,
   * not only the retries. Off by default, and that default is load-bearing.
   *
   * The ceiling was built to suppress retry storms, and the migration
   * contract that produced this client ("preserve everything except
   * retry/timeout/emission") forbids adding a new failure mode to the seven
   * production paths that existed before it. Turning the gate on globally
   * would do exactly that: every one of those paths would gain a way to fail
   * that it has never had, on a ledger read, at a moment none of them were
   * written to handle.
   *
   * So it is opt-in, per call site, for the sites where a caller can drive
   * the spend directly — today that is Ask AI, where an authenticated member
   * can loop `POST /ask-ai/propose` and reach the model on every first call.
   * A route a person taps is not the same risk as a background job.
   *
   * The gate still FAILS OPEN on an unreadable ledger, exactly as it does for
   * retries. That is deliberate and it is why this is never the only defence:
   * `RateLimitGuard` bounds the RATE in one process, this bounds the COST
   * across the fleet, and a ledger outage degrades to the first of those
   * rather than to nothing.
   */
  gateFirstAttempt?: boolean;
}

/**
 * ModelClientService — the single choke point for gateway model calls and the
 * NF-A emitter (P1 §5.3, spec .planning/04-specs/P1-EMITTER-ARCHITECTURE.md).
 *
 * Owns: URL, key, headers, per-call timeout, transport-only retry, duration,
 * usage extraction, cost, and the neural_footprint_event insert. Returns the
 * RAW parsed payload — scan-parser reads stop_reason, consultants reads
 * refusal, and any convenience wrapper would break both.
 *
 * FAILURE POSTURE (matches spend_logger.py's "NEVER re-raise"):
 *   - The model call's own transport errors throw to the site exactly as
 *     before — only EMISSION is swallowed.
 *   - The instrument must never break the thing it measures: an emit failure
 *     is a warn + a drop counter, never an exception. The counter is what
 *     keeps "never re-raise" from decaying into silent-forever — sustained
 *     drops are visible in the log with a running total.
 */
@Injectable()
export class ModelClientService {
  private readonly logger = new Logger(ModelClientService.name);

  /** NF rows this process failed to write. Silent gaps must be countable. */
  private nfDropCount = 0;

  /** Per-restaurant-day spend cache so retries do not query per attempt. */
  /** Tier lookups are cached: the allowance rule is per-restaurant, not per-call. */
  private readonly tierCache = new Map<
    string,
    { at: number; tier: string | null }
  >();

  private readonly spendCache = new Map<
    string,
    { at: number; spendUsd: number }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {}

  /** Emission drops since boot — exposed for health/debug surfaces. */
  get droppedEmissions(): number {
    return this.nfDropCount;
  }

  /**
   * Make one Messages API call. One invocation = one NF row (duration spans
   * retries, context.attempts = n) — failed transport attempts are not billed,
   * so per-invocation rows remain an honest cost ledger.
   */
  async call(opts: ModelCallOptions): Promise<any> {
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // Sites keep their own pre-checks (each has a distinct degrade path);
      // this is the backstop for a site that forgot one.
      throw new ModelClientError("ANTHROPIC_API_KEY is not configured");
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retryEnabled = opts.retry !== false;
    const model = String((opts.body as any)?.model ?? "");
    const startedAt = Date.now();

    // Opt-in first-attempt gate. Sites that set `gateFirstAttempt` are the
    // ones a caller can drive directly; for everyone else this is unreachable
    // and the seven pre-existing paths are byte-for-byte unchanged.
    //
    // It throws BEFORE any NF row is emitted, deliberately: nothing was spent,
    // so writing a zero-cost row would put a call in the ledger that never
    // happened and make the ledger disagree with the bill.
    //
    // It counts TODAY's spend (UTC) against the tier's number, whatever the
    // tier's own mode (ADR 0146, founder's answer 2026-09-12). Every house in
    // production is on `pilot`, which resolves to a lifetime credit that never
    // resets, so a lifetime read here made the refusal permanent while its
    // message said it would pass. Reading today only is what makes "it resets
    // at midnight UTC" true.
    if (opts.gateFirstAttempt === true) {
      if (!(await this.allowedBySpendCeiling(opts.nf.restaurantId, "daily"))) {
        throw new ModelSpendCeilingError(
          "This restaurant has used today's AI allowance. " +
            `It resets at midnight UTC, ${untilUtcMidnight()} from now; ` +
            "nothing was charged for this request.",
        );
      }
    }

    let attempts = 0;
    let lastError: ModelClientError | null = null;
    let ceilingSuppressedRetry = false;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      let res: Response;
      try {
        res = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            ...(opts.headers ?? {}),
          },
          body: JSON.stringify(opts.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err: any) {
        const isTimeout =
          err?.name === "TimeoutError" || err?.name === "AbortError";
        lastError = new ModelClientError(
          isTimeout
            ? `Model call timed out after ${timeoutMs}ms`
            : `Model call failed: ${err?.message ?? "network error"}`,
        );
        // A timeout is NOT retried: the per-call timeout is the site's latency
        // budget (photo-count's 30s is a product choice; scan-parser's 180s is
        // load-bearing), and retrying after it multiplies the worst case by
        // the attempt count. Connection-level failures are cheap and retried.
        if (isTimeout || !retryEnabled) break;
        if (!(await this.retryAllowedBySpendCeiling(opts.nf.restaurantId))) {
          ceilingSuppressedRetry = true;
          break;
        }
        if (attempts < MAX_ATTEMPTS) await this.backoff(attempts, null);
        continue;
      }

      if (res.ok) {
        let payload: any;
        try {
          payload = await res.json();
        } catch (err: any) {
          lastError = new ModelClientError(
            `Model call failed: unreadable response body (${err?.message})`,
            res.status,
          );
          break;
        }
        this.emit(opts.nf, {
          model,
          attempts,
          durationMs: Date.now() - startedAt,
          payload,
        });
        return payload;
      }

      // Non-2xx. Read the body once for both the error message and the log.
      const detail = await res.text().catch(() => "");
      const apiMessage = extractApiErrorMessage(detail);
      lastError = new ModelClientError(
        `Anthropic ${res.status}: ${(apiMessage ?? detail).slice(0, 300)}`,
        res.status,
        apiMessage,
      );

      // Transport-only retry: 429 / 529 / 5xx. Never any other 4xx — those
      // are answers about the request, not the transport. Semantic outcomes
      // (refusal, max_tokens) arrive as HTTP 200 and never reach this branch:
      // scan-parser's re-chunking stays its own logic, untouched.
      const retryable =
        res.status === 429 || res.status === 529 || res.status >= 500;
      if (!retryable || !retryEnabled) break;
      if (!(await this.retryAllowedBySpendCeiling(opts.nf.restaurantId))) {
        ceilingSuppressedRetry = true;
        break;
      }
      if (attempts < MAX_ATTEMPTS) {
        await this.backoff(attempts, res.headers.get("retry-after"));
      }
    }

    const error =
      lastError ?? new ModelClientError("Model call failed: unknown error");
    this.emit(opts.nf, {
      model,
      attempts,
      durationMs: Date.now() - startedAt,
      payload: null,
      failure: error,
      ceilingSuppressedRetry,
    });
    throw error;
  }

  // ===========================================================================
  // Emission (fire-and-forget, never throws, drops are counted)
  // ===========================================================================

  private emit(
    nf: NfMeta,
    call: {
      model: string;
      attempts: number;
      durationMs: number;
      payload: any;
      failure?: ModelClientError;
      ceilingSuppressedRetry?: boolean;
    },
  ): void {
    // The `void` convention is enforced HERE rather than at call sites so no
    // site can forget it — emission latency never rides a user path.
    void this.persistNfEvent(nf, call)
      .catch((err: any) => {
        this.nfDropCount++;
        this.logger.warn(
          `neural_footprint_event emit failed (${this.nfDropCount} dropped since boot): ${err?.message ?? err}`,
        );
      })
      // A dropped emit still settles the ref, with null. Without this, a site
      // awaiting `ref.id` to write a verdict would hang forever on exactly the
      // rows that failed — a leak that grows with the failure it is hiding.
      .finally(() => nf.eventRef?.settle(null));
  }

  private async persistNfEvent(
    nf: NfMeta,
    call: {
      model: string;
      attempts: number;
      durationMs: number;
      payload: any;
      failure?: ModelClientError;
      ceilingSuppressedRetry?: boolean;
    },
  ): Promise<void> {
    const { payload, failure } = call;
    const usage = payload?.usage ?? null;
    const stopReason: string | null = payload?.stop_reason ?? null;

    // Call-level outcome, day one (founder decision, stamped call_level_v0 so
    // a future doneability definition can re-grade without archaeology):
    //   failure  — transport/HTTP failure, or an HTTP-200 refusal (the call
    //              completed but produced no artifact; consultants already
    //              treats it as an error path).
    //   partial  — stop_reason max_tokens: the response was truncated by the
    //              output cap. Visible in the payload itself, no semantic
    //              parsing needed — "the clearest partial in the codebase".
    //   success  — everything else. NULL is reserved for genuinely unknown,
    //              which at call level does not occur: we always know how the
    //              call itself ended.
    const outcome: "success" | "failure" | "partial" = failure
      ? "failure"
      : stopReason === "refusal"
        ? "failure"
        : stopReason === "max_tokens"
          ? "partial"
          : "success";

    let choice: string;
    if (failure || payload == null) {
      choice = "none";
    } else if (typeof nf.choice === "function") {
      try {
        choice = String(nf.choice(payload)).slice(0, 200);
      } catch {
        choice = "unlabelled"; // a broken choice fn must not cost the row
      }
    } else {
      choice = nf.choice;
    }

    const inputTokens = intOrNull(usage?.input_tokens);
    const outputTokens = intOrNull(usage?.output_tokens);
    const cacheCreation = intOrNull(usage?.cache_creation_input_tokens) ?? 0;
    const cacheRead = intOrNull(usage?.cache_read_input_tokens) ?? 0;

    const context: Record<string, unknown> = {
      task_type: nf.taskType,
      outcome_basis: "call_level_v0",
      model: call.model || null,
      attempts: call.attempts,
      ...(stopReason ? { stop_reason: stopReason } : {}),
      ...(failure
        ? {
            error: failure.message.slice(0, 300),
            ...(failure.status != null ? { http_status: failure.status } : {}),
          }
        : {}),
      ...(call.ceilingSuppressedRetry
        ? { retry_suppressed_by_spend_ceiling: true }
        : {}),
      ...(cacheCreation || cacheRead
        ? {
            cache_creation_input_tokens: cacheCreation,
            cache_read_input_tokens: cacheRead,
          }
        : {}),
      ...(nf.context ?? {}),
    };

    // `.select("id")` only when a caller asked for the id — an unconditional
    // RETURNING would add a round-trip cost to all 9 emitting sites to serve
    // the one that grades itself.
    const insert = this.databaseService.supabase
      .from("neural_footprint_event")
      .insert({
        subject_type: "agent",
        subject_id: nf.subjectId,
        stimulus: nf.stimulus,
        choice,
        outcome,
        context,
        cost_usd: this.computeCostUsd(
          call.model,
          inputTokens,
          outputTokens,
          cacheCreation,
          cacheRead,
        ),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: Math.round(call.durationMs),
        correlation_id: nf.correlationId ?? getCorrelationId(),
        restaurant_id: nf.restaurantId ?? null,
        // Spread ONLY when set, and that is correctness rather than tidiness:
        // PostgREST rejects the whole row for an unknown column, so writing
        // `skill_id: null` unconditionally would drop every emit in any
        // environment where 20260828103059_nf_skill_id.sql has not landed yet —
        // an optional passthrough taking the instrument down. Omitting the key
        // leaves the column at its NULL default: the same stored row, no risk.
        ...(nf.skillId ? { skill_id: nf.skillId } : {}),
      });

    if (!nf.eventRef) {
      const { error } = await insert;
      if (error) throw new Error(error.message);
      return;
    }

    const { data, error } = await insert.select("id").single();
    if (error) throw new Error(error.message);
    // Settling before the caller's grader runs is the whole point; a row that
    // wrote but returned no id settles null rather than pretending.
    nf.eventRef.settle((data as { id?: string } | null)?.id ?? null);
  }

  /**
   * NULL (never 0) for an unrecognized model or missing usage. Cache tokens
   * use the standard multipliers (write 1.25x, read 0.1x) — no site uses
   * caching today, so this is future-proofing, not live math.
   */
  private computeCostUsd(
    model: string,
    inputTokens: number | null,
    outputTokens: number | null,
    cacheCreation: number,
    cacheRead: number,
  ): number | null {
    if (inputTokens == null || outputTokens == null) return null;
    const pricing = resolvePricing(model);
    if (!pricing) return null;
    const usd =
      (inputTokens * pricing.input +
        cacheCreation * pricing.input * 1.25 +
        cacheRead * pricing.input * 0.1 +
        outputTokens * pricing.output) /
      1_000_000;
    return Math.round(usd * 1_000_000) / 1_000_000; // numeric(10,6)
  }

  // ===========================================================================
  // Retry support
  // ===========================================================================

  private async backoff(
    attempt: number,
    retryAfterHeader: string | null,
  ): Promise<void> {
    let waitMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    waitMs += Math.floor(Math.random() * waitMs); // full jitter, 1x–2x
    const retryAfterSec = Number(retryAfterHeader);
    if (retryAfterHeader && Number.isFinite(retryAfterSec)) {
      waitMs = Math.max(
        waitMs,
        Math.min(retryAfterSec * 1000, RETRY_AFTER_CAP_MS),
      );
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }

  /**
   * True when the restaurant's NF-recorded spend for the current UTC day is
   * under the ceiling. Fails OPEN on a ledger error — the ceiling is a safety
   * valve against retry storms, not an accounting gate, and the instrument
   * must never break the thing it measures. Cached 60s per restaurant so a
   * burst of retries costs one query, matching how spend_tasks.py sums
   * cost_usd rows client-side rather than in SQL.
   */
  private async retryAllowedBySpendCeiling(
    restaurantId?: string | null,
  ): Promise<boolean> {
    return this.allowedBySpendCeiling(restaurantId);
  }

  /**
   * The ceiling read itself, with no opinion about which attempt is asking.
   * `retryAllowedBySpendCeiling` is the retry-path name for it and is kept so
   * the three existing call sites and their tests read unchanged.
   */
  private async allowedBySpendCeiling(
    restaurantId?: string | null,
    window: "tier" | "daily" = "tier",
  ): Promise<boolean> {
    const key = restaurantId ?? "__unattributed__";
    try {
      const allowance = allowanceForTier(await this.tierFor(restaurantId));
      // An explicit env override still wins, so an incident can widen or close the
      // gate without a deploy. It only changes the NUMBER, never the mode.
      const override = Number(
        this.configService.get<string>("MODEL_DAILY_SPEND_CEILING_USD"),
      );
      const limit = Number.isFinite(override) ? override : allowance.limitUsd;
      if (limit <= 0) return true; // 0 or negative disables the gate

      // credit = lifetime sum (it depletes); daily = today only (it resets).
      // The first-attempt gate always asks the daily question (see call()).
      const since = windowStartIso(
        window === "daily" ? "daily" : allowance.mode,
      );
      // One cache entry PER WINDOW. A lifetime sum cached under the same key
      // as today's would answer the other question for up to a minute, and
      // the day's key carries its date, so it rolls over at midnight by itself.
      const cacheKey = `${key}|${since ?? "lifetime"}`;
      const cached = this.spendCache.get(cacheKey);
      let spendUsd: number;
      if (cached && Date.now() - cached.at < SPEND_CACHE_TTL_MS) {
        spendUsd = cached.spendUsd;
      } else {
        const read = await this.sumAgentSpend(restaurantId, since);
        if (read === null) return true;
        spendUsd = read;
        this.spendCache.set(cacheKey, { at: Date.now(), spendUsd });
      }

      if (spendUsd >= limit) {
        this.logger.warn(
          `Spend allowance reached for ${key} [${allowance.label}, ${since ? "since " + since : "lifetime"}] ` +
            `($${spendUsd.toFixed(4)} >= $${limit.toFixed(2)}) — ` +
            (window === "daily"
              ? "first attempt refused"
              : "transport retry suppressed"),
        );
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  /**
   * The restaurant's agent spend since `since` (all time when null), summed
   * over EVERY page. PostgREST caps a response at `max_rows = 1000`
   * (supabase/config.toml:18) and says nothing when it does, so one read
   * undercounts a busy house and admits it past its allowance. Pages are keyset
   * on `id`, so a row written during the read cannot shift an offset and be
   * counted twice; such a row may be missed, which a 60-second cache already
   * tolerates. Returns null when a page cannot be read, so the caller applies
   * its own failure policy instead of a partial sum passing for a whole one.
   * At SPEND_MAX_PAGES it stops and returns what it has, which is a LOWER
   * bound: a house already over is still refused, and the log says it stopped.
   */
  private async sumAgentSpend(
    restaurantId: string | null | undefined,
    since: string | null,
  ): Promise<number | null> {
    let total = 0;
    let after: string | null = null;
    for (let page = 0; page < SPEND_MAX_PAGES; page++) {
      let query = this.databaseService.supabase
        .from("neural_footprint_event")
        .select("id, cost_usd")
        .eq("subject_type", "agent");
      if (since) query = query.gte("occurred_at", since);
      query = restaurantId
        ? query.eq("restaurant_id", restaurantId)
        : query.is("restaurant_id", null);
      if (after) query = query.gt("id", after);
      const { data, error } = await query
        .order("id", { ascending: true })
        .limit(SPEND_PAGE_ROWS);
      if (error) return null;
      const rows = (data ?? []) as Array<{ id: unknown; cost_usd: unknown }>;
      for (const row of rows) total += Number(row.cost_usd) || 0;
      if (rows.length < SPEND_PAGE_ROWS) return total;
      after = String(rows[rows.length - 1].id);
    }
    this.logger.error(
      `Spend read for ${restaurantId ?? "__unattributed__"} stopped at ` +
        `${SPEND_MAX_PAGES} pages; $${total.toFixed(4)} is a lower bound`,
    );
    return total;
  }

  /** Reads restaurants.subscription_tier. Unknown/unreadable resolves to core. */
  private async tierFor(restaurantId?: string | null): Promise<string | null> {
    if (!restaurantId) return null;
    const cached = this.tierCache.get(restaurantId);
    if (cached && Date.now() - cached.at < TIER_CACHE_TTL_MS)
      return cached.tier;
    try {
      const { data, error } = await this.databaseService.supabase
        .from("restaurants")
        .select("subscription_tier")
        .eq("id", restaurantId)
        .maybeSingle();
      const tier = error ? null : ((data as any)?.subscription_tier ?? null);
      this.tierCache.set(restaurantId, { at: Date.now(), tier });
      return tier;
    } catch {
      return null;
    }
  }
}

/**
 * Whether this model would write a real `cost_usd` rather than NULL.
 *
 * Exported so `model-routing.spec.ts` can assert the thing that is easy to get
 * wrong once routing exists: a task class pointed at a model nobody priced
 * still WORKS — the call succeeds, the row is written, the tokens are recorded
 * — and only `cost_usd` is NULL, which sums as nothing, which silently removes
 * those calls from the spend ceiling. A disarmed safety valve that passes every
 * other test is exactly the "absence reported as health" shape.
 */
export function isModelPriced(model: string): boolean {
  return resolvePricing(model) !== null;
}

/** Exact match first, then prefix (dated pins like claude-haiku-4-5-20251001). */
function resolvePricing(
  model: string,
): { input: number; output: number } | null {
  if (!model) return null;
  if (MODEL_PRICING_USD_PER_MTOK[model])
    return MODEL_PRICING_USD_PER_MTOK[model];
  for (const key of Object.keys(MODEL_PRICING_USD_PER_MTOK)) {
    if (model.startsWith(`${key}-`)) return MODEL_PRICING_USD_PER_MTOK[key];
  }
  return null;
}

function extractApiErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message;
    return typeof msg === "string" && msg ? msg : null;
  } catch {
    return null;
  }
}

function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
