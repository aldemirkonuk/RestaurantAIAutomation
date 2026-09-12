import { Controller, Get, Injectable, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { DatabaseService } from "../database/database.service";
import { COMMIT_SHA, BOOTED_AT } from "./build-provenance";

/**
 * Readiness — the route that cannot answer 200 while the process is useless.
 *
 * WHY A SECOND ROUTE, WHEN LIVENESS ALREADY EXISTS
 * ------------------------------------------------
 * `/api/v1/health/live` is dependency-free on purpose (see
 * `liveness.controller.ts`): it proves the process started and Nest is routing,
 * and it must never start failing for a reason that has nothing to do with
 * whether the process is alive, because the platform restarts on it.
 *
 * That design decision is also its ceiling. A 200 from liveness is compatible
 * with: the Supabase client never initialised, the database being unreachable,
 * and every data route in the app returning 500. Nothing in `deploy.yml` asked
 * a deeper question, so "the deploy is healthy" has meant "a process answered a
 * constant".
 *
 * So this is the deeper question, kept deliberately separate:
 *
 *   /health/live   — is this process up?        (platform restart probe)
 *   /health/ready  — can it actually serve?     (deploy audit + load balancer)
 *
 * WHAT IT PROVES, EXACTLY — AND WHAT IT DOES NOT
 * ----------------------------------------------
 * It proves three things, in order, and reports which one failed:
 *
 *   1. `DatabaseService` was resolvable from the injector. This controller takes
 *      it as a constructor dependency, so Nest had to wire it up for this route
 *      to exist at all.
 *   2. `onModuleInit` actually completed — `supabase` is only assigned there, so
 *      an undefined client means the process is up but was never configured.
 *      This is a state liveness reports as "ok".
 *   3. PostgREST answered a HEAD request for a relation that exists in
 *      production, within a bounded timeout. That is a real round trip to the
 *      database, not a config read.
 *
 * It does NOT prove the injector resolved in general. Be precise about this,
 * because overclaiming is the exact fault this route exists to close: NestJS
 * boots with `abortOnError: true`, so a dependency-injection failure kills the
 * process before any route serves — including this one. What a DI failure
 * actually looks like from outside is the PREVIOUS instance still answering 200
 * on both routes, which no health check can distinguish by status code alone.
 * Only the build provenance (`commit`) can, and that is why it is on both
 * payloads and why `scripts/check_deployed_sha.py` compares it.
 *
 * WHY IT IS UNAUTHENTICATED, AND WHAT THAT COST
 * ---------------------------------------------
 * The deploy audit has to be able to call it. Gating it behind a token means it
 * runs only when `E2E_TEST_TOKEN` happens to be set, and a check that silently
 * does not run is the fault being fixed, reappearing inside the fix. (The
 * existing authenticated proxy step in `deploy.yml` has exactly that shape.)
 *
 * Unauthenticated and database-touching is a combination this repo has been
 * burned by, so it is bounded:
 *
 *   - the probe is a HEAD request with no row payload — no tenant data is read,
 *     and none can be returned;
 *   - the answer is memoised for `PROBE_TTL_MS`, so a flood costs at most one
 *     database round trip per window rather than one per request;
 *   - failures are reported from a fixed vocabulary, never by echoing the
 *     driver's error, which can carry the project URL.
 *
 * The memo means a "ready" answer can be up to `PROBE_TTL_MS` old. That bound is
 * stated in the payload as `checkedAt`, so a caller can see the age rather than
 * having to trust it.
 *
 * There is a second bound this route does not own: the global `RateLimitGuard`
 * (`APP_GUARD` in `app.module.ts`) applies its `default` config here — 100
 * requests per 60s per key (`rate-limit.guard.ts:28`), the same ceiling liveness
 * lives under. Combined with the 5s memo that is at most ~12 database round
 * trips a minute from one caller, which is why the memo is enough on its own
 * terms and does not need to be the only defence. The deploy audit polls at 6
 * requests a minute, two orders inside it.
 */

/** How long a probe result stays usable. Stated in the payload as `checkedAt`. */
export const PROBE_TTL_MS = 5000;

/** How long the database probe may take before it is called unreachable. */
export const PROBE_TIMEOUT_MS = 4000;

/**
 * `restaurants` is the probe relation: it exists in production, it is queried by
 * a dozen services already, and `Code queries only relations production has`
 * (schema-parity.yml) keeps that true. A HEAD select returns no rows.
 */
const PROBE_RELATION = "restaurants";

export type ReadinessChecks = {
  /** Whether the injector handed this controller a DatabaseService. */
  injector: "resolved";
  /** Whether onModuleInit ran and left a client behind. */
  supabaseClient: "initialised" | "missing";
  /** Whether a bounded round trip to PostgREST succeeded. */
  database: "reachable" | "unreachable" | "not-probed";
};

export type ReadinessPayload = {
  status: "ready" | "not_ready";
  commit: string;
  bootedAt: string;
  checkedAt: string;
  checks: ReadinessChecks;
  /** Fixed vocabulary. Absent when ready. Never the driver's own message. */
  reason?: string;
};

type Memo = { at: number; payload: ReadinessPayload };

@Injectable()
@ApiTags("health")
@Controller("health")
export class ReadinessController {
  private memo: Memo | null = null;

  constructor(private readonly databaseService: DatabaseService) {}

  // Declared public, not merely left undecorated: the ADR 0096 ratchet exists
  // precisely because those two are runtime-identical, and this route WANTS to
  // be reachable without a token so a deploy audit can call it. Saying so is
  // the whole point.
  @Public()
  @Get("ready")
  @ApiOperation({
    summary: "Readiness probe — the process can actually serve requests",
    description:
      "200 only when the Supabase client was initialised AND a bounded HEAD round trip to the database succeeded; 503 otherwise, naming which of the two failed. Unauthenticated so a deploy audit can call it without a token, and deliberately data-free: the probe is a HEAD request, so no rows are read. `commit`/`bootedAt` are the same build provenance the liveness route reports. The answer is memoised for 5s; `checkedAt` states how old it is.",
  })
  @ApiResponse({ status: 200, description: "Ready to serve." })
  @ApiResponse({
    status: 503,
    description: "Not ready — the payload names which check failed.",
  })
  async ready(@Res({ passthrough: true }) res: Response) {
    const payload = await this.probe();
    res.status(payload.status === "ready" ? 200 : 503);
    return payload;
  }

  /** Memoised probe. Both outcomes are cached, so a failure cannot be flooded away. */
  private async probe(): Promise<ReadinessPayload> {
    const now = Date.now();
    if (this.memo && now - this.memo.at < PROBE_TTL_MS) {
      return this.memo.payload;
    }
    const payload = await this.runChecks();
    this.memo = { at: now, payload };
    return payload;
  }

  private async runChecks(): Promise<ReadinessPayload> {
    const base = {
      commit: COMMIT_SHA,
      bootedAt: BOOTED_AT,
      checkedAt: new Date().toISOString(),
    };

    // 2. onModuleInit assigns `supabase`. Undefined means the process is up and
    //    was never configured — a state liveness reports as "ok".
    const client = this.databaseService.supabase;
    if (!client) {
      return {
        ...base,
        status: "not_ready",
        checks: {
          injector: "resolved",
          supabaseClient: "missing",
          database: "not-probed",
        },
        reason: "supabase client not initialised",
      };
    }

    // 3. A real, bounded round trip. `head: true` returns no rows.
    try {
      const { error } = await client
        .from(PROBE_RELATION)
        .select("id", { head: true })
        .limit(1)
        .abortSignal(AbortSignal.timeout(PROBE_TIMEOUT_MS));
      if (error) {
        return {
          ...base,
          status: "not_ready",
          checks: {
            injector: "resolved",
            supabaseClient: "initialised",
            database: "unreachable",
          },
          // Fixed vocabulary: the driver's message can carry the project URL.
          reason: "database probe rejected",
        };
      }
    } catch {
      return {
        ...base,
        status: "not_ready",
        checks: {
          injector: "resolved",
          supabaseClient: "initialised",
          database: "unreachable",
        },
        reason: "database probe failed or timed out",
      };
    }

    return {
      ...base,
      status: "ready",
      checks: {
        injector: "resolved",
        supabaseClient: "initialised",
        database: "reachable",
      },
    };
  }
}
