import { EXPORT_CUTTINGS } from "./report-export-cuttings";
import { isWithheld, type ExportDoc } from "./report-export-doc";

/**
 * F-1145: the gateway gives COGS, spend and committed WITH their code when it
 * is one currency that is not the house's (cogsCurrency, spendCurrency,
 * committedCurrency, notCounted.orderValueCurrency). The file heads every
 * money figure with the house's code, so writing a euro COGS as a bare number
 * there reads as lira: "Cost of goods (365d) (TRY), 48000" for €48,000.
 */

const valueOf = (doc: ExportDoc, label: string) =>
  doc.figures.find((f) => f.label === label)?.value;

describe("an export never writes another currency's money as the house's (F-1145)", () => {
  it("withholds a euro cost of goods in a lira house, saying the amount in euros", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(
      { cogs: 48000, cogsCurrency: "EUR", houseCurrency: "TRY", basis: {} },
      { days: null, currency: "TRY" },
    );
    const v = valueOf(doc, "Cost of goods (365d)");
    expect(isWithheld(v)).toBe(true);
    expect((v as any).why).toContain("48000 EUR");
    expect((v as any).why).toContain("TRY");
  });

  it("still writes a cost of goods in the house's own money", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(
      { cogs: 48000, cogsCurrency: "TRY", houseCurrency: "TRY", basis: {} },
      { days: null, currency: "TRY" },
    );
    expect(valueOf(doc, "Cost of goods (365d)")).toBe(48000);
  });

  it("withholds euro spend, committed and order value from spend pacing in a lira house", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(
      {
        spendLast30d: 1200,
        spendPrev30d: 800,
        paceDeltaPct: 0.5,
        projectedNext4Weeks: [300, 310],
        spendCurrency: "EUR",
        committedOpenOrders: 5000,
        committedCurrency: "EUR",
        openOrderCount: 1,
        notCounted: {
          approved: 1,
          partlyReceived: 0,
          other: 0,
          orderValue: 700,
          orderValueCurrency: "EUR",
          unpriced: 0,
        },
        basis: {},
      },
      { days: null, currency: "TRY" },
    );
    for (const label of [
      "Paid out, the last 30 days",
      "Paid out, the 30 days before",
      "Committed, not yet delivered",
      "Not in either figure, at order value",
    ])
      expect(isWithheld(valueOf(doc, label))).toBe(true);
    const projected = doc.tables.find((t) => t.title.startsWith("Projected"));
    expect(projected?.rows.every((r) => isWithheld(r[1]))).toBe(true);
  });

  it("withholds euro buying from Against ourselves in a lira house", () => {
    const doc = EXPORT_CUTTINGS.bench.write(
      {
        cashflow: {
          spendLast30d: 1200,
          spendPrev30d: 800,
          spendCurrency: "EUR",
          committedOpenOrders: 5000,
          committedCurrency: "EUR",
        },
        seasonality: {},
        activeGoals: [],
      },
      { days: null, currency: "TRY" },
    );
    expect(isWithheld(valueOf(doc, "Bought, the last 30 days"))).toBe(true);
    expect(isWithheld(valueOf(doc, "Committed, not yet delivered"))).toBe(true);
    const buying = doc.tables[0].rows[0];
    expect(isWithheld(buying[1])).toBe(true);
    expect(isWithheld(buying[2])).toBe(true);
  });
});
