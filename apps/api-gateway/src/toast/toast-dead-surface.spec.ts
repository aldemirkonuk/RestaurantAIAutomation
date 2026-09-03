import { HttpException, HttpStatus } from "@nestjs/common";
import { ToastService } from "./toast.service";
import { ToastController } from "./toast.controller";
import { DatabaseService } from "../database/database.service";
import {
  registeredOrchestratorPrefixes,
  toastServiceOrchestratorCalls,
} from "./orchestrator-routes";

/**
 * The Toast → orchestrator surface: six gateway calls to a router that has
 * NEVER existed.
 *
 * `toast.service.ts` issues six requests to `/api/v1/toast/*`. The orchestrator
 * has never registered that prefix — not today, and not on 2026-04-13 when
 * these calls were first committed (`91b75dd1`), at which point the
 * orchestrator already shipped eight route modules and none of them was Toast.
 * `git log --all -S"/api/v1/toast"` returns no orchestrator commit at all: the
 * router was never built, never renamed, and never removed. The gateway half of
 * this integration was written against a server side that was only ever planned.
 *
 * This file is deliberately separate from `toast.service.spec.ts` because PR
 * #223 (`fix/toast-mock-mode-closed-in-production`) is appending to that file's
 * end; two branches appending to the same EOF conflict for no reason.
 *
 * What is covered here:
 *   1. A ratchet on the dead surface — it may shrink, never grow, and if the
 *      orchestrator ever gains a real `/api/v1/toast` router the ratchet says so.
 *   2. `getStatistics`, the one endpoint PR #223 does not touch and the only one
 *      of the six that is dead in EVERY configuration.
 */

// ---------------------------------------------------------------------------
// 1. Ratchet: the dead surface may shrink, never grow
// ---------------------------------------------------------------------------

// Both readers moved verbatim to ./orchestrator-routes, so the runtime
// derivation in toast-upstream.ts is proven against the SAME parse this
// ratchet uses rather than against a second copy of it — see
// toast-upstream.spec.ts, which asserts the two agree.

/**
 * Frozen as of 2026-09-01. This list is a ratchet: removing an entry (because
 * the surface was retired) is fine, adding one is not. A seventh call should
 * not be able to land quietly the way the first six did.
 *
 * These six stopped being DEAD on 2026-09-03 when PR #236 built the router they
 * address. The ratchet is kept anyway, and the name with it: what it constrains
 * is the SURFACE the gateway asserts against the orchestrator, and that needs a
 * deliberate edit whether the far end answers or not.
 */
const KNOWN_DEAD_TOAST_CALLS = [
  "/api/v1/toast/menus",
  "/api/v1/toast/menus/:param",
  "/api/v1/toast/orders",
  "/api/v1/toast/orders/:param",
  "/api/v1/toast/sales",
  "/api/v1/toast/statistics",
].sort();

