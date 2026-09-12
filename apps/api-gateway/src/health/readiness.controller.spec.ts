import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ReadinessController,
  PROBE_TTL_MS,
  type ReadinessPayload,
} from "./readiness.controller";
import type { DatabaseService } from "../database/database.service";

/**
 * Readiness must be UNABLE to answer 200 while the process cannot serve.
 *
 * Liveness answers 200 with the Supabase client never initialised and every data
 * route returning 500 — that is its design, and it is why this route exists. The
 * cases below are the two states liveness reports as "ok".
 */

type Res = { statusCode: number; status: (c: number) => Res };

function res(): Res {
  const r: Res = {
    statusCode: 0,
    status(c: number) {
      r.statusCode = c;
      return r;
    },
  };
  return r;
}

/** A Supabase double whose `.select()` resolves to whatever the test wants. */
function clientReturning(outcome: { error?: unknown } | Error) {
  const terminal = {
    limit: () => terminal,
    abortSignal: () =>
      outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome),
  };
  return {
    from: () => ({ select: () => terminal }),
  };
}

function controllerWith(client: unknown): ReadinessController {
  return new ReadinessController({
    supabase: client,
  } as unknown as DatabaseService);
}

async function ask(
  c: ReadinessController,
): Promise<{ code: number; body: ReadinessPayload }> {
  const r = res();
  const body = (await c.ready(r as never)) as ReadinessPayload;
  return { code: r.statusCode, body };
}

describe("GET /api/v1/health/ready", () => {
  it("is 200 and 'ready' only when the database actually answered", async () => {
    const { code, body } = await ask(controllerWith(clientReturning({})));
    expect(code).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual({
      injector: "resolved",
      supabaseClient: "initialised",
      database: "reachable",
    });
    expect(body.reason).toBeUndefined();
  });

  it("is 503 when onModuleInit never ran — the state liveness calls 'ok'", async () => {
    // DatabaseService assigns `supabase` in onModuleInit. Undefined means the
    // process came up and was never configured; every data route 500s and
    // /health/live returns 200 the whole time.
    const { code, body } = await ask(controllerWith(undefined));
    expect(code).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.checks.supabaseClient).toBe("missing");
    expect(body.checks.database).toBe("not-probed");
    expect(body.reason).toBe("supabase client not initialised");
  });

  it("is 503 when the database rejects the probe", async () => {
    const { code, body } = await ask(
      controllerWith(clientReturning({ error: { message: "boom" } })),
    );
    expect(code).toBe(503);
    expect(body.checks.database).toBe("unreachable");
    expect(body.reason).toBe("database probe rejected");
  });

  it("is 503 when the probe throws or times out", async () => {
    const { code, body } = await ask(
      controllerWith(clientReturning(new Error("AbortError"))),
    );
    expect(code).toBe(503);
    expect(body.checks.database).toBe("unreachable");
    expect(body.reason).toBe("database probe failed or timed out");
  });

  it("never echoes the driver's own error — it can carry the project URL", async () => {
    const secret = "https://abcdefgh.supabase.co/rest/v1/?apikey=leak";
    const { body } = await ask(
      controllerWith(clientReturning({ error: { message: secret } })),
    );
    expect(JSON.stringify(body)).not.toContain("supabase.co");
    expect(JSON.stringify(body)).not.toContain("leak");
  });

  it("carries the same build provenance the liveness route reports", async () => {
    const { body } = await ask(controllerWith(clientReturning({})));
    // The whole point of the endpoint pair: a readiness 200 from the WRONG build
    // is still a failed deploy, so readiness has to name its build too.
    expect(typeof body.commit).toBe("string");
    expect(body.commit.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.bootedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  describe("the memo cannot hide a failure for longer than it claims", () => {
    it("serves a cached answer inside the window, then re-probes", async () => {
      let outcome: { error?: unknown } = {};
      const client = {
        from: () => ({
          select: () => ({
            limit: () => ({ abortSignal: () => Promise.resolve(outcome) }),
          }),
        }),
      };
      const c = controllerWith(client);

      expect((await ask(c)).code).toBe(200);
      outcome = { error: { message: "database went away" } };
      // Inside the window the stale answer is served — and `checkedAt` states
      // its age rather than hiding it.
      expect((await ask(c)).code).toBe(200);

      const realNow = Date.now;
      try {
        // PROBE_TTL_MS + 1: the memo must expire, not merely be old.
        Date.now = () => realNow() + PROBE_TTL_MS + 1;
        const after = await ask(c);
        expect(after.code).toBe(503);
        expect(after.body.checks.database).toBe("unreachable");
      } finally {
        Date.now = realNow;
      }
    });

    it("caches failures too, so a flood cannot amplify into the database", async () => {
      let calls = 0;
      const client = {
        from: () => ({
          select: () => ({
            limit: () => ({
              abortSignal: () => {
                calls += 1;
                return Promise.resolve({ error: { message: "down" } });
              },
            }),
          }),
        }),
      };
      const c = controllerWith(client);
      for (let i = 0; i < 5; i += 1) {
        expect((await ask(c)).code).toBe(503);
      }
      expect(calls).toBe(1);
    });
  });

  it("reads no rows — the probe is a HEAD request", () => {
    // An unauthenticated route that touches the database is only acceptable
    // while it cannot return tenant data. Asserted against the source, because
    // this is a property of the query, not of the response.
    const src = readFileSync(
      join(__dirname, "readiness.controller.ts"),
      "utf8",
    );
    expect(src).toContain("head: true");
    expect(src).not.toMatch(/\.select\((?!"id", \{ head: true \})/);
  });
});
