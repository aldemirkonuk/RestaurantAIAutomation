import { Test } from "@nestjs/testing";
import * as http from "http";
import { AppModule } from "../app.module";

/**
 * Proves the route serves at the exact URL `deploy.yml` polls, under the real
 * `api/v1` prefix — and that the URL the workflow USED to poll still 404s.
 *
 * The second assertion is the load-bearing one. `/health` returning 404 is what
 * made the post-deploy audit meaningless, and it is kept here so nobody
 * "corrects" the workflow back to it.
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
  // reason this test needs them. They are placeholders: the liveness route
  // touches nothing, so no request here reaches the client they build.
  const ENV = {
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-a-real-secret",
  };
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = process.env[k] || v;
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
    const guarded = await get(port, "/api/v1/health/agents");
    const old = await get(port, "/health");
    console.log(
      `  /api/v1/health/live -> ${live.code}  /api/v1/health/agents -> ${guarded.code}  /health -> ${old.code}`,
    );

    expect(live.code).toBe(200);
    expect(JSON.parse(live.body)).toEqual({ status: "ok" });
    expect(guarded.code).toBe(401); // still guarded, unchanged
    expect(old.code).toBe(404); // the URL the audit polled for months
    await app.close();
  }, 30000);
});
