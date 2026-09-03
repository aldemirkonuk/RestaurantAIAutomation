import { Test } from "@nestjs/testing";
import * as http from "http";
import { AppModule } from "../app.module";

/**
 * Proves both health routes serve at the exact URLs `deploy.yml` polls, under
 * the real `api/v1` prefix — and that the URL the workflow USED to poll still
 * 404s.
 *
 * Two assertions are load-bearing:
 *
 *   - `/health` returning 404 is what made the post-deploy audit meaningless,
 *     and it is kept here so nobody "corrects" the workflow back to it.
 *   - `/health/live` is 200 while `/health/ready` is 503 IN THE SAME BOOTED APP.
 *     That is the entire argument for a second route, demonstrated rather than
 *     asserted: liveness is 200 in a state where the app cannot serve one data
 *     request.
 */
function get(
  port: number,
  path: string,
): Promise<{ code: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ code: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

describe("liveness serves at /api/v1/health/live", () => {
  // A FULL boot, not just a compiled injector. `app.init()` runs every
  // `onModuleInit`, and `DatabaseService` refuses to start without credentials —
  // which is the difference between this and `check_gateway_boots.sh`, and the
  // reason this test needs them.
  //
  // The URL points at a `.invalid` host (RFC 2606 — reserved, cannot resolve) and
  // is set UNCONDITIONALLY, overriding any real local environment. That is load
  // bearing for the readiness assertion below: the point is to boot an app whose
  // database is definitively unreachable and prove that liveness still says 200
  // while readiness says 503. Deferring to a developer's working Supabase would
  // make that assertion pass for the wrong reason on one machine and fail on
  // another.
  const ENV = {
    SUPABASE_URL: "http://readiness-probe.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-a-real-secret",
  };
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("answers 200 there, while the old deploy.yml target still 404s", async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1");
    await app.init();

    const server: http.Server = app.getHttpServer();
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;

    const live = await get(port, "/api/v1/health/live");
    const ready = await get(port, "/api/v1/health/ready");
    const guarded = await get(port, "/api/v1/health/agents");
    const old = await get(port, "/health");
    console.log(
      `  /api/v1/health/live -> ${live.code}  /api/v1/health/ready -> ${ready.code}  /api/v1/health/agents -> ${guarded.code}  /health -> ${old.code}`,
    );

    expect(live.code).toBe(200);
    // `commit` and `bootedAt` were added so a deploy audit can tell the build it
    // just shipped from the one still serving; `commit` is the literal
    // "unknown" when no build variable is set, never omitted.
    const body = JSON.parse(live.body);
    expect(body.status).toBe("ok");
    expect(typeof body.commit).toBe("string");
    expect(body.commit.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.bootedAt))).toBe(false);

    // THE PAIR, IN ONE BOOTED APP. The database is unreachable by construction
    // (`.invalid` above), and this is the whole argument for a second route:
    // liveness answers 200 in exactly the state where the app cannot serve a
    // single data request, and readiness cannot.
    expect(ready.code).toBe(503);
    const readyBody = JSON.parse(ready.body);
    expect(readyBody.status).toBe("not_ready");
    expect(readyBody.checks.database).toBe("unreachable");
    // Readiness names its build too: a 200 from the WRONG build is still a
    // failed deploy.
    expect(readyBody.commit).toBe(body.commit);
    expect(readyBody.bootedAt).toBe(body.bootedAt);

    expect(guarded.code).toBe(401); // still guarded, unchanged
    expect(old.code).toBe(404); // the URL the audit polled for months
    await app.close();
  }, 30000);
});
