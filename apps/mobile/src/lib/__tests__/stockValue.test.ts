import * as fs from "fs";
import * as path from "path";
import { COST_NOT_KNOWN, costLabel, totalStockValue, totalStockValueText } from "../stockValue";

const fmt = (n: number) => `$${n}`;
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../../..", rel), "utf8");

describe("idle-stock value never sums an unknown cost as $0", () => {
  it("counts a wine with bottles and no recorded cost instead of adding it as 0", () => {
    const t = totalStockValue([
      { wac: 10, quantity: 3 },
      { wac: undefined, quantity: 5 },
      { wac: undefined, quantity: 0 },
    ]);
    expect(t).toEqual({ known: 30, unknownItems: 1 });
    expect(totalStockValueText(t, fmt)).toBe("$30 + 1 wine whose cost is not known yet");
    expect(totalStockValueText({ known: 0, unknownItems: 2 }, fmt)).toBe(`${COST_NOT_KNOWN} (2 wines)`);
  });

  it("an agreed cost is labelled agreed, not estimated", () => {
    expect(costLabel("agreed", 12.5)).toBe("Cost (agreed at delivery)");
    expect(costLabel("invoice", 12)).toBe("Cost (invoice)");
    expect(costLabel(undefined, null)).toBe("Cost");
  });

  // The screens render React Native, which this node runner does not load
  // (jest.config.js), so the wiring is pinned by source: the readers use the
  // helpers above and the `?? 0` cost read is gone.
  it("Insights and the wine screen read cost through these helpers", () => {
    const insights = read("app/(tabs)/insights.tsx");
    expect(insights).toContain("totalStockValue(dead)");
    expect(insights).not.toMatch(/\(i\.wac \?\? 0\)/);
    const wine = read("app/(tabs)/cellar/[id].tsx");
    expect(wine).toContain("costLabel(item.costProvenance, cost)");
    expect(wine).toContain("COST_NOT_KNOWN");
  });
});
