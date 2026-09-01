import { isOriginAllowed, PRODUCTION_ORIGINS } from "./cors-origins";

/**
 * 2026-09-01: `mudavym.com` became the production domain and matched no entry
 * in the CORS allow-list. The browser got a preflight with no
 * `access-control-allow-origin`, every API call was blocked, and the login
 * screen said the server was unreachable — while both the web build and the
 * gateway were healthy. Nothing could have caught it, because the list was an
 * inline literal inside `NestFactory.create` that no test could see.
 *
 * These run with a PRODUCTION env: the dev-only loopback entry is off, so a
 * pass here means the real deployed configuration allows the real domain.
 */
describe("CORS allow-list", () => {
  const prodEnv = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it.each(PRODUCTION_ORIGINS)(
    "allows the production origin %s with no env var set",
    (origin) => {
      // No FRONTEND_URL: the customer-facing domain must not depend on it.
      expect(isOriginAllowed(origin, prodEnv)).toBe(true);
    },
  );

  it("allows the dev subdomain that previews the branch builds", () => {
    expect(isOriginAllowed("https://dev.mudavym.com", prodEnv)).toBe(true);
  });

  it("still allows Vercel deployment URLs", () => {
    expect(
      isOriginAllowed(
        "https://restaurant-ai-automation-web.vercel.app",
        prodEnv,
      ),
    ).toBe(true);
  });

  it("still honours FRONTEND_URL as an additional, comma-separated source", () => {
    const env = {
      NODE_ENV: "production",
      FRONTEND_URL: "https://a.example,https://b.example",
    } as NodeJS.ProcessEnv;
    expect(isOriginAllowed("https://a.example", env)).toBe(true);
    expect(isOriginAllowed("https://b.example", env)).toBe(true);
  });

  it("does not turn the domain rule into a wildcard for lookalikes", () => {
    // The subdomain pattern must be anchored — `notmudavym.com` and
    // `mudavym.com.evil.test` are different sites.
    expect(isOriginAllowed("https://notmudavym.com", prodEnv)).toBe(false);
    expect(isOriginAllowed("https://mudavym.com.evil.test", prodEnv)).toBe(
      false,
    );
    expect(isOriginAllowed("https://evil.test", prodEnv)).toBe(false);
  });

  it("keeps loopback out of production", () => {
    // The catch-all localhost port rule is dev-only; production should not
    // hand credentials to an arbitrary local port.
    expect(isOriginAllowed("http://localhost:9999", prodEnv)).toBe(false);
    expect(
      isOriginAllowed("http://localhost:9999", {
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