describe("Toast → orchestrator surface (ratchet)", () => {
  // FLIPPED 2026-09-03 by PR #236, which built the router. This assertion used
  // to read `not.toContain` and it fired the moment the router landed — which
  // is the ratchet doing precisely the job its header describes ("if the
  // orchestrator ever gains a real /api/v1/toast router the ratchet says so").
  // It is inverted rather than deleted so the surface stays pinned in the other
  // direction: the router existing is now the invariant, and losing it again
  // would be a regression nobody would otherwise notice.
  it("the orchestrator registers the /api/v1/toast router", () => {
    const prefixes = registeredOrchestratorPrefixes();
    expect(prefixes).toContain("/api/v1/toast");
  });

  it("the gateway's dead Toast calls have not grown", () => {
    // If this fails with EXTRA entries, a new call to a non-existent
    // orchestrator route was added — do not add it to the list, remove the call.
    // If it fails with MISSING entries, the surface was retired: shrink the list.
    expect(toastServiceOrchestratorCalls()).toEqual(KNOWN_DEAD_TOAST_CALLS);
  });

  it("every call targets the Toast router, and none has been repointed elsewhere", () => {
    // The second half of this used to assert `false` — that no call reached a
    // live prefix — because none of them did. #236 made the prefix live, so it
    // now asserts `true`.
    //
    // The FIRST half is the part that must not be relaxed, and it is unchanged.
    // It guards the opposite error: someone "fixing" a Toast call by repointing
    // it at a live-but-wrong router, the mistake explicitly rejected when the
    // dead webhook forward was deleted (see toast.service.ts, REMOVED
    // 2026-09-01). A call must still be served by /api/v1/toast specifically,
    // not merely by something that answers.
    const live = registeredOrchestratorPrefixes();
    for (const call of toastServiceOrchestratorCalls()) {
      expect(call.startsWith("/api/v1/toast/")).toBe(true);
      expect(live.some((p) => call.startsWith(p + "/"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. getStatistics: the endpoint PR #223 does not cover
// ---------------------------------------------------------------------------

function serviceWithFailingOrchestrator(status = 404) {
  const configService: any = {
    get: (key: string, fallback?: any) =>
      key === "TOAST_MOCK_MODE" ? true : fallback,
  };
  const cacheService: any = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    invalidateByPattern: async () => 0,
  };
  const service = new ToastService(
    configService,
    cacheService,
    { supabase: {} } as unknown as DatabaseService,
  );
  const err: any = new Error("Request failed with status code 404");
  err.response = { status, data: { message: "Not Found" } };
  (service as any).httpClient = { get: jest.fn().mockRejectedValue(err) };
  return service;
}

/**
 * `getStatistics` is the sharpest of the six and the only one PR #223 leaves
 * alone, because it has no mock-mode branch to close. It ALWAYS calls the
 * orchestrator, the orchestrator ALWAYS 404s, and the catch ALWAYS returns
 * HTTP 200 `{mode, status: "unknown", error}`.
 *
 * That is half-honest. It refuses to invent a number — `status: "unknown"` is
 * genuinely better than a fabricated figure, and ADR 0020's first half is
 * satisfied. But ADR 0020's second half is not: an action that cannot complete
 * must refuse OUT LOUD. A 200 on a permanently dead route tells every
 * health-style caller the surface is reachable, so the endpoint has reported
 * itself up, every single time, since 2026-04-13 without once succeeding.
 */
describe("GET /toast/statistics refuses out loud (ADR 0020)", () => {
  it("throws instead of returning a 200 body", async () => {
    const service = serviceWithFailingOrchestrator();
    await expect(service.getStatistics()).rejects.toThrow();
  });

  it("never resolves with the half-honest {status: 'unknown'} envelope", async () => {
    // Pinned separately from the throw above: a future refactor could keep
    // throwing for 404 but reintroduce the swallow for some other status.
    const service = serviceWithFailingOrchestrator(500);
    await expect(service.getStatistics()).rejects.toBeInstanceOf(HttpException);
  });

  it("answers 501 Not Implemented, not 503 Service Unavailable", async () => {
    // The status code is the whole argument, so it is asserted directly.
    //
    // PR #223 uses 503 for the other five, and it is right there: "Toast is not
    // connected" is a condition the owner can CHANGE — connect Toast and the
    // call works. 503 also carries a retry-later meaning, which is true there.
    //
    // None of that holds here. Connecting Toast would not make this endpoint
    // work, because the missing piece is an orchestrator router that was never
    // written. A 503 would imply a future in which this succeeds — a smaller
    // version of the same fabrication, and one that invites a monitor to retry
    // a route that cannot ever answer. 501 is the honest code: the server does
    // not implement this.
    const service = serviceWithFailingOrchestrator();
    await expect(service.getStatistics()).rejects.toMatchObject({
      status: HttpStatus.NOT_IMPLEMENTED,
    });
  });

  it("says what is actually wrong, not just that something failed", async () => {
    const service = serviceWithFailingOrchestrator();
    await expect(service.getStatistics()).rejects.toThrow(
      /never been implemented/i,
    );
  });
});

/**
 * The controller half. `getStatistics` is the ONLY handler in
 * `toast.controller.ts` whose catch hardcodes 500 instead of forwarding
 * `error.status` — so even a correct 501 from the service would have reached
 * the caller as a generic 500, losing the one piece of information that
 * distinguishes "not built" from "broke just now".
 */
describe("ToastController.getStatistics preserves the service's status", () => {
  function controllerOver(service: any) {
    return new ToastController(service as any);
  }

  it("forwards 501 rather than flattening it to 500", async () => {
    const controller = controllerOver({
      getStatistics: async () => {
        throw new HttpException("nope", HttpStatus.NOT_IMPLEMENTED);
      },
    });
    await expect(controller.getStatistics()).rejects.toMatchObject({
      status: HttpStatus.NOT_IMPLEMENTED,
    });
  });

  it("still defaults to 500 for a non-HTTP error", async () => {
    const controller = controllerOver({
      getStatistics: async () => {
        throw new Error("boom");
      },
    });
    await expect(controller.getStatistics()).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });
});
