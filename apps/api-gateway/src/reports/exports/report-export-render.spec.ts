import { withheld, type ExportDoc } from "./report-export-doc";
import { escapeHtml, renderCsv, renderHtml, type ExportHeader } from "./report-export-render";

/**
 * OD-81 — the two files an export is. Pure functions, so the bytes are pinned.
 *
 * Every assertion here is one a spreadsheet or a printer would otherwise get
 * wrong silently: a withheld figure summed as zero, a vendor-typed wine name
 * run as a formula or as markup, a currency nobody stated.
 */

const HEADER: ExportHeader = {
  houseName: "Meyhouse",
  currency: "TRY",
  title: "Figures of record",
  windowLabel: "365 days of COGS; the cellar as it stands today",
  writtenAt: "2026-09-17T09:00:00.000Z",
  timezone: "Europe/Istanbul",
  withheldCount: 2,
};

const DOC: ExportDoc = {
  say: null,
  figures: [
    { label: "Sell-price valuation", value: 5400, unit: "money" },
    { label: "Cost of goods (365d)", value: withheld("No delivered order came back"), unit: "money" },
    { label: "Real zero", value: 0, unit: "count" },
  ],
  tables: [
    {
      title: "The list",
      columns: [
        { label: "Wine", unit: "text" },
        { label: "Margin per bottle", unit: "money" },
        { label: "Change", unit: "text" },
      ],
      rows: [
        ["=HYPERLINK(\"http://evil\")", withheld("no recorded cost"), { n: -3.25, unit: "percent" }],
        ["<script>alert(1)</script> Nebbiolo", -12.5, { n: 0.4, unit: "ratio" }],
      ],
      note: "All 2 wines.",
    },
  ],
  notes: ["A note, with a comma."],
  basis: ["on-hand qty × unit cost"],
};

