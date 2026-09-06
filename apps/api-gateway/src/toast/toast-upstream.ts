import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * ONE derivation of the failure status for the Toast → orchestrator seam.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * `toast.service.ts` makes six calls to `/api/v1/toast/*` on the agent
 * orchestrator. That router has never existed (PR #230 established this from
 * the live `APIRouter(prefix=…)` declarations; the ratchet in
 * `toast-dead-surface.spec.ts` keeps it established). A sibling service change
 * is building it now.
 *
 * Before this file, the failure status was written out per method:
 *   - PR #230 hardcoded 501 in `getStatistics`'s catch;
 *   - the other five forwarded `error.response?.status`, so the orchestrator's
 *     bare 404 leaked to the caller as "not found" — a menu that was never
 *     built and a menu that does not exist became the same answer.
 * Six sites, six things to remember on the day the router lands, and the
 * failure mode of forgetting one is silent: a 501 that outlives the condition
 * it described tells a monitor to stop retrying a route that now works.
 *
 * ── The distinction, kept ────────────────────────────────────────────────────
 *   501 Not Implemented   the orchestrator has no such route. Not fixable by
 *                         the owner, and not fixable by waiting — so a retry
 *                         loop must stop.
 *   503 Service Unavailable  the route exists but the call could not be served
 *                         — Toast is not connected, or the orchestrator did not
 *                         answer. Fixable, and worth retrying.
 * These say genuinely different things, so the distinction is kept. What
 * changes is that it is DERIVED, once, from what the orchestrator actually
 * answers — never declared.
 *
 * ── How the derivation works ─────────────────────────────────────────────────
 * The gateway ships as its own image and cannot read the orchestrator's Python
 * at runtime, so the source of truth at runtime is the orchestrator's own
 * answers:
 *
 *   - No response at all (ECONNREFUSED, timeout) → 503. We never reached it, so
 *     we know nothing about its routes and must not claim it lacks one.
 *   - 404 on a path with no resource id (`/menus`, `/orders`, `/sales`,
 *     `/statistics`) → the router is absent. Starlette 404s every path it does
 *     not route, and a collection endpoint that exists does not 404. → 501.
 *   - 404 on an id-addressed path (`/menus/:param`, `/orders/:param`) → could be
 *     a missing router OR a missing record. Resolved by one confirming request
 *     to a collection path, memoised. Evidence, not assumption.
 *   - Anything else the orchestrator said, it said from a real handler → it is
 *     forwarded verbatim. In particular, when the sibling's router answers 503
 *     "Toast is not connected", the gateway surfaces 503 — the party that knows
 *     names the condition, and the gateway does not second-guess it.
 *
 * The memoised verdict expires (`ttlMs`), so a router that lands mid-process is
 * picked up without a redeploy: the 501s stop on their own, and no edit is
 * needed here or at any of the six call sites.
 *
 * ADR 0020 (no fabricated answers, LOCKED) governs the whole file: every branch
 * below returns a refusal to throw. None of them returns a body.
 */

/** The prefix every Toast data call targets on the orchestrator. */
export const TOAST_ORCHESTRATOR_PREFIX = "/api/v1/toast";

/**
 * The six routes, in the ratchet's normal form — id segments written `:param`
 * exactly as `toast-dead-surface.spec.ts` normalises `${…}`. Written this way so
 * the two lists can be compared directly (`toast-upstream.spec.ts` asserts they
 * are equal), which is what stops this table and the real call sites drifting.
 */
export const TOAST_UPSTREAM_ROUTES = {
  menus: "/api/v1/toast/menus",
  menu: "/api/v1/toast/menus/:param",
  createOrder: "/api/v1/toast/orders",
  order: "/api/v1/toast/orders/:param",
  sales: "/api/v1/toast/sales",
  statistics: "/api/v1/toast/statistics",
} as const;

/** What we know about the orchestrator's Toast router right now. */
export type ToastRouterState = "registered" | "absent" | "unknown";

/** The single method this needs from the service's axios instance. */
export interface UpstreamGet {
  get(url: string, config?: any): Promise<any>;
}

export interface UpstreamLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface UpstreamFailure {
  /** One of `TOAST_UPSTREAM_ROUTES`. */
  route: string;
  /**
   * What the caller was trying to do, in the voice the surface already uses.
   * Becomes the stem of every message so the existing wording is preserved
   * whichever branch fires.
   */
  summary: string;
  /** The rejection from axios. */
  error: any;
}

/** `/menus/:param` can 404 for two reasons; `/menus` can only 404 for one. */
function isIdAddressed(route: string): boolean {
  return route.includes("/:");
}

