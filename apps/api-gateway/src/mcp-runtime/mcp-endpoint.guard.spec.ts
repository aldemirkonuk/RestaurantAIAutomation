/**
 * The SSRF guard, tested as an address parser rather than through a probe.
 *
 * WHY THIS FILE EXISTS, AND WHY IT DID NOT BEFORE
 * ----------------------------------------------
 * The first build of this module had NO direct test for the endpoint guard —
 * only two assertions driven through `service.probe()` with literal
 * dotted-decimal IPs. It shipped with a working SSRF bypass: `URL` canonicalises
 * `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]`, so the guard's
 * `ip.includes(".")` test for the IPv4-mapped form was dead code, and a probe
 * completed a full MCP handshake against a loopback server in the DEFAULT
 * posture. The audit reproduced it live.
 *
 * Every case below is therefore a FORM, not a scenario: the same address written
 * the several ways a URL bar accepts it. The first block is the bypass itself,
 * and each of those tests fails against the pre-fix guard.
 *
 * `dns/promises` is mocked in the resolution block, so "every address a name
 * resolves to must pass" — a claim the file's header made and nothing checked —
 * is exercised rather than asserted.
 */

import { lookup } from "dns/promises";
import {
  checkEndpoint,
  parseIPv6,
  privateAddressReason,
} from "./mcp-endpoint.guard";

jest.mock("dns/promises", () => ({ lookup: jest.fn() }));
const mockLookup = lookup as unknown as jest.Mock;

beforeEach(() => {
  mockLookup.mockReset();
  // A literal address must never consult the resolver; any test that trips this
  // is testing a different code path than it thinks.
  mockLookup.mockRejectedValue(new Error("DNS must not be used for a literal"));
});

/** Refused, and the sentence says which range. */
async function refused(url: string): Promise<string> {
  const r = await checkEndpoint(url, false);
  expect(r.ok).toBe(false);
  expect(r.pinned).toBeNull();
  return r.reason ?? "";
}

describe("the IPv4-mapped IPv6 bypass (the shipped defect)", () => {
  // Each of these is the exact string the audit proved reachable. `URL`
  // rewrites the dotted form to hex before the guard sees it, so the dotted and
  // hex spellings must both be refused — they are the same 128-bit number.
  it("refuses ::ffff:127.0.0.1 — loopback written as a mapped IPv6 literal", async () => {
    expect(await refused("http://[::ffff:127.0.0.1]/mcp")).toMatch(/loopback/);
  });

  it("refuses ::ffff:7f00:1 — the same address in the hex form URL normalises to", async () => {
    expect(await refused("http://[::ffff:7f00:1]/mcp")).toMatch(/loopback/);
  });

  it("refuses ::ffff:169.254.169.254 — cloud instance metadata, mapped", async () => {
    expect(await refused("http://[::ffff:169.254.169.254]/latest/meta-data/")).toMatch(
      /link-local/,
    );
  });

  it("refuses ::ffff:a9fe:a9fe — the same metadata address in hex", async () => {
    expect(await refused("http://[::ffff:a9fe:a9fe]/")).toMatch(/link-local/);
  });

  it("refuses ::ffff:10.0.0.1 — RFC1918, mapped", async () => {
    expect(await refused("http://[::ffff:10.0.0.1]/mcp")).toMatch(/private network/);
  });
});

describe("native IPv6 ranges", () => {
  it("refuses ::1 (loopback)", async () => {
    expect(await refused("http://[::1]/mcp")).toMatch(/loopback/);
  });

  it("refuses :: (unspecified)", async () => {
    expect(await refused("http://[::]/mcp")).toMatch(/unspecified/);
  });

  it("refuses fe80::/10 (link-local)", async () => {
    expect(await refused("http://[fe80::1]/mcp")).toMatch(/link-local/);
    expect(privateAddressReason("febf:ffff::1")).toMatch(/link-local/);
  });

  it("refuses fc00::/7 (unique-local), at both ends of the range", async () => {
    expect(await refused("http://[fc00::1]/mcp")).toMatch(/unique-local/);
    expect(await refused("http://[fd00::1]/mcp")).toMatch(/unique-local/);
    expect(privateAddressReason("fdff:ffff::1")).toMatch(/unique-local/);
  });

  it("refuses ff00::/8 (multicast)", async () => {
    expect(await refused("http://[ff02::1]/mcp")).toMatch(/multicast/);
  });

  it("allows a genuinely public IPv6 address, and pins it", async () => {
    const r = await checkEndpoint("http://[2606:4700:4700::1111]/mcp", false);
    expect(r.ok).toBe(true);
    expect(r.pinned).toBe("2606:4700:4700::1111");
  });
});

describe("IPv6 forms that carry an IPv4 address in their bytes", () => {
  // Judging these on their v6 prefix is the same mistake as the string test:
  // each is decoded and re-checked against the v4 table.
  it("refuses ::127.0.0.1 (IPv4-compatible, deprecated but still typeable)", async () => {
    expect(await refused("http://[::127.0.0.1]/mcp")).toMatch(/loopback/);
  });

  it("refuses NAT64 64:ff9b:: carrying the metadata address", async () => {
    expect(await refused("http://[64:ff9b::169.254.169.254]/mcp")).toMatch(/link-local/);
  });

  it("refuses 6to4 2002::/16 carrying a loopback relay", async () => {
    expect(await refused("http://[2002:7f00:1::]/mcp")).toMatch(/loopback/);
  });

  it("refuses a Teredo address whose embedded server is private", () => {
    // 2001:0:<server v4>:… — server 10.0.0.1.
    expect(privateAddressReason("2001:0:a00:1:8000:0:0:0")).toMatch(/private network/);
  });

  it("allows 6to4 carrying a public relay", () => {
    // 2002:0808:0808:: -> 8.8.8.8
    expect(privateAddressReason("2002:808:808::")).toBeNull();
  });
});

