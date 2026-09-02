import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The liveness route must say WHICH build is answering.
 *
 * A 200 from a constant payload proves *a* process is up and says nothing about
 * which one. On 2026-09-02 a merge was verified by hand and the honest answer
 * had to stop at "whatever is running is healthy"; `deploy.yml` has the same
 * blind spot, because the previous instance answers 200 perfectly.
 *
 * The module reads its build variable ONCE at load, so each case re-imports it
 * under a fresh environment via `jest.isolateModules`.
 */

function loadController(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "RAILWAY_GIT_COMMIT_SHA",
    "GIT_COMMIT_SHA",
    "SOURCE_COMMIT",
    "VERCEL_GIT_COMMIT_SHA",
  ];
  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  let payload: { status: string; commit: string; bootedAt: string };
  jest.isolateModules(() => {
    // require, not import: the module reads its build variable ONCE at load,
    // so each case needs a fresh evaluation under a different environment.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LivenessController } = require("./liveness.controller");
    payload = new LivenessController().live();
  });
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return payload!;
}

describe("GET /api/v1/health/live names its build", () => {
  it("reports the deployed revision when the platform injects one", () => {
    const out = loadController({
      RAILWAY_GIT_COMMIT_SHA: "934a3e8d11223344556677889900112233445566",
    });
    expect(out.status).toBe("ok");
    expect(out.commit).toBe("934a3e8d11223344556677889900112233445566");
  });

  it('says "unknown" rather than omitting the field when no variable is set', () => {
    // The whole point. A field that disappears when the answer is missing turns
    // "we could not tell" into "nothing to report" — the exact fault this route
    // was extended to close, reappearing inside the fix for it.
    const out = loadController({});
    expect(out).toHaveProperty("commit");
    expect(out.commit).toBe("unknown");
    expect(out.status).toBe("ok");
  });

  it("treats a blank or whitespace-only variable as absent, not as a build id", () => {
    expect(loadController({ RAILWAY_GIT_COMMIT_SHA: "   " }).commit).toBe(
      "unknown",
    );
    expect(loadController({ RAILWAY_GIT_COMMIT_SHA: "" }).commit).toBe(
      "unknown",
    );
  });

  it("falls back through the other runners' variables, in order", () => {
    expect(loadController({ GIT_COMMIT_SHA: "abc123" }).commit).toBe("abc123");
    expect(loadController({ SOURCE_COMMIT: "def456" }).commit).toBe("def456");
    expect(
      loadController({
        RAILWAY_GIT_COMMIT_SHA: "railway-wins",
        GIT_COMMIT_SHA: "loses",
      }).commit,
    ).toBe("railway-wins");
  });

  it("bootedAt answers the question even when the commit is unknown", () => {
    const before = Date.now();
    const out = loadController({});
    const booted = Date.parse(out.bootedAt);
    expect(Number.isNaN(booted)).toBe(false);
    expect(booted).toBeGreaterThanOrEqual(before - 5000);
    expect(out.bootedAt).toBe(new Date(booted).toISOString());
  });

  it("stays dependency-free — the handler reads nothing but its two constants", () => {
    // Unauthenticated route: anything that would make it interesting is the
    // thing that would make it dangerous.
    const src = readFileSync(join(__dirname, "liveness.controller.ts"), "utf8");
    const body = /live\(\):[\s\S]*?\n {2}\}/.exec(src)?.[0] ?? "";
    expect(body).toContain("COMMIT_SHA");
    expect(body).not.toMatch(/await|databaseService|supabase|this\.\w+Service/);
  });
});