describe("renderCsv (OD-81)", () => {
  const csv = renderCsv(DOC, HEADER);
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n");

  it("opens as UTF-8 with CRLF line ends (RFC 4180)", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("writes a withheld figure as the word, with its reason — never as 0 or a blank a sum would read as 0", () => {
    expect(lines).toContain("Cost of goods (365d),withheld,TRY,No delivered order came back");
    expect(lines).toContain("Sell-price valuation,5400,TRY,");
    // A measured zero is still a zero.
    expect(lines).toContain("Real zero,0,count,");
    const table = lines.indexOf("The list");
    expect(lines[table + 2].split(",")[1]).toBe("withheld");
    expect(lines).toContain("Withheld,Margin per bottle: no recorded cost");
  });

  it("neutralises a formula in text anyone typed, and leaves a negative figure a number", () => {
    const table = lines.indexOf("The list");
    expect(lines[table + 2].startsWith(`"'=HYPERLINK(""http://evil"")"`)).toBe(true);
    expect(lines[table + 3]).toContain(",-12.5,");
  });

  it("names the unit in the header of a numeric column, and in the cell of a text column that mixes units", () => {
    const table = lines.indexOf("The list");
    expect(lines[table + 1]).toBe("Wine,Margin per bottle (TRY),Change");
    expect(lines[table + 2].endsWith(",-3.25 %")).toBe(true);
    expect(lines[table + 3].endsWith(`,"0.4 share, 0–1"`)).toBe(true);
  });

  it("states that the currency is not recorded rather than inventing one", () => {
    const bare = renderCsv(DOC, { ...HEADER, currency: null });
    expect(bare).toContain("currency not recorded for this house");
    expect(bare).toContain("Cost of goods (365d),withheld,currency not recorded,");
    expect(bare).not.toMatch(/\bUSD\b|\$/);
  });

  it("carries the house, the cutting, the window and the withheld count in its header", () => {
    expect(lines.slice(0, 7)).toEqual([
      "Mudavym report export",
      "House,Meyhouse",
      "Cutting,Figures of record",
      "Window,365 days of COGS; the cellar as it stands today",
      // F-413: on the house's clock, zone named — the same clock as its days.
      'Written,"2026-09-17 12:00, house time (Europe/Istanbul)"',
      "Money,\"TRY, the house's reporting currency; money is written as a bare number\"",
      'Withheld,"2 figures the engine could not compute are written as ""withheld"", never as 0"',
    ]);
  });
});

describe("renderCsv in the house's marks (F-907)", () => {
  it("writes ';' between cells and ',' decimals for a house whose decimal mark is ','", () => {
    const lira = renderCsv(DOC, { ...HEADER, locale: "tr-TR" })
      .replace(/^\uFEFF/, "")
      .split("\r\n");
    const table = lira.indexOf("The list");
    expect(lira[table + 1]).toBe("Wine;Margin per bottle (TRY);Change");
    expect(lira[table + 2]).toBe(`"'=HYPERLINK(""http://evil"")";withheld;-3,25 %`);
    // A comma inside a cell needs no quotes now; a ';' inside one does.
    expect(lira[table + 3].endsWith(";-12,5;0,4 share, 0–1")).toBe(true);
    expect(lira).toContain('Window;"365 days of COGS; the cellar as it stands today"');
    expect(lira).toContain("Sell-price valuation;5400;TRY;");
  });

  it("keeps ',' and '.' for an en-US house or one with no formats tag", () => {
    expect(renderCsv(DOC, { ...HEADER, locale: "en-US" })).toBe(renderCsv(DOC, HEADER));
    expect(renderCsv(DOC, HEADER)).toContain(",-12.5,");
  });
});

describe("renderHtml (OD-81)", () => {
  const html = renderHtml(DOC, HEADER);

  it("escapes everything interpolated, so a vendor-typed name is text and not markup", () => {
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Nebbiolo");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });

  it("forbids script outright, as a second line behind the escaping", () => {
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    );
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("prints withheld figures as the word with the reason, and never as 0", () => {
    expect(html).toContain(
      `<dt>Cost of goods (365d)</dt><dd><span class="withheld">withheld</span><span class="reason">No delivered order came back</span></dd>`,
    );
    expect(html).toContain(`<dt>Sell-price valuation</dt><dd>5,400.00 TRY</dd>`);
    expect(html).toContain(`<li><span class="withheld">withheld</span> — Margin per bottle: no recorded cost</li>`);
  });

  it("is laid out for paper", () => {
    expect(html).toContain("@page { size: A4;");
    expect(html).toContain("@media print { .screen-only { display: none; }");
    expect(html).toContain("<h1>Figures of record</h1>");
  });

  it("writes Written on the house's clock, and says so when the house has no zone (F-413)", () => {
    expect(html).toContain("Written 2026-09-17 12:00, house time (Europe/Istanbul)");
    const unzoned = renderHtml(DOC, { ...HEADER, timezone: null });
    expect(unzoned).toContain("Written 2026-09-17 09:00 UTC; this house has no time zone set");
    expect(unzoned).not.toContain("2026-09-17T09:00:00.000Z");
  });

  it("says money has no currency when the house has not stated one", () => {
    const bare = renderHtml(DOC, { ...HEADER, currency: null, houseName: null });
    expect(bare).toContain("this house&#39;s reporting currency is not recorded");
    expect(bare).toContain(`<dd>5,400.00</dd>`);
    expect(bare).toContain("House name not recorded");
  });

  it("[REVERT-FAILS] groups the printed figures the house's way (F-889)", () => {
    const lira = renderHtml(DOC, { ...HEADER, locale: "tr-TR" });
    expect(lira).toContain(`<dt>Sell-price valuation</dt><dd>5.400,00 TRY</dd>`);
    expect(lira).not.toContain("5,400.00");
    expect(lira).toContain(">-12,50<");
    expect(lira).toContain(">%40,0<");
    // en-US by default, as before.
    expect(html).toContain(">-12.50<");
    expect(html).toContain(">40.0%<");
  });
});
