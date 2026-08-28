import { LivenessController } from "./liveness.controller";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";

/**
 * The liveness probe, held to the two properties that make it worth having.
 *
 * It exists because `deploy.yml` polled a URL that never resolved, so the
 * post-deploy audit reported "Stage 2 — API Gateway: success" for every deploy
 * this repo has ever made while checking nothing. A probe that is wrong in the
 * other direction — one that can fail for reasons unrelated to whether the
 * process is up — would be just as useless, so:
 */
describe("LivenessController", () => {
  it("returns a constant and touches nothing", () => {
    // No constructor parameters at all. This is the assertion that keeps it
    // dependency-free: the moment someone injects a service here, the probe can
    // fail for reasons that have nothing to do with the process being alive,
    // and a liveness check that reports readiness is a liveness check that
    // pages you at 3am about a slow database.
    expect(LivenessController.length).toBe(0);
    expect(new LivenessController().live()).toEqual({ status: "ok" });
  });

  it("is registered on the real AppModule, not just exported", () => {
    // The controller compiling is not the same as it being reachable. This
    // resolves the ACTUAL application module, which is also the boot check --
    // if the DI graph cannot be built, this fails here rather than in
    // production, which is the whole class of failure CI otherwise cannot see.
    return Test.createTestingModule({ imports: [AppModule] })
      .compile()
      .then((mod) => {
        expect(mod.get(LivenessController)).toBeInstanceOf(LivenessController);
        return mod.close();
      });
  });
});
