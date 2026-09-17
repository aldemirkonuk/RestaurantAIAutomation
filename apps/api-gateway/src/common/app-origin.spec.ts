import { appOrigin, CANONICAL_APP_ORIGIN } from "./app-origin";

/**
 * FRONTEND_URL on Railway is the CORS allow-list, not a single URL — see
 * app-origin.ts. This pins the one behaviour every link-building call site
 * depends on: take the first entry, never the raw comma-joined string, and
 * never fall back to the retired vercel.app host.
 */
describe("appOrigin", () => {
  const config = (value: string | undefined) => ({
    get: () => value,
  });

  it("takes the first entry of a comma-separated allow-list", () => {
    expect(
      appOrigin(
        config(
          "https://mudavym.com,https://www.mudavym.com,https://restaurant-ai-automation-web.vercel.app",
        ),
      ),
    ).toBe("https://mudavym.com");
  });

  it("trims whitespace around the first entry", () => {
    expect(appOrigin(config(" https://mudavym.com , https://other.test"))).toBe(
      "https://mudavym.com",
    );
  });

  it("strips a trailing slash", () => {
    expect(appOrigin(config("https://mudavym.com/"))).toBe(
      "https://mudavym.com",
    );
  });

  it("passes through a single-value FRONTEND_URL unchanged", () => {
    expect(appOrigin(config("https://app.example.test"))).toBe(
      "https://app.example.test",
    );
  });

  it("falls back to the canonical mudavym.com origin when unset", () => {
    expect(appOrigin(config(undefined))).toBe(CANONICAL_APP_ORIGIN);
    expect(appOrigin(config(""))).toBe(CANONICAL_APP_ORIGIN);
  });

  it("never falls back to the retired vercel.app host", () => {
    expect(appOrigin(config(undefined))).not.toContain("vercel.app");
  });
});
