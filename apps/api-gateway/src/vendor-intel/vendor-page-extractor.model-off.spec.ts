/**
 * A vendor page this server cannot read says so in the house's words.
 *
 * `skippedReason` reaches /vendor-prices as the site-sweep status `detail`
 * (vendor-site-sweep.service.ts). It used to read "ANTHROPIC_API_KEY not
 * configured" when no model was switched on, and "Model call failed: Anthropic
 * 401: ..." when the call failed: a deployment variable and a vendor's error,
 * printed to an owner. The raw text now goes to the log only.
 */
jest.mock("../common/net/ssrf-guard", () => {
  class SsrfBlockedError extends Error {
    reason = "blocked";
  }
  return {
    SsrfBlockedError,
    assertPublicHttpTarget: jest.fn().mockResolvedValue(undefined),
    safeFetch: jest.fn(async (url: string) =>
      url.endsWith("/robots.txt")
        ? { ok: false, status: 404, text: async () => "" }
        : {
            ok: true,
            status: 200,
            text: async () =>
              `<html><body>${"Chateau Example 2019 750ml 24.00. ".repeat(10)}</body></html>`,
          },
    ),
  };
});

import {
  PRICE_READER_DOWN,
  PRICE_READER_OFF,
  VendorPageExtractorService,
} from "./vendor-page-extractor.service";

const ENGINEERING =
  /ANTHROPIC|API[\s_-]?KEY|not configured|Model call failed|Anthropic|\b[45]\d\d\b/i;

function service(opts: { key?: string; modelError?: Error }) {
  const config = { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? opts.key : undefined) };
  const modelClient = {
    call: jest.fn(async () => {
      if (opts.modelError) throw opts.modelError;
      return { content: [{ type: "text", text: "{}" }] };
    }),
  };
  const svc = new VendorPageExtractorService(
    config as any,
    {} as any,
    modelClient as any,
    {} as any,
  );
  const warn = jest.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
  return { svc, warn, modelClient };
}

describe("vendor page reader: switched off or failing, in the house's words", () => {
  it("no model switched on: the house reads 'not switched on here yet', the log keeps the variable", async () => {
    const { svc, warn, modelClient } = service({ key: undefined });
    const r = await svc.extractFromUrl({ url: "https://vendor.example/wines", dryRun: true });
    expect(r.fetched).toBe(true);
    expect(r.skippedReason).toBe(PRICE_READER_OFF);
    expect(r.skippedReason).toMatch(/not switched on here yet/);
    expect(r.skippedReason).not.toMatch(ENGINEERING);
    expect(modelClient.call).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("the model call fails: the house reads that it did not work just now, the log keeps the error", async () => {
    const { svc, warn } = service({
      key: "test-key",
      modelError: new Error("Anthropic 401: invalid x-api-key"),
    });
    const r = await svc.extractFromUrl({ url: "https://vendor.example/wines", dryRun: true });
    expect(r.skippedReason).toBe(PRICE_READER_DOWN);
    expect(r.skippedReason).not.toMatch(ENGINEERING);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/Anthropic 401/);
  });

  it("neither sentence names a variable, a vendor or a status code", () => {
    for (const s of [PRICE_READER_OFF, PRICE_READER_DOWN]) {
      expect(s).not.toMatch(ENGINEERING);
    }
  });
});
