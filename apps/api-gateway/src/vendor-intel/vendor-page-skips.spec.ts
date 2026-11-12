/**
 * Every page the reader skips says why in the house's words.
 *
 * `skippedReason` reaches the house as the site-sweep status `detail`. It
 * used to carry the fetcher's own text: "Unsupported protocol ftp:", "Could
 * not resolve shop.example: ENOTFOUND", "HTTP 503", "Fetch failed: socket hang
 * up", "Disallowed by robots.txt", "Page produced almost no text — likely a
 * JS-rendered app". The house now reads one sentence per kind of skip, the
 * sweep branches on `skipped`, and the raw cause goes to the log.
 */
const fetchPlan: {
  guard?: Error;
  robots?: string;
  page?: { ok: boolean; status: number; body?: string } | Error;
} = {};

jest.mock("../common/net/ssrf-guard", () => {
  class SsrfBlockedError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return {
    SsrfBlockedError,
    assertPublicHttpTarget: jest.fn(async () => {
      if (fetchPlan.guard) throw fetchPlan.guard;
    }),
    safeFetch: jest.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return fetchPlan.robots == null
          ? { ok: false, status: 404, text: async () => "" }
          : { ok: true, status: 200, text: async () => fetchPlan.robots };
      }
      const p = fetchPlan.page;
      if (p instanceof Error) throw p;
      return { ok: p!.ok, status: p!.status, text: async () => p!.body ?? "" };
    }),
  };
});

import { SsrfBlockedError } from "../common/net/ssrf-guard";
import {
  SKIP_SENTENCE,
  SkipCode,
  VendorPageExtractorService,
  skipForBlockedAddress,
} from "./vendor-page-extractor.service";

/** The fetcher's vocabulary: none of it may reach the house. */
const ENGINEERING =
  /HTTP\s?\d|\b[45]\d\d\b|ENOTFOUND|ECONNRESET|socket|resolve|protocol\b|robots\.txt|JS-rendered|fetcher|Fetch failed|non-public|169\.254|\.example/i;

function service() {
  const svc = new VendorPageExtractorService(
    { get: () => "test-key" } as any,
    {} as any,
    { call: jest.fn() } as any,
    {} as any,
  );
  const logs: string[] = [];
  const logger = (svc as any).logger;
  for (const level of ["log", "warn", "error"]) {
    jest.spyOn(logger, level).mockImplementation((m: any) => void logs.push(String(m)));
  }
  return { svc, logs };
}

async function run(url: string) {
  const { svc, logs } = service();
  const r = await svc.extractFromUrl({ url, dryRun: true });
  return { r, logs: logs.join(" ") };
}

beforeEach(() => {
  fetchPlan.guard = undefined;
  fetchPlan.robots = undefined;
  fetchPlan.page = { ok: true, status: 200, body: "" };
});

describe("vendor page reader: a skip reads in the house's words", () => {
  const cases: Array<[string, () => void, string, SkipCode, RegExp | null]> = [
    ["not a URL", () => undefined, "not a url", "not_an_address", null],
    ["ftp", () => undefined, "ftp://shop.example/list", "not_an_address", /ftp:/],
    [
      "a host nobody answers for",
      () => (fetchPlan.guard = new SsrfBlockedError("Could not resolve shop.example: ENOTFOUND")),
      "https://shop.example/list",
      "not_found",
      /ENOTFOUND/,
    ],
    [
      "a private address",
      () =>
        (fetchPlan.guard = new SsrfBlockedError(
          "Refusing to fetch shop.example: it resolves to the non-public address 169.254.169.254",
        )),
      "https://shop.example/list",
      "not_public",
      /169\.254/,
    ],
    [
      "robots",
      () => (fetchPlan.robots = "User-agent: *\nDisallow: /"),
      "https://shop.example/list",
      "robots_forbids",
      /robots\.txt/,
    ],
    [
      "a 404",
      () => (fetchPlan.page = { ok: false, status: 404 }),
      "https://shop.example/list",
      "page_gone",
      /HTTP 404/,
    ],
    [
      "a 503",
      () => (fetchPlan.page = { ok: false, status: 503 }),
      "https://shop.example/list",
      "site_unavailable",
      /HTTP 503/,
    ],
    [
      "a dropped connection",
      () => (fetchPlan.page = new Error("socket hang up ECONNRESET")),
      "https://shop.example/list",
      "site_unavailable",
      /ECONNRESET/,
    ],
    [
      "a redirect to a private address",
      () =>
        (fetchPlan.page = new SsrfBlockedError(
          "Refusing to fetch a non-public address: 10.0.0.1",
        )),
      "https://shop.example/list",
      "not_public",
      /10\.0\.0\.1/,
    ],
    [
      "a page drawn by script",
      () => (fetchPlan.page = { ok: true, status: 200, body: "<div id=root></div>" }),
      "https://shop.example/list",
      "no_text",
      /characters of text/,
    ],
  ];

  it.each(cases)("%s", async (_name, arrange, url, code, logged) => {
    arrange();
    const { r, logs } = await run(url);
    expect(r.skipped).toBe(code);
    expect(r.skippedReason).toBe(SKIP_SENTENCE[code]);
    expect(r.skippedReason).not.toMatch(ENGINEERING);
    if (logged) expect(logs).toMatch(logged);
  });

  it("every sentence is plain: no status, host, error code or tool name", () => {
    for (const s of Object.values(SKIP_SENTENCE)) {
      expect(s.length).toBeGreaterThan(20);
      expect(s).not.toMatch(ENGINEERING);
    }
  });

  it("an address-guard reason it does not know is a site that did not answer", () => {
    expect(skipForBlockedAddress("Redirect handling fell through")).toBe(
      "site_unavailable",
    );
    expect(skipForBlockedAddress("Too many redirects (>5) starting from x")).toBe(
      "redirect_loop",
    );
  });
});
