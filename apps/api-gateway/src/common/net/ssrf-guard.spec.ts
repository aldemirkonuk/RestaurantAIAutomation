import {
  SsrfBlockedError,
  assertPublicHttpTarget,
  isBlockedAddress,
  safeFetch,
} from "./ssrf-guard";

/**
 * OD-54 — `vendor-page-extractor.service.ts` fetched a user-supplied URL with
 * nothing but a robots.txt check in front of it (CodeQL `js/request-forgery`,
 * critical). These tests are written against the attacks, not the code: each one
 * is a way in that existed before the guard.
 */

describe("isBlockedAddress", () => {
  it.each([
    ["169.254.169.254", "AWS/GCP metadata — the reason this bug matters"],
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "RFC1918"],
    ["172.16.0.1", "RFC1918 middle range, the one blocklists miss"],
    ["172.31.255.255", "RFC1918 upper bound"],
    ["192.168.1.1", "RFC1918"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["0.0.0.0", "this network"],
    ["255.255.255.255", "broadcast"],
    ["::1", "IPv6 loopback"],
    ["fd00::1", "IPv6 unique-local"],
    ["fe80::1", "IPv6 link-local"],
    ["::ffff:127.0.0.1", "a private v4 wearing a v6 costume"],
    ["::ffff:169.254.169.254", "metadata via v4-mapped v6"],
    ["not-an-ip", "refuse what cannot be parsed"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["172.15.255.255"], // just below RFC1918 — an off-by-one here blocks real vendors
    ["172.32.0.0"], // just above
    ["2606:4700:4700::1111"],
  ])("allows the public address %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("assertPublicHttpTarget", () => {
  it("refuses a literal metadata IP", async () => {
    await expect(
      assertPublicHttpTarget(
        new URL("http://169.254.169.254/latest/meta-data/"),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("refuses a bracketed IPv6 loopback", async () => {
    await expect(
      assertPublicHttpTarget(new URL("http://[::1]:8080/")),
    ).rejects.toThrow(/non-public/);
  });

  it.each(["file:///etc/passwd", "gopher://x/", "ftp://x/"])(
    "refuses the non-HTTP scheme %s",
    async (u) => {
      await expect(assertPublicHttpTarget(new URL(u))).rejects.toThrow(
        /Unsupported protocol/,
      );
    },
  );

  it("allows an ordinary public literal", async () => {
    await expect(
      assertPublicHttpTarget(new URL("https://8.8.8.8/")),
    ).resolves.toBeUndefined();
  });
});

describe("safeFetch — the redirect hole", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(
    pages: Record<string, { status: number; location?: string }>,
  ) {
    globalThis.fetch = (async (input: any) => {
      const key = input.toString();
      const page = pages[key];
      if (!page) throw new Error(`unexpected fetch: ${key}`);
      return {
        status: page.status,
        ok: page.status < 400,
        headers: {
          get: (h: string) =>
            h === "location" ? (page.location ?? null) : null,
        },
        text: async () => "<html></html>",
      } as any;
    }) as any;
  }

  it("blocks a PUBLIC url that redirects to the metadata endpoint", async () => {
    // The attack a pre-flight-only check cannot see: the first hop is genuinely
    // public and passes validation, then Location points inward.
    stubFetch({
      "https://8.8.8.8/start": {
        status: 302,
        location: "http://169.254.169.254/latest/",
      },
    });
    await expect(safeFetch("https://8.8.8.8/start")).rejects.toThrow(
      /non-public address/,
    );
  });

  it("blocks a redirect chain that turns inward on the second hop", async () => {
    stubFetch({
      "https://8.8.8.8/a": { status: 302, location: "https://1.1.1.1/b" },
      "https://1.1.1.1/b": { status: 302, location: "http://127.0.0.1/admin" },
    });
    await expect(safeFetch("https://8.8.8.8/a")).rejects.toThrow(
      /non-public address/,
    );
  });

  it("resolves a RELATIVE Location against the current hop", async () => {
    stubFetch({
      "https://8.8.8.8/a": { status: 302, location: "/b" },
      "https://8.8.8.8/b": { status: 200 },
    });
    await expect(safeFetch("https://8.8.8.8/a")).resolves.toMatchObject({
      status: 200,
    });
  });

  it("refuses an endless redirect loop rather than following it", async () => {
    stubFetch({
      "https://8.8.8.8/a": { status: 302, location: "https://8.8.8.8/a" },
    });
    await expect(
      safeFetch("https://8.8.8.8/a", { maxRedirects: 2 }),
    ).rejects.toThrow(/Too many redirects/);
  });

  it("returns a normal public response untouched", async () => {
    stubFetch({ "https://8.8.8.8/ok": { status: 200 } });
    await expect(safeFetch("https://8.8.8.8/ok")).resolves.toMatchObject({
      status: 200,
    });
  });
});