describe("the parser fails CLOSED", () => {
  it("returns null for text it cannot expand", () => {
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIPv6("::1::2")).toBeNull();
    expect(parseIPv6("12345::1")).toBeNull();
    expect(parseIPv6("")).toBeNull();
  });

  it("expands the forms it does understand to the same 16 bytes", () => {
    const dotted = parseIPv6("::ffff:127.0.0.1");
    const hex = parseIPv6("::ffff:7f00:1");
    expect(dotted).not.toBeNull();
    expect(Array.from(dotted!)).toEqual(Array.from(hex!));
    expect(Array.from(dotted!.slice(12))).toEqual([127, 0, 0, 1]);
  });

  it("treats an unparseable address as unsafe rather than as safe", () => {
    // The whole point: "we could not tell what this is" must never mean "call
    // it". Exercised through the function that decides.
    expect(privateAddressReason("not-an-address")).not.toBeNull();
  });

  it("ignores a zone id rather than choking on it", () => {
    expect(privateAddressReason("fe80::1%eth0")).toMatch(/link-local/);
  });
});

describe("IPv4 forms a URL bar accepts", () => {
  it("refuses the decimal and hex spellings of 127.0.0.1", async () => {
    // `URL` normalises both to 127.0.0.1 before the guard sees them; pinned
    // here so a future change to that normalisation cannot open a hole quietly.
    expect(await refused("http://2130706433/mcp")).toMatch(/loopback/);
    expect(await refused("http://0x7f.1/mcp")).toMatch(/loopback/);
  });

  it("refuses every private v4 range by name", async () => {
    expect(await refused("http://10.0.0.1/")).toMatch(/private network/);
    expect(await refused("http://172.16.0.1/")).toMatch(/private network/);
    expect(await refused("http://192.168.1.1/")).toMatch(/private network/);
    expect(await refused("http://100.64.0.1/")).toMatch(/carrier-grade NAT/);
    expect(await refused("http://169.254.169.254/")).toMatch(/link-local/);
    expect(await refused("http://0.0.0.0/")).toMatch(/unspecified/);
    expect(await refused("http://224.0.0.1/")).toMatch(/multicast/);
    expect(await refused("http://255.255.255.255/")).toMatch(/reserved/);
  });
});

describe("the scheme and the credential", () => {
  it("refuses a non-http(s) scheme", async () => {
    expect(await refused("ftp://example.com/mcp")).toMatch(/only http and https/);
  });

  it("refuses a URL carrying its own credentials", async () => {
    expect(await refused("http://user:pw@example.com/mcp")).toMatch(/username or password/);
  });

  it("refuses text that is not a URL at all", async () => {
    expect(await refused("not a url")).toMatch(/not a URL/);
  });
});

describe("DNS: every address a name resolves to must pass, and one is pinned", () => {
  it("refuses a name with ANY private address among its answers", async () => {
    // The race this closes: a name with one public and one loopback record.
    // Checking only the first would be a coin flip.
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const r = await checkEndpoint("http://mixed.example/mcp", false);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/resolves to 127\.0\.0\.1/);
    expect(r.reason).toMatch(/loopback/);
  });

  it("refuses a name whose AAAA answer is a mapped loopback", async () => {
    // The same bypass, arriving from a resolver instead of from the URL.
    mockLookup.mockResolvedValue([{ address: "::ffff:7f00:1", family: 6 }]);
    const r = await checkEndpoint("http://rebind.example/mcp", false);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/loopback/);
  });

  it("allows a name with only public answers, and PINS the vetted address", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    const r = await checkEndpoint("http://public.example/mcp", false);
    expect(r.ok).toBe(true);
    expect(r.addresses).toHaveLength(2);
    // The pin is what `mcp-runtime.service.ts` hands to `http.request`'s lookup
    // hook, so the socket cannot be re-pointed by a second DNS answer.
    expect(r.pinned).toBe("93.184.216.34");
    expect(r.url?.hostname).toBe("public.example");
  });

  it("refuses a name that does not resolve, naming the resolver's code", async () => {
    mockLookup.mockRejectedValue(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
    const r = await checkEndpoint("http://nowhere.example/mcp", false);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ENOTFOUND/);
  });

  it("refuses a name that resolves to nothing at all", async () => {
    mockLookup.mockResolvedValue([]);
    const r = await checkEndpoint("http://empty.example/mcp", false);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/resolved to no address/);
  });

  it("does not consult the resolver for a literal address", async () => {
    // beforeEach makes the mock reject; reaching it would fail this test.
    const r = await checkEndpoint("http://93.184.216.34/mcp", false);
    expect(r.ok).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("the development allowance", () => {
  it("lets a developer through, and only when the variable says so", async () => {
    expect((await checkEndpoint("http://127.0.0.1:3000/mcp", true)).ok).toBe(true);
    expect((await checkEndpoint("http://[::1]:3000/mcp", true)).ok).toBe(true);
    expect((await checkEndpoint("http://127.0.0.1:3000/mcp", false)).ok).toBe(false);
  });

  it("names the variable in every refusal, so the fix is visible", async () => {
    expect(await refused("http://127.0.0.1/")).toContain("MCP_ALLOW_PRIVATE_ENDPOINTS");
    expect(await refused("http://[::ffff:127.0.0.1]/")).toContain(
      "MCP_ALLOW_PRIVATE_ENDPOINTS",
    );
  });
});
