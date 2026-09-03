import * as fs from "fs";
import * as path from "path";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ToastService } from "./toast.service";
import { ToastController } from "./toast.controller";
import { DatabaseService } from "../database/database.service";

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

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ORCHESTRATOR_API_DIR = path.join(
  REPO_ROOT,
  "services/agent-orchestrator/api",
);
const TOAST_SERVICE_SRC = path.join(__dirname, "toast.service.ts");

/**
 * Every `/api/v1/...` prefix the orchestrator actually serves, read from the
 * live `APIRouter(prefix=...)` declarations rather than from a list copied into
 * a comment — a copied list is exactly what rots.
 */
function registeredOrchestratorPrefixes(): string[] {
  // Per the repo's guard rule: a guard that cannot check must fail loudly, not
  // pass by default. A missing orchestrator tree means this test is blind.
  if (!fs.existsSync(ORCHESTRATOR_API_DIR)) {
    throw new Error(
      `Cannot verify orchestrator routes: ${ORCHESTRATOR_API_DIR} does not exist. ` +
        `This guard fails rather than silently passing.`,
    );
  }

  const prefixes: string[] = [];
  for (const file of fs.readdirSync(ORCHESTRATOR_API_DIR)) {
    if (!file.endsWith(".py")) continue;
    const src = fs.readFileSync(
      path.join(ORCHESTRATOR_API_DIR, file),
      "utf8",
    );
    for (const m of src.matchAll(/APIRouter\(\s*prefix\s*=\s*["']([^"']+)["']/g)) {
      prefixes.push(m[1]);
    }
  }

  // Sanity: if the parse returns nothing the regex has rotted, and a green
  // result below would be meaningless.
  if (prefixes.length === 0) {
    throw new Error(
      "Parsed zero APIRouter prefixes from the orchestrator — the guard's " +
        "regex no longer matches the source it checks.",
    );
  }
  return prefixes;
}

/**
 * Strip comments before matching. `toast.service.ts` documents the deleted
 * webhook forward in a long block comment that quotes `/api/v1/toast/webhooks/
 * {type}` and `/api/v1/pos/webhook/toast` — a guard that counts those is
 * measuring prose, not code, and would fire on a doc edit while missing a real
 * new call added in a line that happens to sit inside a comment run.
 *
 * Only `/* *\/` blocks and whole-line `//` comments are removed; a naive `//`
 * strip would also eat the `//` inside any `https://` string literal.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Every orchestrator path `toast.service.ts` calls, template vars normalised. */
function toastServiceOrchestratorCalls(): string[] {
  const src = stripComments(fs.readFileSync(TOAST_SERVICE_SRC, "utf8"));
  const found = new Set<string>();
  for (const m of src.matchAll(/["'`](\/api\/v1\/[^"'`\s]*)["'`]/g)) {
    found.add(m[1].replace(/\$\{[^}]+\}/g, ":param"));
  }
  return [...found].sort();
}

/**
 * Frozen as of 2026-09-01. This list is a ratchet: removing an entry (because
 * the surface was retired) is fine, adding one is not. A seventh call to a
 * router that does not exist should not be able to land quietly the way the
 * first six did.
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
  it("the orchestrator still registers no /api/v1/toast router", () => {
    const prefixes = registeredOrchestratorPrefixes();
    expect(prefixes).not.toContain("/api/v1/toast");
    expect(prefixes.filter((p) => p.startsWith("/api/v1/toast"))).toEqual([]);
  });

  it("the gateway's dead Toast calls have not grown", () => {
    // If this fails with EXTRA entries, a new call to a non-existent
    // orchestrator route was added — do not add it to the list, remove the call.
    // If it fails with MISSING entries, the surface was retired: shrink the list.
    expect(toastServiceOrchestratorCalls()).toEqual(KNOWN_DEAD_TOAST_CALLS);
  });

  it("every dead call targets the unregistered prefix, and none targets a live one", () => {
    // Guards against the opposite error: someone "fixing" this by repointing a
    // call at a live-but-wrong router (the mistake explicitly rejected when the
    // dead webhook forward was deleted — see toast.service.ts, REMOVED 2026-09-01).
    const live = registeredOrchestratorPrefixes();
    for (const call of toastServiceOrchestratorCalls()) {
      expect(call.startsWith("/api/v1/toast/")).toBe(true);
      expect(live.some((p) => call.startsWith(p + "/"))).toBe(false);
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
