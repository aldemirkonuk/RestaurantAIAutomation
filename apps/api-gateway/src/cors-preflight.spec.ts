import { Controller, Get, INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { buildCorsOptions, CORS_PREFLIGHT_MAX_AGE_S } from "./cors-origins";

@Controller("probe")
class ProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * Every web call to this gateway is cross-origin with an Authorization header,
 * so it needs a preflight. Without Access-Control-Max-Age a browser reuses the
 * answer for only 5 seconds, and a poll every 60 s pays an OPTIONS before each
 * GET (r17 request walk, 2026-11-13). This boots Nest with the options main.ts
 * passes and asks it the way a browser does.
 */
describe("CORS preflight", () => {
  let app: INestApplication;
  let base: string;
  const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, {
      cors: buildCorsOptions(env),
      logger: false,
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    // fetch keeps its sockets alive; drop them so the worker can exit.
    app.getHttpServer().closeAllConnections?.();
    await app.close();
  });

  const preflight = (origin: string) =>
    fetch(`${base}/probe`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

  it("tells the browser to keep an allowed origin's answer for ten minutes", async () => {
    const res = await preflight("https://mudavym.com");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://mudavym.com",
    );
    expect(res.headers.get("access-control-max-age")).toBe(
      String(CORS_PREFLIGHT_MAX_AGE_S),
    );
    expect(CORS_PREFLIGHT_MAX_AGE_S).toBe(600);
  });

  it("still names no origin it does not allow, cached or not", async () => {
    const res = await preflight("https://evil.example");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