export class ToastUpstream {
  private verdict: { state: "registered" | "absent"; at: number } | null = null;

  constructor(
    private readonly http: UpstreamGet,
    private readonly logger: UpstreamLogger,
    /**
     * How long a verdict is trusted. Short enough that the router landing is
     * noticed within a minute without a restart; long enough that a dead
     * surface under load does not issue a confirming request per call.
     */
    private readonly ttlMs: number = 60_000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** The memoised verdict, or `unknown` once it has expired. */
  routerState(): ToastRouterState {
    if (!this.verdict) return "unknown";
    if (this.clock() - this.verdict.at > this.ttlMs) return "unknown";
    return this.verdict.state;
  }

  private record(state: "registered" | "absent"): void {
    const previous = this.routerState();
    this.verdict = { state, at: this.clock() };
    if (previous !== state && previous !== "unknown") {
      this.logger.warn(
        `Toast orchestrator router went from "${previous}" to "${state}" — ` +
          `refusal statuses for ${TOAST_ORCHESTRATOR_PREFIX}/* now follow the new state.`,
      );
    }
  }

  /**
   * Learn from any answer, including the one that just failed. Only two things
   * count as evidence, and neither is an assumption:
   *   - a 404 on a collection path: nothing routes that prefix;
   *   - any non-404 status: a real handler produced it, so the prefix routes.
   */
  observe(route: string, status: number | undefined): void {
    if (status === undefined) return;
    if (status === 404) {
      if (!isIdAddressed(route)) this.record("absent");
      return;
    }
    this.record("registered");
  }

  /**
   * Turn a failed upstream call into the refusal the caller should see.
   *
   * Always throws-worthy, never a body — the whole point of ADR 0020 here is
   * that a dead or unconfigured integration is said out loud rather than
   * rendered as emptiness.
   */
  async describe({
    route,
    summary,
    error,
  }: UpstreamFailure): Promise<HttpException> {
    const status: number | undefined = error?.response?.status;
    this.observe(route, status);

    // 1. Nothing answered. We never reached the orchestrator, so we have no
    //    evidence about its routes and must not claim it lacks one.
    if (status === undefined) {
      const cause = error?.code || error?.message || "no response";
      this.logger.error(
        `${route}: the agent orchestrator did not answer (${cause}) — refusing rather than substituting data`,
      );
      return new HttpException(
        `${summary}: the agent orchestrator did not answer (${cause}). ` +
          `Nothing is being shown in its place.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 2. A 404 is the one status that can mean "this route was never built".
    if (status === 404 && (await this.resolveRouterState(route)) === "absent") {
      this.logger.error(
        `${route} has never been implemented on the agent orchestrator — answering 501`,
      );
      return new HttpException(
        `${summary}: ${route} has never been implemented on the agent ` +
          `orchestrator, so this endpoint cannot answer and retrying will not help.`,
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    // 3. The orchestrator answered from a real handler. It knows more about the
    //    condition than this gateway does, so its status is forwarded verbatim —
    //    including the 503 it will raise once the router exists but Toast is not
    //    connected for the restaurant.
    this.logger.error(
      `${route}: upstream answered ${status} — forwarding it unchanged`,
    );
    return new HttpException(error?.response?.data?.message || summary, status);
  }

  /**
   * Is the router absent? Answered from evidence only.
   *
   * A collection-path 404 has already been recorded by `observe`. An
   * id-addressed 404 is ambiguous, so it costs exactly one confirming request
   * to a collection path — and if that request cannot be made, the answer stays
   * `unknown` and no "never built" claim is made.
   */
  private async resolveRouterState(route: string): Promise<ToastRouterState> {
    const known = this.routerState();
    if (known !== "unknown") return known;
    if (!isIdAddressed(route)) return "absent";

    try {
      await this.http.get(TOAST_UPSTREAM_ROUTES.menus);
      this.record("registered");
      return "registered";
    } catch (probeError: any) {
      const probeStatus: number | undefined = probeError?.response?.status;
      if (probeStatus === undefined) {
        // Could not check. A guard that cannot check does not get to conclude.
        this.logger.warn(
          `Could not confirm whether ${TOAST_ORCHESTRATOR_PREFIX} is routed ` +
            `(${probeError?.code || probeError?.message}); forwarding the upstream 404 unchanged.`,
        );
        return "unknown";
      }
      if (probeStatus === 404) {
        this.record("absent");
        return "absent";
      }
      this.record("registered");
      return "registered";
    }
  }
}
