import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
};

/**
 * Per-restaurant DAILY spend ceiling (USD) gating RETRIES only.
 *
 * Mirrors the constant-threshold cap pattern of MONTHLY_CAP_THRESHOLDS in
 * services/agent-orchestrator/jobs/spend_tasks.py:24-27, scoped per restaurant
 * and per UTC day because the gateway attributes spend per tenant. The ceiling
 * suppresses RETRY attempts, never first attempts: gating the first call on a
 * ledger read would add a new failure mode to seven production paths, which
 * the migration contract ("preserve everything except retry/timeout/emission")
 * forbids. A retry storm is exactly the mechanism by which transport flakiness
 * turns into surprise spend, so that is where the cap bites.
 */
const DAILY_SPEND_CEILING_USD_DEFAULT = 5.0;
const SPEND_CACHE_TTL_MS = 60_000;

/**
 * Thrown for transport/HTTP failures of the model call itself. `message` for
 * HTTP errors is `Anthropic <status>: <detail>` — the exact string
 * document-extractor and vendor-page-extractor produced before the migration,
 * so their callers' logs read the same. Emission failures NEVER surface here.
 */
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
    void this.persistNfEvent(nf, call).catch((err: any) => {
      this.nfDropCount++;
      this.logger.warn(
        `neural_footprint_event emit failed (${this.nfDropCount} dropped since boot): ${err?.message ?? err}`,
      );
    });
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

    const { error } = await this.databaseService.supabase
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
      });
    if (error) throw new Error(error.message);
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
      waitMs = Math.max(waitMs, Math.min(retryAfterSec * 1000, RETRY_AFTER_CAP_MS));
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
    const ceiling = this.dailyCeilingUsd();
    if (ceiling <= 0) return true; // 0 or negative disables the gate
    const key = restaurantId ?? "__unattributed__";
    try {
      const cached = this.spendCache.get(key);
      let spendUsd: number;
      if (cached && Date.now() - cached.at < SPEND_CACHE_TTL_MS) {
        spendUsd = cached.spendUsd;
      } else {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        let query = this.databaseService.supabase
          .from("neural_footprint_event")
          .select("cost_usd")
          .eq("subject_type", "agent")
          .gte("occurred_at", dayStart.toISOString());
        query = restaurantId
          ? query.eq("restaurant_id", restaurantId)
          : query.is("restaurant_id", null);
        const { data, error } = await query;
        if (error) return true;
        spendUsd = (data ?? []).reduce(
          (sum: number, row: any) => sum + (Number(row.cost_usd) || 0),
          0,
        );
        this.spendCache.set(key, { at: Date.now(), spendUsd });
      }
      if (spendUsd >= ceiling) {
        this.logger.warn(
          `Daily spend ceiling reached for ${key} ` +
            `($${spendUsd.toFixed(4)} >= $${ceiling.toFixed(2)}) — transport retry suppressed`,
        );
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private dailyCeilingUsd(): number {
    const raw = this.configService.get<string>("MODEL_DAILY_SPEND_CEILING_USD");
    const parsed = Number(raw);
    return raw != null && Number.isFinite(parsed)
      ? parsed
      : DAILY_SPEND_CEILING_USD_DEFAULT;
  }
}

/** Exact match first, then prefix (dated pins like claude-haiku-4-5-20251001). */
function resolvePricing(
  model: string,
): { input: number; output: number } | null {
  if (!model) return null;
  if (MODEL_PRICING_USD_PER_MTOK[model]) return MODEL_PRICING_USD_PER_MTOK[model];
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
