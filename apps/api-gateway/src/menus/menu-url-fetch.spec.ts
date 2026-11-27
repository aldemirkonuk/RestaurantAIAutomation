import { fetchMenuLink, htmlToMenuText, isPublicAddress, MenuLinkRefused, type LinkTransport } from "./menu-url-fetch";

/**
 * r108 menu-g11: the gateway fetches a menu link itself, fenced against
 * server-side request forgery. Nothing here touches the network: DNS and the
 * transport are fakes, and the fake transport records every address the
 * fetch would have connected to.
 */

const PUBLIC = { address: "93.184.216.34", family: 4 };

function site(pages: Record<string, { status?: number; headers?: Record<string, string>; body?: Buffer | Buffer[] }>) {
  const connected: Array<{ url: string; address: string }> = [];
  const transport: LinkTransport = async (url, addr) => {
    connected.push({ url: url.toString(), address: addr.address });
    const page = pages[url.toString()];
    if (!page) return { status: 404, headers: {}, body: (async function* () {})(), abort: () => undefined };
    const parts = Array.isArray(page.body) ? page.body : page.body ? [page.body] : [];
    let aborted = false;
    return {
      status: page.status ?? 200,
      headers: page.headers ?? { "content-type": "text/html; charset=utf-8" },
      body: (async function* () {
        for (const p of parts) {
          if (aborted) return;
          yield p;
        }
      })(),
      abort: () => {
        aborted = true;
      },
    };
  };
  return { transport, connected };
}

const dnsOf = (map: Record<string, string[]>) => async (host: string) => {
  const a = map[host];
  if (!a) throw new Error("ENOTFOUND");
  return a.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

const refusal = (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe("isPublicAddress -- the ranges a web server never has", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.4.4",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00:ec2::254",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2002:0a00:0001::1",
    "2001:db8::1",
    "ff02::1",
  ])("%s is refused", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:93.184.216.34"])("%s is public", (ip) =>
    expect(isPublicAddress(ip)).toBe(true));
});

