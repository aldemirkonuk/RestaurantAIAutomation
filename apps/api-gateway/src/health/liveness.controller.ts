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
 */
@ApiTags("health")
@Controller("health")
export class LivenessController {
  @Get("live")
  @ApiOperation({
    summary: "Liveness probe — the process is up and routing",
    description:
      "Unauthenticated and dependency-free by design. Proves the process started and Nest resolved its injector; proves nothing about the database. Returns a constant.",
  })
  live(): { status: "ok" } {
    return { status: "ok" };
  }
}
