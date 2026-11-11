import { parseXml, XmlRefused } from "./xml-lite";
import { readZip, ZipRefused, MAX_ENTRIES } from "./zip-lite";
import { zipOf } from "./test-zip.fixture";

/** Proposal-receipt rows 2.3 and 3.3 — the two bounded readers. SYNTHETIC. */

describe("xml-lite — strict, and safe by refusal", () => {
  it("refuses a DOCTYPE, so no entity is ever expanded (XXE, billion laughs)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>`;
    expect(() => parseXml(xxe)).toThrow(XmlRefused);
    expect(() => parseXml(xxe)).toThrow(/DOCTYPE/);
  });

  it("decodes the predefined and numeric entities only", () => {
    const el = parseXml(`<a>&amp;&lt;&#65;&#x42;&unknown;</a>`);
    expect(el.text).toBe("&<AB&unknown;");
  });

  it("refuses a file that is cut short or closes the wrong tag", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(/not well-formed/);
    expect(() => parseXml("<a><b>")).toThrow(/cut short/);
  });
});

describe("zip-lite — bounded reading of the zipped e-invoice", () => {
  it("reads stored and deflated entries", () => {
    const z = zipOf([
      { name: "a.xml", data: "<a/>", method: 0 },
      { name: "b.xml", data: "<b>" + "x".repeat(1000) + "</b>" },
    ]);
    const out = readZip(z);
    expect(out.map((e) => e.name)).toEqual(["a.xml", "b.xml"]);
    expect(out[1].bytes.toString()).toContain("xxxx");
  });

  it("refuses more files than it reads, and a damaged index", () => {
    const many = zipOf(
      Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ name: `${i}.txt`, data: "x" })),
    );
    expect(() => readZip(many)).toThrow(ZipRefused);
    const cut = zipOf([{ name: "a.xml", data: "<a/>" }]).subarray(0, 20);
    expect(() => readZip(cut)).toThrow(/cut short|index/);
  });
});