describe("fetchMenuLink -- the fence", () => {
  it("http:// is refused before anything is looked up", async () => {
    const { transport, connected } = site({});
    const e = await refusal(fetchMenuLink("http://menu.example/", { lookup: dnsOf({}), transport }));
    expect(e).toBeInstanceOf(MenuLinkRefused);
    expect(e.message).toMatch(/Only an https:\/\/ link/);
    expect(connected).toEqual([]);
  });

  it("a port other than 443 and a user:password are refused", async () => {
    const { transport } = site({});
    expect((await refusal(fetchMenuLink("https://menu.example:8443/", { transport }))).message).toMatch(/port/);
    expect((await refusal(fetchMenuLink("https://a:b@menu.example/", { transport }))).message).toMatch(/password/);
  });

  it.each(["https://127.0.0.1/", "https://10.0.0.5/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/"])(
    "%s is refused and never connected to",
    async (link) => {
      const { transport, connected } = site({});
      const e = await refusal(fetchMenuLink(link, { lookup: dnsOf({}), transport }));
      expect(e.message).toMatch(/private network/);
      expect(connected).toEqual([]);
    },
  );

  it("a name that resolves to 192.168.1.2 is refused, and so is one with ANY private answer", async () => {
    const { transport, connected } = site({});
    const lookup = dnsOf({ "inside.example": ["192.168.1.2"], "mixed.example": ["93.184.216.34", "10.1.1.1"] });
    expect((await refusal(fetchMenuLink("https://inside.example/", { lookup, transport }))).message).toMatch(/private/);
    expect((await refusal(fetchMenuLink("https://mixed.example/", { lookup, transport }))).message).toMatch(/private/);
    expect(connected).toEqual([]);
  });

  it("connects to the address that was checked", async () => {
    const { transport, connected } = site({ "https://menu.example/": { body: Buffer.from("<p>Raki 90</p>") } });
    const r = await fetchMenuLink("https://menu.example/", { lookup: dnsOf({ "menu.example": [PUBLIC.address] }), transport });
    expect(connected).toEqual([{ url: "https://menu.example/", address: PUBLIC.address }]);
    expect(r).toMatchObject({ kind: "html", contentType: "text/html", host: "menu.example", finalUrl: "https://menu.example/" });
  });

  it("a redirect to a private address is refused, and never connected to", async () => {
    const { transport, connected } = site({
      "https://menu.example/": { status: 302, headers: { location: "https://evil.example/x" } },
      "https://evil.example/x": { body: Buffer.from("secret") },
    });
    const lookup = dnsOf({ "menu.example": [PUBLIC.address], "evil.example": ["10.0.0.7"] });
    const e = await refusal(fetchMenuLink("https://menu.example/", { lookup, transport }));
    expect(e.message).toMatch(/private network/);
    expect(connected.map((c) => c.address)).toEqual([PUBLIC.address]);
  });

  it("a redirect to http:// is refused", async () => {
    const { transport } = site({ "https://menu.example/": { status: 301, headers: { location: "http://menu.example/" } } });
    const e = await refusal(fetchMenuLink("https://menu.example/", { lookup: dnsOf({ "menu.example": [PUBLIC.address] }), transport }));
    expect(e.message).toMatch(/https/);
  });

  it("three redirects are followed; a fourth is refused", async () => {
    const hop = (n: number) => `https://menu.example/${n}`;
    const pages: Record<string, any> = { [hop(4)]: { body: Buffer.from("<p>ok</p>") } };
    for (let i = 0; i < 4; i++) pages[hop(i)] = { status: 302, headers: { location: hop(i + 1) } };
    const { transport } = site(pages);
    const lookup = dnsOf({ "menu.example": [PUBLIC.address] });
    await expect(fetchMenuLink(hop(1), { lookup, transport })).resolves.toMatchObject({ finalUrl: hop(4) });
    expect((await refusal(fetchMenuLink(hop(0), { lookup, transport }))).message).toMatch(/more than 3/);
  });

  it("6 MB is refused, by its declared length and by what it actually sends", async () => {
    const mb = Buffer.alloc(1024 * 1024, 0x61);
    const lookup = dnsOf({ "menu.example": [PUBLIC.address] });
    const declared = site({ "https://menu.example/": { headers: { "content-type": "application/pdf", "content-length": String(6 * mb.length) } } });
    expect((await refusal(fetchMenuLink("https://menu.example/", { lookup, transport: declared.transport }))).message).toMatch(/5 MB/);
    const streamed = site({ "https://menu.example/": { headers: { "content-type": "application/pdf" }, body: Array(6).fill(mb) } });
    expect((await refusal(fetchMenuLink("https://menu.example/", { lookup, transport: streamed.transport }))).message).toMatch(/5 MB/);
    const fine = site({ "https://menu.example/": { headers: { "content-type": "application/pdf" }, body: Array(5).fill(mb) } });
    await expect(fetchMenuLink("https://menu.example/", { lookup, transport: fine.transport })).resolves.toMatchObject({ kind: "pdf" });
  });

  it("a kind that is not a page, a PDF or a photo is refused in words", async () => {
    const { transport } = site({ "https://menu.example/": { headers: { "content-type": "application/zip" }, body: Buffer.from("PK") } });
    const e = await refusal(fetchMenuLink("https://menu.example/", { lookup: dnsOf({ "menu.example": [PUBLIC.address] }), transport }));
    expect(e.message).toMatch(/application\/zip, not a web page, a PDF or a photo/);
  });

  it("an image is read as an image", async () => {
    const { transport } = site({ "https://menu.example/m.jpg": { headers: { "content-type": "image/jpeg" }, body: Buffer.from([0xff, 0xd8]) } });
    await expect(
      fetchMenuLink("https://menu.example/m.jpg", { lookup: dnsOf({ "menu.example": [PUBLIC.address] }), transport }),
    ).resolves.toMatchObject({ kind: "image" });
  });

  it("a page that does not answer in time is refused in words", async () => {
    const transport: LinkTransport = (_u, _a, signal) =>
      new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const e = await refusal(
      fetchMenuLink("https://menu.example/", { lookup: dnsOf({ "menu.example": [PUBLIC.address] }), transport, timeoutMs: 20 }),
    );
    expect(e.message).toMatch(/15 seconds/);
  });
});

describe("htmlToMenuText -- the visible text only", () => {
  it("drops script, style and nav with what they hold, and keeps the lines", () => {
    const html =
      "<html><head><title>T</title><style>p{color:red}</style></head><body>" +
      "<nav><a href='/'>Home</a><a>Book</a></nav><script>var price = 999;</script>" +
      "<h2>Rakı</h2><p>Yeni Rakı 70 cl &mdash; 1&nbsp;250&nbsp;₺</p><ul><li>Efe Gold &amp; buz 1 300</li></ul>" +
      "<!-- old: Tekirdağ 900 --></body></html>";
    expect(htmlToMenuText(html)).toBe("Rakı\nYeni Rakı 70 cl &mdash; 1 250 ₺\nEfe Gold & buz 1 300");
  });
  it("numeric entities are decoded", () => expect(htmlToMenuText("<p>Ros&#233; &#x2014; 45</p>")).toBe("Rosé — 45"));
});
