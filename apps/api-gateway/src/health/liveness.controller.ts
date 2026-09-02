import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

/**
 * Liveness — the one route that answers "did this process come up?"
 *
 * WHY THIS DID NOT EXIST, AND WHY IT HAD TO
 * -----------------------------------------
 * `deploy.yml` has polled `${API_GATEWAY_URL}/health` since it was written, and
 * that URL has never existed. The gateway sets a global `api/v1` prefix, and the
 * only `@Controller("health")` in the tree is the orchestrator proxy, which is
 * `@UseGuards(JwtAuthGuard)` — so `/health` 404s, `/api/v1/health` 404s, and
 * `/api/v1/health/agents` answers 401. There was no unauthenticated URL a deploy
 * check could ask, which is why the check has never actually run.
 *
 * Measured against production on 2026-08-28, before writing this:
 *
 *     GET /health                  -> 404 (from Nest, so the app WAS up)
 *     GET /api/v1/health           -> 404
 *     GET /api/v1/health/agents    -> 401
 *
 * This is the gap that made the post-deploy audit report "Stage 2 — API Gateway:
 * success" while verifying nothing at all.
 *
 * WHAT THIS ROUTE MUST NEVER BECOME
 * ---------------------------------
 * Unauthenticated, deliberately — a liveness probe that needs a token cannot run
 * before anyone has one. This repo's register still carries entries for
 * unauthenticated endpoints that cost money, so the rule here is narrow and
 * absolute: **this handler touches nothing.** No database, no model call, no
 * tenant data, no configuration read that could leak a value. It returns a
 * constant. Anything that would make it interesting is the thing that would make
 * it dangerous.
 *
 * It is still worth exactly what it claims: a 200 from here proves the process
 * started, Nest built the injector, and routing is live — which is precisely the
 * class of failure CI cannot see, because a module that fails to wire up
 * compiles and tests green and only dies at boot.
 *
 * It does NOT prove the database is reachable or that any dependency is healthy.
 * That is a readiness check, it is a different question, and conflating the two
 * is how a liveness probe starts failing for reasons that have nothing to do
 * with whether the process is alive.
 *
 * WHY IT ALSO NAMES ITS BUILD
 * ---------------------------
 * A 200 here proves *a* process is up. It does not say WHICH ONE. On 2026-09-02
 * a merge to main was verified by hand and the honest answer had to stop at
 * "whatever is running is healthy" — because with a constant payload there is no
 * way to tell the newly deployed build from the previous one still serving.
 * `deploy.yml` has the same blind spot: it polls until it sees a 200, and the old
 * instance answers 200 perfectly.
 *
 * So the payload names the build. `commit` is the deployed revision;
 * `bootedAt` is when this process started. Either one answers "is production
 * running what we just merged?" — and `bootedAt` answers it with no platform
 * support at all, which matters because the commit sha depends on an injected
 * variable that may simply not be there.
 *
 * WHEN THE SHA IS ABSENT IT SAYS SO
 * ---------------------------------
 * `commit` is `"unknown"`, never omitted and never invented. A field that
 * disappears when the answer is missing turns "we could not tell" into "nothing
 * to report", which is the fault this route was extended to close, reappearing
 * inside the fix for it. `bootedAt` still works in that case.
 *
 * The sha is not a secret — it identifies a revision of a private repository and
 * discloses nothing without access to it — and it is what a deploy audit has to
 * compare against. Nothing else was added: this handler still touches no
 * database, no tenant data and no configuration that could leak a value.
 */

/**
 * The deployed revision, read once at module load.
 *
 * Railway injects `RAILWAY_GIT_COMMIT_SHA` for services deployed from GitHub;
 * the others are accepted so the same image reports honestly under a different
 * runner. Whether the variable is actually present in this environment is a
 * question the route itself now answers — which is the point of returning
 * "unknown" rather than guessing.
 */
const COMMIT_SHA: string =
  [
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    process.env.SOURCE_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => v.length > 0) ?? "unknown";

/** When this process came up. Set at module load, so it is the boot time. */
const BOOTED_AT: string = new Date().toISOString();
@ApiTags("health")
@Controller("health")
export class LivenessController {
  @Get("live")
  @ApiOperation({
    summary:
      "Liveness probe — the process is up, routing, and says which build it is",
    description:
      'Unauthenticated and dependency-free by design. Proves the process started and Nest resolved its injector; proves nothing about the database. `commit` is the deployed revision, or the literal "unknown" when no build variable is set — never omitted. `bootedAt` is when this process started, and answers "is this the build we just merged?" even when `commit` is unknown.',
  })
  live(): { status: "ok"; commit: string; bootedAt: string } {
    return { status: "ok", commit: COMMIT_SHA, bootedAt: BOOTED_AT };
  }
}
