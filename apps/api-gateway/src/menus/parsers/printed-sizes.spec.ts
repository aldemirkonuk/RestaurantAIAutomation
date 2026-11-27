import { ConfigService } from "@nestjs/config";
import { ModelClientService } from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";
import { MenuReadWarning } from "../wine-extract-item.interface";
import { keepPrintedSizes, sizePrice } from "./printed-sizes";
import { ScanParserService } from "./scan-parser.service";

/** r109 menu-g3: every size a line prints is kept as printed, and never guessed. */
describe("keepPrintedSizes", () => {
  const raw = "Yeni Rakı 20 cl 450 / 35 cl 700 / 70 cl 1250";

  it("keeps each size with its label, volume and price as printed", () => {
    expect(
      keepPrintedSizes(
        [
          { label: "20 cl", ml: 200, price: 450 },
          { label: "35 cl", ml: 350, price: "700" },
          { label: "70 cl", ml: 700, price: 1250 },
        ],
        raw,
      ),
    ).toEqual({
      sizes: [
        { label: "20 cl", ml: 200, price: 450 },
        { label: "35 cl", ml: 350, price: 700 },
        { label: "70 cl", ml: 700, price: 1250 },
      ],
      unread: 0,
    });
  });

  it("drops a size whose label is not on the line's text, and keeps all when the text is not held", () => {
    const sizes = [
      { label: "20 cl", price: 450 },
      { label: "50 cl", price: 900 },
      { label: "70 cl", price: 1250 },
    ];
    expect(keepPrintedSizes(sizes, raw).sizes?.map((s) => s.label)).toEqual(["20 cl", "70 cl"]);
    expect(keepPrintedSizes(sizes, null).sizes).toHaveLength(3);
  });

  it("a size whose price does not read is dropped and counted, never guessed", () => {
    const r = keepPrintedSizes(
      [
        { label: "small", price: 40 },
        { label: "medium", price: "12 / 45" },
        { label: "large", price: -5 },
        { label: "jug", price: 12.345 },
        { label: "half", price: "1,250" },
        { label: "full", price: 80.5 },
      ],
      null,
    );
    expect(r).toEqual({
      sizes: [
        { label: "small", ml: null, price: 40 },
        { label: "full", ml: null, price: 80.5 },
      ],
      unread: 4,
    });
  });

  it("one size is not sizes; nine is a price table, refused whole", () => {
    expect(keepPrintedSizes([{ label: "33 cl", price: 90 }], null).sizes).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => ({ label: `${i + 1} cl`, price: 10 + i }));
    expect(keepPrintedSizes(nine, null).sizes).toBeNull();
    expect(keepPrintedSizes(nine.slice(0, 8), null).sizes).toHaveLength(8);
  });

  it("keeps only a whole volume in range, de-duplicates labels, and ignores what is not a size", () => {
    expect(
      keepPrintedSizes(
        [
          { label: "Small", ml: 12.5, price: 4 },
          { label: "small", price: 5 },
          { label: "Big", ml: 9000, price: 6 },
          { label: "", price: 7 },
          "70 cl",
          null,
        ],
        null,
      ).sizes,
    ).toEqual([
      { label: "Small", ml: null, price: 4 },
      { label: "Big", ml: null, price: 6 },
    ]);
  });

  it("sizePrice reads 12.34 (a floating-point hair is not a third decimal)", () => {
    expect(sizePrice(12.34)).toBe(12.34);
    expect(sizePrice("45,50")).toBe(45.5);
    expect(sizePrice("-12")).toBeNull();
    expect(sizePrice(1e9)).toBeNull();
    expect(sizePrice(undefined)).toBeNull();
  });
});

describe("the scan reader keeps a line's printed sizes beside its two prices", () => {
  function reader(reply: unknown[]) {
    const call = jest.fn().mockResolvedValue({ content: [{ text: JSON.stringify(reply) }], stop_reason: "end_turn" });
    const s = new ScanParserService(
      { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test-key" : undefined) } as unknown as ConfigService,
      { call } as unknown as ModelClientService,
      { record: jest.fn() } as unknown as NfVerdictService,
    );
    return { s, call };
  }

  it("a 20/35/70 cl rakı line keeps three sizes and its bottle price; the glass price is not filled from a size", async () => {
    const { s, call } = reader([
      {
        name: "Yeni Rakı",
        category: "spirit",
        bottle_price: 1250,
        raw_text: "Yeni Rakı 20 cl 450 / 35 cl 700 / 70 cl 1250",
        sizes: [
          { label: "20 cl", ml: 200, price: 450 },
          { label: "35 cl", ml: 350, price: 700 },
          { label: "70 cl", ml: 700, price: 1250 },
        ],
      },
    ]);
    const warnings: MenuReadWarning[] = [];
    const items = await s.parse("iVBORw0KGgo", "house", false, warnings);
    expect(items).toHaveLength(1);
    expect(items[0].bottle_price).toBe(1250);
    expect(items[0].by_glass_price).toBeUndefined();
    expect(items[0].sizes).toEqual([
      { label: "20 cl", ml: 200, price: 450 },
      { label: "35 cl", ml: 350, price: 700 },
      { label: "70 cl", ml: 700, price: 1250 },
    ]);
    expect(warnings).toEqual([]);
    const prompt = JSON.stringify(call.mock.calls[0][0]);
    expect(prompt).toContain("sizes: [{ label, ml, price }]");
    expect(prompt).toContain("Still fill by_glass_price and bottle_price exactly as you would without sizes");
  });

  it("sizes whose price did not read are left off and told once in the read notes", async () => {
    const { s } = reader([
      { name: "Efes", by_glass_price: 90, sizes: [{ label: "33 cl", price: 90 }, { label: "50 cl", price: "12 / 45" }] },
      { name: "Kulüp", bottle_price: 900, sizes: [{ label: "35 cl", price: "abc" }, { label: "70 cl", price: 900 }, { label: "100 cl", price: 1200 }] },
    ]);
    const warnings: MenuReadWarning[] = [];
    const items = await s.parseWithWarnings("iVBORw0KGgo", "house").then((r) => {
      warnings.push(...r.warnings);
      return r.items;
    });
    expect(items[0]).not.toHaveProperty("sizes");
    expect(items[0].by_glass_price).toBe(90);
    expect(items[1].sizes?.map((x) => x.label)).toEqual(["70 cl", "100 cl"]);
    expect(warnings).toEqual([{ kind: "size_price_unread", pages: null, count: 2 }]);
  });
});
